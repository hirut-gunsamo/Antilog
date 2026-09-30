import type { FastifyInstance, FastifyReply } from "fastify";
import { Prisma, UserRole } from "database";
import { z } from "zod";

import { authenticate, authorize, loadViewer, type Viewer } from "../../middleware/auth.js";
import { prisma } from "../../plugins/prisma.js";

/**
 * National ID prints (ORIGINAL) and copies (COPY) for customers.
 *
 * A salesperson registers each customer at the Owner's price, then sends the
 * waiting names to their supervisor as one request. The supervisor forwards
 * it to the Owner, who prints or copies and sends it back with the number
 * done. The rest become leftovers and go out with the next request.
 */

const kind = z.enum(["ORIGINAL", "COPY"]);

const registerSchema = z.object({
  kind,
  fullName: z.string().trim().min(3).max(150),
});

const returnSchema = z.object({
  doneCount: z.coerce.number().int().min(0),
  note: z.string().max(300).optional(),
});

const orderInclude = {
  location: { select: { id: true, name: true } },
  recordedBy: { select: { id: true, name: true } },
} as const;

const requestInclude = {
  location: { select: { id: true, name: true } },
  requestedBy: { select: { id: true, name: true } },
  forwardedBy: { select: { name: true } },
  returnedBy: { select: { name: true } },
} as const;

/** Who sees what: a salesperson their own, a supervisor their branch, the Owner all. */
function scopeOf(viewer: Viewer, byField: "recordedById" | "requestedById") {
  if (viewer.role === "OWNER") return {};
  if (viewer.role === "SUPERVISOR") return { locationId: viewer.branchId ?? "__none__" };
  return { [byField]: viewer.userId };
}

function fail(reply: FastifyReply, status: number, message: string) {
  return reply.status(status).send({ message });
}

export async function nidOrderRoutes(app: FastifyInstance) {
  app.addHook("preHandler", authenticate);

  // Customers and requests for one kind, plus the prices and the totals.
  app.get<{ Querystring: { kind?: string } }>("/", async (request, reply) => {
    const viewer = await loadViewer(request);
    if (!viewer) return fail(reply, 403, "User account is inactive");

    const parsed = kind.safeParse(request.query.kind ?? "ORIGINAL");
    if (!parsed.success) return fail(reply, 400, "Choose original or copy");

    const [orders, requests, settings] = await Promise.all([
      prisma.nationalIdOrder.findMany({
        where: { kind: parsed.data, ...scopeOf(viewer, "recordedById") },
        include: orderInclude,
        orderBy: { createdAt: "desc" },
        take: 500,
      }),
      prisma.nationalIdRequest.findMany({
        where: { kind: parsed.data, ...scopeOf(viewer, "requestedById") },
        include: requestInclude,
        orderBy: { createdAt: "desc" },
        take: 200,
      }),
      prisma.appSetting.findUnique({
        where: { id: "app" },
        select: { nationalIdOriginalRate: true, nationalIdCopyRate: true },
      }),
    ]);

    const count = (status: string) => orders.filter((row) => row.status === status).length;

    return reply.send({
      prices: {
        ORIGINAL: Number(settings?.nationalIdOriginalRate ?? 0),
        COPY: Number(settings?.nationalIdCopyRate ?? 0),
      },
      totals: {
        waiting: count("REGISTERED"),
        withSupervisor: count("REQUESTED"),
        withOwner: count("AT_OWNER"),
        done: count("DONE"),
        leftover: count("LEFTOVER"),
        money: orders.reduce((sum, row) => sum + Number(row.price), 0),
      },
      orders: orders.map((row) => ({ ...row, price: row.price.toString() })),
      requests,
    });
  });

  // A salesperson registers a customer at the Owner's current price.
  app.post("/orders", { preHandler: [authorize(UserRole.SALES)] }, async (request, reply) => {
    const viewer = await loadViewer(request);
    if (!viewer?.branchId) return fail(reply, 403, "You need a branch to register customers");

    const result = registerSchema.safeParse(request.body);
    if (!result.success) return fail(reply, 400, "Enter the customer's full name");

    const settings = await prisma.appSetting.findUnique({
      where: { id: "app" },
      select: { nationalIdOriginalRate: true, nationalIdCopyRate: true },
    });
    const price =
      result.data.kind === "ORIGINAL"
        ? (settings?.nationalIdOriginalRate ?? new Prisma.Decimal(0))
        : (settings?.nationalIdCopyRate ?? new Prisma.Decimal(0));

    const order = await prisma.nationalIdOrder.create({
      data: {
        kind: result.data.kind,
        fullName: result.data.fullName,
        price,
        locationId: viewer.branchId,
        recordedById: viewer.userId,
      },
      include: orderInclude,
    });

    return reply.status(201).send({ order });
  });

  // A name registered by mistake, before it has been sent.
  app.delete<{ Params: { id: string } }>("/orders/:id", async (request, reply) => {
    const viewer = await loadViewer(request);
    if (!viewer) return fail(reply, 403, "User account is inactive");

    const order = await prisma.nationalIdOrder.findUnique({ where: { id: request.params.id } });
    if (!order) return fail(reply, 404, "Not found");
    if (order.status !== "REGISTERED") return fail(reply, 409, "Only a name not yet sent can be removed");

    const allowed =
      viewer.role === "OWNER" ||
      order.recordedById === viewer.userId ||
      (viewer.role === "SUPERVISOR" && order.locationId === viewer.branchId);
    if (!allowed) return fail(reply, 403, "You cannot remove this name");

    await prisma.nationalIdOrder.delete({ where: { id: order.id } });
    return reply.send({ message: "Removed" });
  });

  // The salesperson sends every waiting name of one kind, leftovers included,
  // to their supervisor as one request.
  app.post<{ Body: { kind?: string } }>(
    "/requests",
    { preHandler: [authorize(UserRole.SALES)] },
    async (request, reply) => {
      const viewer = await loadViewer(request);
      if (!viewer?.branchId) return fail(reply, 403, "You need a branch to send requests");

      const parsed = kind.safeParse(request.body?.kind);
      if (!parsed.success) return fail(reply, 400, "Choose original or copy");

      const created = await prisma.$transaction(async (tx) => {
        const waiting = await tx.nationalIdOrder.findMany({
          where: {
            kind: parsed.data,
            recordedById: viewer.userId,
            status: { in: ["REGISTERED", "LEFTOVER"] },
          },
          select: { id: true },
        });

        if (waiting.length === 0) return null;

        const nidRequest = await tx.nationalIdRequest.create({
          data: {
            kind: parsed.data,
            locationId: viewer.branchId!,
            requestedById: viewer.userId,
            total: waiting.length,
          },
        });

        await tx.nationalIdOrder.updateMany({
          where: { id: { in: waiting.map((row) => row.id) } },
          data: { status: "REQUESTED", requestId: nidRequest.id },
        });

        return nidRequest;
      });

      if (!created) return fail(reply, 400, "There are no names waiting to be sent");
      return reply.status(201).send({ request: created });
    },
  );

  // The branch's supervisor sends it on to the Owner.
  app.patch<{ Params: { id: string } }>(
    "/requests/:id/forward",
    { preHandler: [authorize(UserRole.SUPERVISOR)] },
    async (request, reply) => {
      const viewer = await loadViewer(request);
      if (!viewer) return fail(reply, 403, "User account is inactive");

      const nidRequest = await prisma.nationalIdRequest.findUnique({ where: { id: request.params.id } });
      if (!nidRequest) return fail(reply, 404, "Not found");
      if (nidRequest.locationId !== viewer.branchId) return fail(reply, 403, "This request is from another branch");
      if (nidRequest.status !== "WITH_SUPERVISOR") return fail(reply, 409, "This request has already been sent on");

      await prisma.$transaction([
        prisma.nationalIdRequest.update({
          where: { id: nidRequest.id },
          data: { status: "WITH_OWNER", forwardedById: viewer.userId, forwardedAt: new Date() },
        }),
        prisma.nationalIdOrder.updateMany({
          where: { requestId: nidRequest.id },
          data: { status: "AT_OWNER" },
        }),
      ]);

      return reply.send({ message: "Sent to the Owner" });
    },
  );

  // The Owner sends it back with how many were printed or copied. The first
  // ones registered count as done; the rest are leftovers for next time.
  app.patch<{ Params: { id: string } }>(
    "/requests/:id/return",
    { preHandler: [authorize(UserRole.OWNER)] },
    async (request, reply) => {
      const viewer = await loadViewer(request);
      if (!viewer) return fail(reply, 403, "User account is inactive");

      const result = returnSchema.safeParse(request.body);
      if (!result.success) return fail(reply, 400, "Enter how many were done");

      const nidRequest = await prisma.nationalIdRequest.findUnique({
        where: { id: request.params.id },
        include: { orders: { select: { id: true }, orderBy: { createdAt: "asc" } } },
      });
      if (!nidRequest) return fail(reply, 404, "Not found");
      if (nidRequest.status !== "WITH_OWNER") return fail(reply, 409, "This request is not with the Owner");

      const total = nidRequest.orders.length;
      const done = Math.min(result.data.doneCount, total);
      const doneIds = nidRequest.orders.slice(0, done).map((row) => row.id);
      const leftIds = nidRequest.orders.slice(done).map((row) => row.id);

      await prisma.$transaction([
        prisma.nationalIdRequest.update({
          where: { id: nidRequest.id },
          data: {
            status: "RETURNED",
            doneCount: done,
            leftoverCount: total - done,
            note: result.data.note?.trim() || null,
            returnedById: viewer.userId,
            returnedAt: new Date(),
          },
        }),
        prisma.nationalIdOrder.updateMany({
          where: { id: { in: doneIds } },
          data: { status: "DONE", doneAt: new Date() },
        }),
        // Leftovers leave this request, so the next one picks them up.
        prisma.nationalIdOrder.updateMany({
          where: { id: { in: leftIds } },
          data: { status: "LEFTOVER", requestId: null },
        }),
      ]);

      return reply.send({ message: "Sent back", doneCount: done, leftoverCount: total - done });
    },
  );
}

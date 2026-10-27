import type { FastifyInstance, FastifyReply } from "fastify";
import { Prisma, UserRole } from "database";
import { z } from "zod";

import { authenticate, authorize, loadViewer, type Viewer } from "../../middleware/auth.js";
import { prisma } from "../../plugins/prisma.js";
import { defaultNidPrices, nidPricesFor } from "./nidPrice.js";
import { paymentColumns, paymentFields } from "../../utils/payment.js";
import { grantedDays, ownEntryEditable } from "../../utils/editGrant.js";

/**
 * National ID prints (ORIGINAL) and copies (COPY) for customers.
 *
 * A salesperson registers each customer at the Owner's price, then sends the
 * waiting names to their supervisor as one request. The supervisor collects
 * the branch's requests and sends them all to the Owner, who prints or copies
 * and sends each back marking every name Printed or still Waiting. Waiting
 * names become leftovers and go out with the next request.
 */

const kind = z.enum(["ORIGINAL", "COPY"]);

const registerSchema = z.object({
  kind,
  fullName: z.string().trim().min(3).max(150),
  ...paymentFields,
});

// Correcting a customer: the name and how they paid. The price stays.
const editSchema = z.object({
  fullName: z.string().trim().min(3).max(150),
  ...paymentFields,
});

// The names printed; every other name in the request is still waiting.
// (doneCount, the first that many, is still understood.)
const returnSchema = z
  .object({
    printedIds: z.array(z.string().min(1)).max(1000).optional(),
    doneCount: z.coerce.number().int().min(0).optional(),
    note: z.string().max(300).optional(),
    returnedOn: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, "Use a YYYY-MM-DD date")
      .optional(),
  })
  .refine((body) => body.printedIds !== undefined || body.doneCount !== undefined);

// The Owner's prices for one branch.
const branchPriceSchema = z.object({
  ORIGINAL: z.coerce.number().min(0).max(100_000),
  COPY: z.coerce.number().min(0).max(100_000),
});

// The names the Owner ticks on the waiting list; none means every name.
const approveSchema = z.object({
  orderIds: z.array(z.string().min(1)).min(1).max(1000).optional(),
});

function dayAtNoon(day: string) {
  return new Date(`${day}T12:00:00`);
}

const orderInclude = {
  location: { select: { id: true, name: true } },
  recordedBy: { select: { id: true, name: true } },
} as const;

const requestInclude = {
  location: { select: { id: true, name: true } },
  requestedBy: { select: { id: true, name: true } },
  forwardedBy: { select: { name: true } },
  returnedBy: { select: { name: true } },
  // The names in it, so the Owner can tick which to approve and which printed.
  orders: {
    select: { id: true, fullName: true, status: true, createdAt: true },
    orderBy: { createdAt: "asc" },
  },
} as const;

/**
 * The Owner approves names for printing. Only names still waiting at the
 * Owner move; each request they belong to becomes APPROVED, and its other
 * names stay waiting until approved too or sent back.
 */
async function approveOrders(where: Prisma.NationalIdOrderWhereInput) {
  return prisma.$transaction(async (tx) => {
    const orders = await tx.nationalIdOrder.findMany({
      where: {
        ...where,
        status: "AT_OWNER",
        request: { status: { in: ["WITH_OWNER", "APPROVED"] } },
      },
      select: { id: true, requestId: true },
    });
    if (orders.length === 0) return 0;

    const requestIds = [...new Set(orders.map((row) => row.requestId!))];
    await tx.nationalIdOrder.updateMany({
      where: { id: { in: orders.map((row) => row.id) } },
      data: { status: "APPROVED" },
    });
    await tx.nationalIdRequest.updateMany({
      where: { id: { in: requestIds } },
      data: { status: "APPROVED" },
    });
    return orders.length;
  });
}

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

    const [orders, requests, prices, branchPrices] = await Promise.all([
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
      // The Owner sees the default; everyone else what their branch charges.
      viewer.role === "OWNER" ? defaultNidPrices() : nidPricesFor(viewer.branchId),
      viewer.role === "OWNER"
        ? prisma.nationalIdBranchPrice.findMany({ include: { location: { select: { name: true } } } })
        : Promise.resolve([]),
    ]);

    const count = (status: string) => orders.filter((row) => row.status === status).length;

    return reply.send({
      prices: { ORIGINAL: Number(prices.ORIGINAL), COPY: Number(prices.COPY) },
      // Branches with prices of their own; the rest charge the default.
      branchPrices: branchPrices.map((row) => ({
        branchId: row.locationId,
        name: row.location.name,
        ORIGINAL: Number(row.originalRate),
        COPY: Number(row.copyRate),
      })),
      totals: {
        waiting: count("REGISTERED"),
        withSupervisor: count("REQUESTED"),
        withOwner: count("AT_OWNER"),
        done: count("DONE"),
        leftover: count("LEFTOVER"),
        money: orders.reduce((sum, row) => sum + Number(row.price), 0),
      },
      orders: await (async () => {
        // Which of a seller's own customers they may still correct.
        const granted = viewer.role === "SALES" ? await grantedDays(viewer.userId) : new Set<string>();
        return orders.map((row) => ({
          ...row,
          price: row.price.toString(),
          editable:
            viewer.role !== "SALES" ||
            (row.recordedById === viewer.userId && ownEntryEditable(row.createdAt, granted)),
        }));
      })(),
      requests,
    });
  });

  // A salesperson registers a customer at the Owner's current price.
  app.post("/orders", { preHandler: [authorize(UserRole.SALES)] }, async (request, reply) => {
    const viewer = await loadViewer(request);
    if (!viewer?.branchId) return fail(reply, 403, "You need a branch to register customers");

    const result = registerSchema.safeParse(request.body);
    if (!result.success) return fail(reply, 400, "Enter the customer's full name");

    // The branch's own price if the Owner set one, else the default.
    const price = (await nidPricesFor(viewer.branchId))[result.data.kind];

    let payment;
    try {
      payment = paymentColumns(result.data, Number(price));
    } catch {
      return fail(reply, 400, "Choose the bank, and for cash + transfer enter the part transferred");
    }

    const order = await prisma.nationalIdOrder.create({
      data: {
        kind: result.data.kind,
        fullName: result.data.fullName,
        price,
        ...payment,
        locationId: viewer.branchId,
        recordedById: viewer.userId,
      },
      include: orderInclude,
    });

    return reply.status(201).send({ order });
  });

  // The Owner sets a branch's own prices...
  app.put<{ Params: { branchId: string } }>(
    "/prices/:branchId",
    { preHandler: [authorize(UserRole.OWNER)] },
    async (request, reply) => {
      const result = branchPriceSchema.safeParse(request.body);
      if (!result.success) return fail(reply, 400, "Enter both prices");

      const branch = await prisma.stockLocation.findUnique({ where: { id: request.params.branchId } });
      if (!branch) return fail(reply, 404, "Branch not found");

      const data = { originalRate: result.data.ORIGINAL, copyRate: result.data.COPY };
      await prisma.nationalIdBranchPrice.upsert({
        where: { locationId: branch.id },
        create: { locationId: branch.id, ...data },
        update: data,
      });
      return reply.send({ message: "Saved" });
    },
  );

  // ...or puts it back on the default prices.
  app.delete<{ Params: { branchId: string } }>(
    "/prices/:branchId",
    { preHandler: [authorize(UserRole.OWNER)] },
    async (request, reply) => {
      await prisma.nationalIdBranchPrice.deleteMany({ where: { locationId: request.params.branchId } });
      return reply.send({ message: "Using the default prices" });
    },
  );

  // A customer corrected. A salesperson edits their own from today; a
  // supervisor their branch's; the Owner any.
  app.patch<{ Params: { id: string } }>("/orders/:id", async (request, reply) => {
    const viewer = await loadViewer(request);
    if (!viewer) return fail(reply, 403, "User account is inactive");

    const result = editSchema.safeParse(request.body);
    if (!result.success) return fail(reply, 400, "Enter the customer's full name");

    const order = await prisma.nationalIdOrder.findUnique({ where: { id: request.params.id } });
    if (!order) return fail(reply, 404, "Not found");

    const allowed =
      viewer.role === "OWNER" ||
      (viewer.role === "SUPERVISOR" && order.locationId === viewer.branchId) ||
      (order.recordedById === viewer.userId &&
        ownEntryEditable(order.createdAt, await grantedDays(viewer.userId)));
    if (!allowed) {
      return fail(reply, 403, "Sales can edit only their own customers from today, or a day the Owner opened");
    }

    let payment;
    try {
      payment = paymentColumns(result.data, Number(order.price));
    } catch {
      return fail(reply, 400, "Choose the bank, and for cash + transfer enter the part transferred");
    }

    const updated = await prisma.nationalIdOrder.update({
      where: { id: order.id },
      data: { fullName: result.data.fullName, ...payment },
      include: orderInclude,
    });
    return reply.send({ order: { ...updated, price: updated.price.toString() } });
  });

  // A customer removed. A salesperson may remove their own name not yet
  // sent; a supervisor any of their branch's; the Owner any name. A name
  // taken out of a request comes off that request's counts too.
  app.delete<{ Params: { id: string } }>("/orders/:id", async (request, reply) => {
    const viewer = await loadViewer(request);
    if (!viewer) return fail(reply, 403, "User account is inactive");

    const order = await prisma.nationalIdOrder.findUnique({ where: { id: request.params.id } });
    if (!order) return fail(reply, 404, "Not found");

    const isOwner = viewer.role === "OWNER";
    // Sales remove only their own names not yet sent; the rest is the supervisor's.
    if (viewer.role === "SALES" && order.status !== "REGISTERED") {
      return fail(reply, 409, "Only a name not yet sent can be removed. Ask your supervisor.");
    }

    const allowed =
      isOwner ||
      order.recordedById === viewer.userId ||
      (viewer.role === "SUPERVISOR" && order.locationId === viewer.branchId);
    if (!allowed) return fail(reply, 403, "You cannot remove this name");

    await prisma.$transaction(async (tx) => {
      await tx.nationalIdOrder.delete({ where: { id: order.id } });
      if (!order.requestId) return;

      const nidRequest = await tx.nationalIdRequest.findUnique({ where: { id: order.requestId } });
      if (!nidRequest) return;
      if (nidRequest.total <= 1) {
        await tx.nationalIdRequest.delete({ where: { id: nidRequest.id } });
        return;
      }
      await tx.nationalIdRequest.update({
        where: { id: nidRequest.id },
        data: {
          total: { decrement: 1 },
          ...(order.status === "DONE" && nidRequest.doneCount ? { doneCount: { decrement: 1 } } : {}),
        },
      });
    });

    return reply.send({ message: "Removed" });
  });

  // A request removed. The Owner may remove any; a salesperson or supervisor
  // only one not yet sent on to the Owner. Its names are not lost: those not
  // done go back to waiting to send, and done ones stay recorded.
  app.delete<{ Params: { id: string } }>("/requests/:id", async (request, reply) => {
    const viewer = await loadViewer(request);
    if (!viewer) return fail(reply, 403, "User account is inactive");

    const nidRequest = await prisma.nationalIdRequest.findUnique({ where: { id: request.params.id } });
    if (!nidRequest) return fail(reply, 404, "Not found");

    if (viewer.role !== "OWNER") {
      const own =
        (viewer.role === "SALES" && nidRequest.requestedById === viewer.userId) ||
        (viewer.role === "SUPERVISOR" && nidRequest.locationId === viewer.branchId);
      if (!own) return fail(reply, 403, "You cannot remove this request");
      if (nidRequest.status !== "WITH_SUPERVISOR") {
        return fail(reply, 409, "Only the Owner can remove a request already sent on");
      }
    }

    await prisma.$transaction([
      prisma.nationalIdOrder.updateMany({
        where: { requestId: nidRequest.id, status: { not: "DONE" } },
        data: { status: "REGISTERED", requestId: null },
      }),
      prisma.nationalIdOrder.updateMany({
        where: { requestId: nidRequest.id },
        data: { requestId: null },
      }),
      prisma.nationalIdRequest.delete({ where: { id: nidRequest.id } }),
    ]);

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

  // The supervisor sends every request of one kind from their salespeople on
  // to the Owner at once.
  app.patch<{ Body: { kind?: string } }>(
    "/requests/forward-all",
    { preHandler: [authorize(UserRole.SUPERVISOR)] },
    async (request, reply) => {
      const viewer = await loadViewer(request);
      if (!viewer?.branchId) return fail(reply, 403, "You need a branch to send requests");

      const parsed = kind.safeParse(request.body?.kind);
      if (!parsed.success) return fail(reply, 400, "Choose original or copy");

      const waiting = await prisma.nationalIdRequest.findMany({
        where: { kind: parsed.data, locationId: viewer.branchId, status: "WITH_SUPERVISOR" },
        select: { id: true, total: true },
      });
      if (waiting.length === 0) return fail(reply, 400, "There are no requests to send");

      const ids = waiting.map((row) => row.id);
      await prisma.$transaction([
        prisma.nationalIdRequest.updateMany({
          where: { id: { in: ids }, status: "WITH_SUPERVISOR" },
          data: { status: "WITH_OWNER", forwardedById: viewer.userId, forwardedAt: new Date() },
        }),
        prisma.nationalIdOrder.updateMany({
          where: { requestId: { in: ids } },
          data: { status: "AT_OWNER" },
        }),
      ]);

      return reply.send({
        message: "Sent to the Owner",
        requests: ids.length,
        names: waiting.reduce((sum, row) => sum + row.total, 0),
      });
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

  // The supervisor confirms they received the returned request from the Owner.
  app.patch<{ Params: { id: string } }>(
    "/requests/:id/receive",
    { preHandler: [authorize(UserRole.SUPERVISOR)] },
    async (request, reply) => {
      const viewer = await loadViewer(request);
      if (!viewer) return fail(reply, 403, "User account is inactive");

      const nidRequest = await prisma.nationalIdRequest.findUnique({ where: { id: request.params.id } });
      if (!nidRequest) return fail(reply, 404, "Not found");
      if (nidRequest.locationId !== viewer.branchId) return fail(reply, 403, "This request is from another branch");
      if (nidRequest.status !== "RETURNED") return fail(reply, 409, "This request is not returned yet");

      await prisma.nationalIdRequest.update({
        where: { id: nidRequest.id },
        data: { status: "RECEIVED" },
      });

      return reply.send({ message: "Received" });
    },
  );

  // The Owner approves the names ticked on the waiting list, across requests.
  app.patch(
    "/requests/approve",
    { preHandler: [authorize(UserRole.OWNER)] },
    async (request, reply) => {
      const result = approveSchema.safeParse(request.body);
      if (!result.success || !result.data.orderIds) return fail(reply, 400, "Tick the names to approve");

      const approved = await approveOrders({ id: { in: result.data.orderIds } });
      if (approved === 0) return fail(reply, 409, "None of these names are waiting for approval");
      return reply.send({ message: "Approved", approved });
    },
  );

  // The same for one request: the names given, or all of its waiting names.
  app.patch<{ Params: { id: string } }>(
    "/requests/:id/approve",
    { preHandler: [authorize(UserRole.OWNER)] },
    async (request, reply) => {
      const result = approveSchema.safeParse(request.body ?? {});
      if (!result.success) return fail(reply, 400, "Tick the names to approve");

      const nidRequest = await prisma.nationalIdRequest.findUnique({ where: { id: request.params.id } });
      if (!nidRequest) return fail(reply, 404, "Not found");
      if (!["WITH_OWNER", "APPROVED"].includes(nidRequest.status)) {
        return fail(reply, 409, "This request is not waiting with the Owner");
      }

      const approved = await approveOrders({
        requestId: nidRequest.id,
        ...(result.data.orderIds ? { id: { in: result.data.orderIds } } : {}),
      });
      if (approved === 0) return fail(reply, 409, "None of these names are waiting for approval");
      return reply.send({ message: "Approved", approved });
    },
  );

  // The Owner sends it back with the names printed or copied; every other
  // name in it is a leftover for next time.
  app.patch<{ Params: { id: string } }>(
    "/requests/:id/return",
    { preHandler: [authorize(UserRole.OWNER)] },
    async (request, reply) => {
      const viewer = await loadViewer(request);
      if (!viewer) return fail(reply, 403, "User account is inactive");

      const result = returnSchema.safeParse(request.body);
      if (!result.success) return fail(reply, 400, "Mark each name printed or waiting");

      const nidRequest = await prisma.nationalIdRequest.findUnique({
        where: { id: request.params.id },
        include: { orders: { select: { id: true }, orderBy: { createdAt: "asc" } } },
      });
      if (!nidRequest) return fail(reply, 404, "Not found");
      if (!["WITH_OWNER", "APPROVED"].includes(nidRequest.status)) {
        return fail(reply, 409, "This request is not ready to send back");
      }

      const total = nidRequest.orders.length;
      const printed = result.data.printedIds ? new Set(result.data.printedIds) : null;
      const doneIds = printed
        ? nidRequest.orders.filter((row) => printed.has(row.id)).map((row) => row.id)
        : nidRequest.orders.slice(0, Math.min(result.data.doneCount ?? 0, total)).map((row) => row.id);
      const doneSet = new Set(doneIds);
      const leftIds = nidRequest.orders.filter((row) => !doneSet.has(row.id)).map((row) => row.id);
      const done = doneIds.length;
      const returnedAt = result.data.returnedOn ? dayAtNoon(result.data.returnedOn) : new Date();

      await prisma.$transaction([
        prisma.nationalIdRequest.update({
          where: { id: nidRequest.id },
          data: {
            status: "RETURNED",
            doneCount: done,
            leftoverCount: total - done,
            note: result.data.note?.trim() || null,
            returnedById: viewer.userId,
            returnedAt,
          },
        }),
        prisma.nationalIdOrder.updateMany({
          where: { id: { in: doneIds } },
          data: { status: "DONE", doneAt: returnedAt },
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

import type { FastifyInstance, FastifyReply } from "fastify";
import { UserRole } from "database";
import { z } from "zod";

import { authenticate, authorize, loadViewer } from "../../middleware/auth.js";
import {
  KINDS,
  deleteLoad,
  deleteTransaction,
  getSummary,
  loadMoney,
  record,
} from "./telebirr.service.js";

const loadSchema = z.object({
  amount: z.coerce.number().positive().max(1_000_000_000),
  note: z.string().max(300).optional(),
});

const recordSchema = z.object({
  kind: z.enum(KINDS),
  amount: z.coerce.number().positive().max(100_000_000),
  branchId: z.string().min(1).optional(),
  customerPhone: z.string().max(24).optional(),
  note: z.string().max(300).optional(),
});

const MESSAGES: Record<string, [number, string]> = {
  BRANCH_REQUIRED: [400, "Choose the branch"],
  NOT_ENOUGH_BALANCE: [409, "Not enough Telebirr balance left. Ask the Owner to load more."],
  NOT_FOUND: [404, "Not found"],
  LOAD_ALREADY_SPENT: [409, "This load has already been spent from and cannot be removed"],
};

function fail(reply: FastifyReply, error: unknown) {
  const known = error instanceof Error ? MESSAGES[error.message] : undefined;
  if (!known) throw error;
  return reply.status(known[0]).send({ message: known[1] });
}

export async function telebirrRoutes(app: FastifyInstance) {
  app.addHook("preHandler", authenticate);

  const ownerOnly = { preHandler: [authorize(UserRole.OWNER)] };

  app.get<{ Querystring: { from?: string; to?: string; branchId?: string } }>("/", async (request, reply) => {
    const viewer = await loadViewer(request);
    if (!viewer) return reply.status(403).send({ message: "User account is inactive" });
    return reply.send(await getSummary(viewer, request.query));
  });

  app.post("/loads", ownerOnly, async (request, reply) => {
    const viewer = await loadViewer(request);
    if (!viewer) return reply.status(403).send({ message: "User account is inactive" });

    const result = loadSchema.safeParse(request.body);
    if (!result.success) return reply.status(400).send({ message: "Enter the amount loaded" });

    return reply.status(201).send({ load: await loadMoney(viewer, result.data) });
  });

  // Anyone who sells records their own cash-ins and airtime.
  app.post("/transactions", async (request, reply) => {
    const viewer = await loadViewer(request);
    if (!viewer) return reply.status(403).send({ message: "User account is inactive" });

    const result = recordSchema.safeParse(request.body);
    if (!result.success) return reply.status(400).send({ message: "Choose cash-in or airtime and enter the amount" });

    try {
      return reply.status(201).send({ transaction: await record(viewer, result.data) });
    } catch (error) {
      return fail(reply, error);
    }
  });

  app.delete<{ Params: { id: string } }>("/transactions/:id", ownerOnly, async (request, reply) => {
    try {
      await deleteTransaction(request.params.id);
      return reply.send({ message: "Removed" });
    } catch (error) {
      return fail(reply, error);
    }
  });

  app.delete<{ Params: { id: string } }>("/loads/:id", ownerOnly, async (request, reply) => {
    try {
      await deleteLoad(request.params.id);
      return reply.send({ message: "Removed" });
    } catch (error) {
      return fail(reply, error);
    }
  });
}

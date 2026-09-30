import type { FastifyInstance, FastifyReply } from "fastify";
import { UserRole } from "database";
import { z } from "zod";

import { authenticate, authorize, loadViewer } from "../../middleware/auth.js";
import {
  deleteLoad,
  deletePrint,
  getSummary,
  loadBalance,
  printIbid,
} from "./ibid.service.js";

const loadSchema = z.object({
  amount: z.coerce.number().positive().max(1_000_000_000),
  note: z.string().max(300).optional(),
});

const printSchema = z.object({
  denomination: z.coerce.number().int().positive(),
  cartas: z.coerce.number().int().min(0).max(100_000).optional(),
  cards: z.coerce.number().int().min(0).max(1_000_000).optional(),
  branchId: z.string().min(1).optional(),
  note: z.string().max(300).optional(),
});

const MESSAGES: Record<string, [number, string]> = {
  BRANCH_REQUIRED: [400, "Choose the branch that printed"],
  BAD_VALUE: [400, "Ibid comes in 10, 15, 25, 50 or 100"],
  NO_CARDS: [400, "Enter how many carta or cards were printed"],
  NOT_ENOUGH_BALANCE: [409, "Not enough Ibid balance left. Ask the Owner to load more."],
  NOT_FOUND: [404, "Not found"],
  LOAD_ALREADY_SPENT: [409, "This load has already been printed from and cannot be removed"],
};

function fail(reply: FastifyReply, error: unknown) {
  const known = error instanceof Error ? MESSAGES[error.message] : undefined;
  if (!known) throw error;
  return reply.status(known[0]).send({ message: known[1] });
}

export async function ibidRoutes(app: FastifyInstance) {
  app.addHook("preHandler", authenticate);

  const ownerOrSupervisor = {
    preHandler: [authorize(UserRole.OWNER, UserRole.SUPERVISOR)],
  };
  const ownerOnly = { preHandler: [authorize(UserRole.OWNER)] };

  app.get<{ Querystring: { from?: string; to?: string; branchId?: string } }>(
    "/",
    ownerOrSupervisor,
    async (request, reply) => {
      const viewer = await loadViewer(request);
      if (!viewer) return reply.status(403).send({ message: "User account is inactive" });
      return reply.send(await getSummary(viewer, request.query));
    },
  );

  app.post("/loads", ownerOnly, async (request, reply) => {
    const viewer = await loadViewer(request);
    if (!viewer) return reply.status(403).send({ message: "User account is inactive" });

    const result = loadSchema.safeParse(request.body);
    if (!result.success) return reply.status(400).send({ message: "Enter the amount loaded" });

    return reply.status(201).send({ load: await loadBalance(viewer, result.data) });
  });

  app.post("/prints", ownerOrSupervisor, async (request, reply) => {
    const viewer = await loadViewer(request);
    if (!viewer) return reply.status(403).send({ message: "User account is inactive" });

    const result = printSchema.safeParse(request.body);
    if (!result.success) return reply.status(400).send({ message: "Enter the value and how many carta or cards" });

    try {
      return reply.status(201).send({ print: await printIbid(viewer, result.data) });
    } catch (error) {
      return fail(reply, error);
    }
  });

  app.delete<{ Params: { id: string } }>("/prints/:id", ownerOnly, async (request, reply) => {
    try {
      await deletePrint(request.params.id);
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

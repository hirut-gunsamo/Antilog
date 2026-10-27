import type { FastifyInstance, FastifyReply } from "fastify";
import { UserRole } from "database";
import { z } from "zod";

import { authenticate, authorize, loadViewer } from "../../middleware/auth.js";
import {
  deleteLoad,
  deletePrint,
  getSummary,
  updateLoad,
  loadBalance,
  printIbid,
  editPrint,
} from "./ibid.service.js";

const loadSchema = z.object({
  amount: z.coerce.number().positive().max(1_000_000_000),
  branchId: z.string().min(1),
  note: z.string().max(300).optional(),
});

// Correcting a load: the amount and the note; its branch stays.
const loadEditSchema = z.object({
  amount: z.coerce.number().positive().max(1_000_000_000).optional(),
  note: z.string().max(300).nullable().optional(),
});

const printSchema = z.object({
  denomination: z.coerce.number().int().positive(),
  cartas: z.coerce.number().int().min(0).max(100_000).optional(),
  cards: z.coerce.number().int().min(0).max(1_000_000).optional(),
  branchId: z.string().min(1).optional(),
  note: z.string().max(300).optional(),
});

const MESSAGES: Record<string, [number, string]> = {
  BRANCH_REQUIRED: [400, "Choose the branch"],
  BAD_VALUE: [400, "EVD comes in 10, 15, 25, 50 or 100"],
  NO_CARDS: [400, "Enter how many carta or cards were printed"],
  NOT_ENOUGH_BALANCE: [409, "Not enough EVD balance left at this branch. Ask the Owner to load more."],
  NOT_YOURS: [403, "You can only change prints you made"],
  EDIT_LOCKED: [409, "A print can only be changed on the day it was made. Ask the Owner."],
  NO_EVD_PRODUCT: [409, "There is no airtime product of that value to put the printed cards into. Add it on Products (e.g. CARD_50, value 50) first."],
  PRINT_ALREADY_USED: [409, "Those printed cards have already been sent or sold, so the print cannot be removed"],
  NOT_FOUND: [404, "Not found"],
  LOAD_ALREADY_SPENT: [409, "This load has already been printed from and cannot be removed"],
  LOAD_ALREADY_SPENT_EDIT: [409, "So much of this load has been printed from that it cannot be lowered that far"],
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
    if (!result.success) return reply.status(400).send({ message: "Choose the branch and enter the amount loaded" });

    try {
      return reply.status(201).send({ load: await loadBalance(viewer, result.data) });
    } catch (error) {
      return fail(reply, error);
    }
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

  // Correcting a print: the supervisor who printed it, the same day; the Owner any time.
  app.patch<{ Params: { id: string } }>("/prints/:id", ownerOrSupervisor, async (request, reply) => {
    const viewer = await loadViewer(request);
    if (!viewer) return reply.status(403).send({ message: "User account is inactive" });
    const result = printSchema.safeParse(request.body);
    if (!result.success) return reply.status(400).send({ message: "Enter the value and how many carta or cards" });
    try {
      return reply.send({ print: await editPrint(viewer, request.params.id, result.data) });
    } catch (error) {
      return fail(reply, error);
    }
  });

  app.delete<{ Params: { id: string } }>("/prints/:id", ownerOnly, async (request, reply) => {
    try {
      await deletePrint(request.params.id, request.user.userId);
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

  // A load corrected: its amount or note.
  app.patch<{ Params: { id: string } }>("/loads/:id", ownerOnly, async (request, reply) => {
    const result = loadEditSchema.safeParse(request.body);
    if (!result.success) return reply.status(400).send({ message: "Enter the amount loaded" });

    try {
      return reply.send({ load: await updateLoad(request.params.id, result.data) });
    } catch (error) {
      return fail(reply, error);
    }
  });
}

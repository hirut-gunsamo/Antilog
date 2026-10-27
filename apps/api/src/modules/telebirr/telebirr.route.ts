import type { FastifyInstance, FastifyReply } from "fastify";
import { UserRole } from "database";
import { z } from "zod";

import { authenticate, authorize, loadViewer } from "../../middleware/auth.js";
import {
  KINDS,
  deleteLoad,
  deleteTransaction,
  getSummary,
  updateTransaction,
  updateLoad,
  loadMoney,
  record,
} from "./telebirr.service.js";
import { paymentFields } from "../../utils/payment.js";

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

const recordSchema = z.object({
  kind: z.enum(KINDS),
  amount: z.coerce.number().positive().max(100_000_000),
  branchId: z.string().min(1).optional(),
  customerPhone: z.string().max(24).optional(),
  note: z.string().max(300).optional(),
  ...paymentFields,
});

// Correcting an entry: everything but its branch.
const editSchema = recordSchema.omit({ branchId: true });

const MESSAGES: Record<string, [number, string]> = {
  BRANCH_REQUIRED: [400, "Choose the branch"],
  PAYMENT_INVALID: [400, "Choose the bank, and for cash + transfer enter the part transferred"],
  NOT_ENOUGH_BALANCE: [409, "Not enough Telebirr balance left at this branch. Ask the Owner to load more."],
  NOT_FOUND: [404, "Not found"],
  NOT_ALLOWED: [403, "You cannot change this entry. Sales can edit only their own entries from today, or a day the Owner opened."],
  LOAD_ALREADY_SPENT: [409, "This load has already been spent from and cannot be removed"],
  LOAD_ALREADY_SPENT_EDIT: [409, "So much of this load has been spent from that it cannot be lowered that far"],
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
    if (!result.success) return reply.status(400).send({ message: "Choose the branch and enter the amount loaded" });

    try {
      return reply.status(201).send({ load: await loadMoney(viewer, result.data) });
    } catch (error) {
      return fail(reply, error);
    }
  });

  // Sellers and supervisors record cash-ins and airtime for their own branch,
  // spending its own balance; the Owner may record for any branch.
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

  // Sellers edit their own entries from today; supervisors their branch's.
  app.patch<{ Params: { id: string } }>("/transactions/:id", async (request, reply) => {
    const viewer = await loadViewer(request);
    if (!viewer) return reply.status(403).send({ message: "User account is inactive" });

    const result = editSchema.safeParse(request.body);
    if (!result.success) return reply.status(400).send({ message: "Choose cash-in or airtime and enter the amount" });

    try {
      return reply.send({ transaction: await updateTransaction(viewer, request.params.id, result.data) });
    } catch (error) {
      return fail(reply, error);
    }
  });

  // The Owner, or the branch's supervisor, removes an entry.
  app.delete<{ Params: { id: string } }>(
    "/transactions/:id",
    { preHandler: [authorize(UserRole.SALES, UserRole.SUPERVISOR, UserRole.OWNER)] },
    async (request, reply) => {
    const viewer = await loadViewer(request);
    if (!viewer) return reply.status(403).send({ message: "User account is inactive" });
    try {
      await deleteTransaction(viewer, request.params.id);
      return reply.send({ message: "Removed" });
    } catch (error) {
      return fail(reply, error);
    }
    },
  );

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

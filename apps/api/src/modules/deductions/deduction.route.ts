import type { FastifyInstance, FastifyReply } from "fastify";
import { z } from "zod";

import { authenticate, loadViewer } from "../../middleware/auth.js";
import { createDeduction, deleteDeduction, listDeductions } from "./deduction.service.js";

const createSchema = z.object({
  day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  userId: z.string().min(1).optional(),
  note: z.string().max(300).optional(),
  // Money taken off with no item behind it: received by mistake, short, etc.
  amount: z.coerce.number().min(0).max(100_000_000).optional(),
  // Items short or lost: optional now.
  lines: z
    .array(
      z.object({
        productId: z.string().min(1),
        quantity: z.coerce.number().int().positive().max(1_000_000),
        amount: z.coerce.number().min(0).max(100_000_000).optional(),
      }),
    )
    .max(50)
    .default([]),
}).refine((body) => body.lines.length > 0 || (body.amount ?? 0) > 0, {
  message: "Enter the amount, or add the items",
});

const MESSAGES: Record<string, [number, string]> = {
  EMPLOYEE_REQUIRED: [400, "Choose whose deduction this is"],
  PRODUCT_NOT_FOUND: [400, "One of the items no longer exists"],
  NOT_FOUND: [404, "Not found"],
  ALREADY_PAID: [409, "That month's salary is already paid, so this deduction is part of it. Ask the Owner."],
};

function fail(reply: FastifyReply, error: unknown) {
  const known = error instanceof Error ? MESSAGES[error.message] : undefined;
  if (!known) throw error;
  return reply.status(known[0]).send({ message: known[1] });
}

export async function deductionRoutes(app: FastifyInstance) {
  app.addHook("preHandler", authenticate);

  // Everyone reads: the Owner every deduction, anyone else their own.
  app.get<{ Querystring: { month?: string; userId?: string; branchId?: string } }>(
    "/",
    async (request, reply) => {
      const viewer = await loadViewer(request);
      if (!viewer) return reply.status(403).send({ message: "User account is inactive" });

      const now = new Date();
      const month =
        request.query.month && /^\d{4}-\d{2}$/.test(request.query.month)
          ? request.query.month
          : `${now.getFullYear()}-${`${now.getMonth() + 1}`.padStart(2, "0")}`;

      return reply.send({
        deductions: await listDeductions(viewer, { ...request.query, month }),
      });
    },
  );

  app.post("/", async (request, reply) => {
    const viewer = await loadViewer(request);
    if (!viewer) return reply.status(403).send({ message: "User account is inactive" });

    const result = createSchema.safeParse(request.body);
    if (!result.success) {
      return reply.status(400).send({ message: "Choose the date and enter the amount, or add the items" });
    }

    try {
      return reply.status(201).send({ deduction: await createDeduction(viewer, result.data) });
    } catch (error) {
      return fail(reply, error);
    }
  });

  app.delete<{ Params: { id: string } }>("/:id", async (request, reply) => {
    const viewer = await loadViewer(request);
    if (!viewer) return reply.status(403).send({ message: "User account is inactive" });

    try {
      await deleteDeduction(viewer, request.params.id);
      return reply.send({ message: "Removed" });
    } catch (error) {
      return fail(reply, error);
    }
  });
}

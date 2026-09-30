import type { FastifyInstance, FastifyReply } from "fastify";
import { UserRole } from "database";
import { z } from "zod";

import { authenticate, authorize } from "../../middleware/auth.js";
import {
  CATEGORIES,
  deleteCommission,
  deleteRate,
  getEmployees,
  getMonth,
  getRates,
  listCommissions,
  pay,
  payCommission,
  setRate,
  setSalary,
  undoPayment,
  updateCommission,
  updatePayment,
} from "./payroll.service.js";

const salarySchema = z.object({
  monthlySalary: z.coerce.number().min(0).max(100_000_000).nullable(),
});

const rateSchema = z.object({
  category: z.enum(CATEGORIES),
  userId: z.string().min(1).nullable().optional(),
  kind: z.enum(["PERCENT", "PER_UNIT"]),
  value: z.coerce.number().min(0).max(1_000_000),
});

const month = z.string().regex(/^\d{4}-\d{2}$/);

const paySchema = z.object({
  userId: z.string().min(1),
  month,
  salary: z.coerce.number().min(0).max(100_000_000).optional(),
  commission: z.coerce.number().min(0).max(100_000_000).optional(),
  bonus: z.coerce.number().min(0).max(100_000_000).default(0),
  deduction: z.coerce.number().min(0).max(100_000_000).default(0),
  note: z.string().max(300).optional(),
});

const money = z.coerce.number().min(0).max(100_000_000);
const editSchema = z.object({
  salary: money,
  commission: money,
  bonus: money.default(0),
  deduction: money.default(0),
  note: z.string().max(300).optional(),
});

const lines = z
  .array(
    z.object({
      // A category id, or "NATIONAL_ID".
      item: z.string().min(1),
      quantity: z.coerce.number().int().positive().max(1_000_000),
      unitPrice: z.coerce.number().positive().max(100_000_000),
      percent: z.coerce.number().min(0).max(100).nullable().optional(),
    }),
  )
  .min(1)
  .max(20);

const commissionSchema = z.object({
  userId: z.string().min(1),
  month,
  lines,
  note: z.string().max(300).optional(),
});

const commissionEditSchema = z.object({
  lines,
  note: z.string().max(300).optional(),
});

const MESSAGES: Record<string, [number, string]> = {
  NOT_FOUND: [404, "Not found"],
  NO_LINES: [400, "Add at least one item"],
  PRODUCT_NOT_FOUND: [404, "That item no longer exists"],
  ZERO_COMMISSION: [400, "Each item needs a quantity and a value"],
  ITEM_NOT_FOUND: [404, "That category no longer exists"],
  BAD_MONTH: [400, "Choose a month"],
  ALREADY_PAID: [409, "This month is already paid for this employee"],
  NEGATIVE_NET: [400, "The deduction is more than the pay"],
  PERCENT_TOO_HIGH: [400, "A percentage cannot be more than 100"],
};

function fail(reply: FastifyReply, error: unknown) {
  const known = error instanceof Error ? MESSAGES[error.message] : undefined;
  if (!known) throw error;
  return reply.status(known[0]).send({ message: known[1] });
}

/** Payroll is the Owner's alone: salaries and commission are not shared. */
export async function payrollRoutes(app: FastifyInstance) {
  app.addHook("preHandler", authenticate);
  app.addHook("preHandler", authorize(UserRole.OWNER));

  app.get("/employees", async () => ({ employees: await getEmployees() }));

  app.patch<{ Params: { id: string } }>("/employees/:id", async (request, reply) => {
    const result = salarySchema.safeParse(request.body);
    if (!result.success) return reply.status(400).send({ message: "Enter the salary" });

    try {
      return reply.send({ employee: await setSalary(request.params.id, result.data.monthlySalary) });
    } catch (error) {
      return fail(reply, error);
    }
  });

  app.get("/rates", async () => ({ rates: await getRates() }));

  app.put("/rates", async (request, reply) => {
    const result = rateSchema.safeParse(request.body);
    if (!result.success) return reply.status(400).send({ message: "Enter the commission" });

    try {
      return reply.send({ rate: await setRate(result.data) });
    } catch (error) {
      return fail(reply, error);
    }
  });

  app.delete<{ Params: { id: string } }>("/rates/:id", async (request, reply) => {
    await deleteRate(request.params.id);
    return reply.send({ message: "Removed" });
  });

  app.get<{ Querystring: { month?: string } }>("/month", async (request, reply) => {
    const now = new Date();
    const value =
      request.query.month ??
      `${now.getFullYear()}-${`${now.getMonth() + 1}`.padStart(2, "0")}`;

    try {
      return reply.send(await getMonth(value));
    } catch (error) {
      return fail(reply, error);
    }
  });

  app.post("/payments", async (request, reply) => {
    const result = paySchema.safeParse(request.body);
    if (!result.success) return reply.status(400).send({ message: "Check the payment" });

    try {
      return reply
        .status(201)
        .send({ payment: await pay(request.user.userId, result.data) });
    } catch (error) {
      return fail(reply, error);
    }
  });

  app.patch<{ Params: { id: string } }>("/payments/:id", async (request, reply) => {
    const result = editSchema.safeParse(request.body);
    if (!result.success) return reply.status(400).send({ message: "Check the payment" });

    try {
      return reply.send({ payment: await updatePayment(request.params.id, result.data) });
    } catch (error) {
      return fail(reply, error);
    }
  });

  app.get<{ Querystring: { month?: string } }>("/commissions", async (request, reply) => {
    const now = new Date();
    const value =
      request.query.month ??
      `${now.getFullYear()}-${`${now.getMonth() + 1}`.padStart(2, "0")}`;

    try {
      return reply.send({ commissions: await listCommissions(value) });
    } catch (error) {
      return fail(reply, error);
    }
  });

  app.post("/commissions", async (request, reply) => {
    const result = commissionSchema.safeParse(request.body);
    if (!result.success) return reply.status(400).send({ message: "Add the employee and at least one item with its amount" });

    try {
      return reply.status(201).send({ commission: await payCommission(request.user.userId, result.data) });
    } catch (error) {
      return fail(reply, error);
    }
  });

  app.patch<{ Params: { id: string } }>("/commissions/:id", async (request, reply) => {
    const result = commissionEditSchema.safeParse(request.body);
    if (!result.success) return reply.status(400).send({ message: "Add at least one item with its amount" });

    try {
      return reply.send({ commission: await updateCommission(request.params.id, result.data) });
    } catch (error) {
      return fail(reply, error);
    }
  });

  app.delete<{ Params: { id: string } }>("/commissions/:id", async (request, reply) => {
    try {
      await deleteCommission(request.params.id);
      return reply.send({ message: "Removed" });
    } catch (error) {
      return fail(reply, error);
    }
  });

  app.delete<{ Params: { id: string } }>("/payments/:id", async (request, reply) => {
    try {
      await undoPayment(request.params.id);
      return reply.send({ message: "Payment undone" });
    } catch (error) {
      return fail(reply, error);
    }
  });
}

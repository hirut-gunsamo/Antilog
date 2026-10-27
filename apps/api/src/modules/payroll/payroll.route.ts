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
  soldBy,
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
// The day the Owner paid, picked on a calendar: "2026-10-02".
const paidOn = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional();

const paySchema = z.object({
  userId: z.string().min(1),
  month,
  salary: z.coerce.number().min(0).max(100_000_000).optional(),
  commission: z.coerce.number().min(0).max(100_000_000).optional(),
  bonus: z.coerce.number().min(0).max(100_000_000).default(0),
  deduction: z.coerce.number().min(0).max(100_000_000).default(0),
  note: z.string().max(300).optional(),
  paidOn,
});

const money = z.coerce.number().min(0).max(100_000_000);
const editSchema = z.object({
  salary: money,
  commission: money,
  bonus: money.default(0),
  deduction: money.default(0),
  note: z.string().max(300).optional(),
  paidOn,
});

// The Owner gives each item's commission; how many comes from the sales.
const lines = z
  .array(
    z
      .object({
        // A category id, or "NATIONAL_ID".
        item: z.string().min(1),
        // Birr per item sold, or a percent of the sales when percent is set.
        rate: z.coerce.number().positive().max(100_000_000),
        percent: z.boolean().optional().default(false),
      })
      .refine((line) => !line.percent || line.rate <= 100),
  )
  .min(1)
  .max(20);

// The days whose sales the commission pays for.
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

const commissionSchema = z.object({
  // One or more people paid the same rates.
  userIds: z.array(z.string().min(1)).min(1).max(50),
  month,
  from: day,
  to: day,
  lines,
  note: z.string().max(300).optional(),
  paidOn,
});

const commissionEditSchema = z.object({
  from: day,
  to: day,
  lines,
  note: z.string().max(300).optional(),
  paidOn,
});

const MESSAGES: Record<string, [number, string]> = {
  NOT_FOUND: [404, "Not found"],
  NO_LINES: [400, "Add at least one item"],
  PRODUCT_NOT_FOUND: [404, "That item no longer exists"],
  NOTHING_SOLD: [400, "Nothing of these items was sold in these dates, so there is no commission"],
  BAD_DATES: [400, "Choose the dates: the first day, then the last"],
  ALREADY_PAID_DAYS: [409, "Commission was already paid for some of these days. Choose dates after the last payment."],
  ITEM_NOT_FOUND: [404, "That category no longer exists"],
  BAD_MONTH: [400, "Choose a month"],
  ALREADY_PAID: [409, "This month is already paid for this employee"],
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

  // What each person sold between two days, per item, and any of those days
  // already paid. ?from=2026-10-01&to=2026-10-15&userIds=a,b&except=paymentId
  app.get<{ Querystring: { from?: string; to?: string; userIds?: string; except?: string } }>("/sold", async (request, reply) => {
    const userIds = (request.query.userIds ?? "").split(",").filter(Boolean).slice(0, 50);

    try {
      const { sold } = await soldBy(
        userIds,
        { from: request.query.from ?? "", to: request.query.to ?? "" },
        { excludePaymentId: request.query.except },
      );
      return reply.send({
        sold: Object.fromEntries(
          [...sold].map(([userId, items]) => [userId, Object.fromEntries(items)]),
        ),
      });
    } catch (error) {
      return fail(reply, error);
    }
  });

  app.post("/commissions", async (request, reply) => {
    const result = commissionSchema.safeParse(request.body);
    if (!result.success) return reply.status(400).send({ message: "Add the employee and at least one item with its amount" });

    try {
      return reply.status(201).send(await payCommission(request.user.userId, result.data));
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

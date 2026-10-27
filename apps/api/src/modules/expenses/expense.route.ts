import type { FastifyInstance } from "fastify";
import { Prisma, UserRole } from "database";
import { z } from "zod";

import { authenticate, authorize, loadViewer } from "../../middleware/auth.js";
import { prisma } from "../../plugins/prisma.js";

/**
 * Expenses: money a branch paid out, with a reason. A salesperson records
 * what they paid from their own sales cash; a supervisor records for
 * themselves or for one of their salespeople. It comes off that person's
 * cash on hand, not their salary. The Owner reads them across branches.
 */

const createSchema = z.object({
  amount: z.coerce.number().positive().max(100_000_000),
  reason: z.string().trim().min(2).max(120),
  note: z.string().max(500).optional(),
  // "2026-09-30"; defaults to today.
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  // Supervisor only: the salesperson whose cash paid it. Defaults to them.
  spentById: z.string().min(1).optional(),
});

const day = (value: string) => new Date(`${value}T00:00:00`);

export async function expenseRoutes(app: FastifyInstance) {
  app.addHook("preHandler", authenticate);
  app.addHook("preHandler", authorize(UserRole.OWNER, UserRole.SUPERVISOR, UserRole.SALES));

  // The report: a salesperson sees their own, a supervisor their branch,
  // the Owner every branch.
  app.get<{ Querystring: { from?: string; to?: string; branchId?: string } }>(
    "/",
    async (request, reply) => {
      const viewer = await loadViewer(request);
      if (!viewer) return reply.status(403).send({ message: "User account is inactive" });

      const now = new Date();
      const from = request.query.from
        ? day(request.query.from)
        : new Date(now.getFullYear(), now.getMonth(), 1);
      const to = request.query.to ? day(request.query.to) : new Date(now.getFullYear(), now.getMonth(), now.getDate());
      to.setDate(to.getDate() + 1);

      const branchId =
        viewer.role === "OWNER" ? request.query.branchId || undefined : (viewer.branchId ?? "__none__");

      const rows = await prisma.expense.findMany({
        where: {
          expenseDate: { gte: from, lt: to },
          ...(branchId ? { locationId: branchId } : {}),
          ...(viewer.role === "SALES" ? { spentById: viewer.userId } : {}),
        },
        include: {
          location: { select: { id: true, name: true } },
          recordedBy: { select: { id: true, name: true } },
          spentBy: { select: { id: true, name: true } },
        },
        orderBy: [{ expenseDate: "desc" }, { createdAt: "desc" }],
      });

      const byBranch = new Map<string, { id: string; name: string; total: number; count: number }>();
      const byReason = new Map<string, { reason: string; total: number; count: number }>();

      for (const row of rows) {
        const amount = Number(row.amount);

        const branch = byBranch.get(row.locationId) ?? { id: row.locationId, name: row.location.name, total: 0, count: 0 };
        branch.total += amount;
        branch.count += 1;
        byBranch.set(row.locationId, branch);

        // Grouped case-blind, so "Transport" and "transport" add up.
        const key = row.reason.trim().toLowerCase();
        const label = row.reason.trim().charAt(0).toUpperCase() + row.reason.trim().slice(1);
        const reason = byReason.get(key) ?? { reason: label, total: 0, count: 0 };
        reason.total += amount;
        reason.count += 1;
        byReason.set(key, reason);
      }

      return reply.send({
        total: rows.reduce((sum, row) => sum + Number(row.amount), 0),
        byBranch: [...byBranch.values()].sort((a, b) => b.total - a.total),
        byReason: [...byReason.values()].sort((a, b) => b.total - a.total),
        expenses: rows.map((row) => ({
          id: row.id,
          amount: row.amount.toString(),
          reason: row.reason,
          note: row.note,
          expenseDate: row.expenseDate.toISOString(),
          createdAt: row.createdAt.toISOString(),
          branch: row.location,
          recordedBy: row.recordedBy,
          spentBy: row.spentBy,
        })),
      });
    },
  );

  // A salesperson records their own; a supervisor their own or a
  // salesperson's in their branch.
  app.post("/", { preHandler: [authorize(UserRole.SUPERVISOR, UserRole.SALES)] }, async (request, reply) => {
    const viewer = await loadViewer(request);
    if (!viewer?.branchId) return reply.status(403).send({ message: "You need a branch to record expenses" });

    const result = createSchema.safeParse(request.body);
    if (!result.success) return reply.status(400).send({ message: "Enter the amount and the reason" });

    let spentById = viewer.userId;
    if (viewer.role === "SUPERVISOR" && result.data.spentById && result.data.spentById !== viewer.userId) {
      const person = await prisma.user.findFirst({
        where: { id: result.data.spentById, branchId: viewer.branchId, isActive: true },
        select: { id: true },
      });
      if (!person) return reply.status(400).send({ message: "Choose a salesperson in your branch" });
      spentById = person.id;
    }

    const expense = await prisma.expense.create({
      data: {
        locationId: viewer.branchId,
        amount: new Prisma.Decimal(result.data.amount),
        reason: result.data.reason,
        note: result.data.note?.trim() || null,
        expenseDate: result.data.date ? day(result.data.date) : new Date(),
        recordedById: viewer.userId,
        spentById,
      },
    });

    return reply.status(201).send({ expense });
  });

  // Mistakes: the supervisor who recorded it, or the Owner, may delete.
  app.delete<{ Params: { id: string } }>("/:id", async (request, reply) => {
    const viewer = await loadViewer(request);
    if (!viewer) return reply.status(403).send({ message: "User account is inactive" });

    const expense = await prisma.expense.findUnique({
      where: { id: request.params.id },
      select: { id: true, recordedById: true },
    });
    if (!expense) return reply.status(404).send({ message: "Expense not found" });

    if (viewer.role !== "OWNER" && expense.recordedById !== viewer.userId) {
      return reply.status(403).send({ message: "You can only delete expenses you recorded" });
    }

    await prisma.expense.delete({ where: { id: expense.id } });
    return reply.send({ message: "Deleted" });
  });
}

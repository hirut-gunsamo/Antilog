import { Prisma } from "database";
import { withBranchPrice } from "../products/branchPrice.js";

import type { Viewer } from "../../middleware/auth.js";
import { prisma } from "../../plugins/prisma.js";

/**
 * Deductions: money taken off someone's pay for goods short or lost on a
 * day, or a plain amount (money received by mistake, cash short). Supervisors and salespeople record their own; the Owner sees and may
 * record for anyone. Pay Salary fills its deduction with the month's total.
 */

const include = {
  user: {
    select: { id: true, name: true, role: true, branch: { select: { id: true, name: true } } },
  },
  recordedBy: { select: { id: true, name: true } },
  lines: {
    select: { id: true, productId: true, label: true, quantity: true, unitPrice: true, amount: true },
  },
} as const;

export async function listDeductions(
  viewer: Viewer,
  query: { month: string; userId?: string; branchId?: string },
) {
  const scope: Prisma.DeductionWhereInput =
    viewer.role === "OWNER"
      ? {
          ...(query.userId ? { userId: query.userId } : {}),
          ...(query.branchId ? { user: { branchId: query.branchId } } : {}),
        }
      : { userId: viewer.userId };

  return prisma.deduction.findMany({
    where: { ...scope, day: { startsWith: query.month } },
    include,
    orderBy: [{ day: "desc" }, { createdAt: "desc" }],
  });
}

export async function createDeduction(
  viewer: Viewer,
  data: {
    day: string;
    userId?: string;
    note?: string;
    /** Money with no item behind it. */
    amount?: number;
    lines: { productId: string; quantity: number; amount?: number }[];
  },
) {
  // Anyone below the Owner records their own; the Owner names the person.
  const userId = viewer.role === "OWNER" ? data.userId : viewer.userId;
  if (!userId) throw new Error("EMPLOYEE_REQUIRED");

  const person = await prisma.user.findUnique({ where: { id: userId }, select: { role: true, branchId: true } });
  if (!person || person.role === "OWNER") throw new Error("EMPLOYEE_REQUIRED");

  // Charged at what the item sells for at the person's branch.
  const products = await withBranchPrice(
    person.branchId,
    await prisma.product.findMany({
      where: { id: { in: data.lines.map((line) => line.productId) } },
      select: { id: true, name: true, price: true },
    }),
  );
  const byId = new Map(products.map((product) => [product.id, product]));

  // Each item costs its selling price times how many, unless the amount was
  // changed on the form.
  const lines = data.lines.map((line) => {
    const product = byId.get(line.productId);
    if (!product) throw new Error("PRODUCT_NOT_FOUND");

    const unitPrice = product.price.toNumber();
    const amount = line.amount ?? unitPrice * line.quantity;

    return {
      productId: product.id,
      label: product.name,
      quantity: line.quantity,
      unitPrice: new Prisma.Decimal(unitPrice),
      amount: new Prisma.Decimal(amount),
    };
  });

  // A plain amount is kept as a line of its own, with no product, so the
  // deduction still reads as one list of what was taken off.
  const money = data.amount ?? 0;
  const allLines = [
    ...lines,
    ...(money > 0
      ? [{
          productId: null,
          label: data.note?.trim() || "Money",
          quantity: 1,
          unitPrice: new Prisma.Decimal(money),
          amount: new Prisma.Decimal(money),
        }]
      : []),
  ];

  const total = allLines.reduce((sum, line) => sum + line.amount.toNumber(), 0);

  return prisma.deduction.create({
    data: {
      userId,
      day: data.day,
      total: new Prisma.Decimal(total),
      note: data.note?.trim() || null,
      recordedById: viewer.userId,
      lines: { create: allLines },
    },
    include,
  });
}

/**
 * The Owner removes any. Anyone else only their own, and only while that
 * month's salary has not been paid: once paid, the deduction is part of it.
 */
export async function deleteDeduction(viewer: Viewer, id: string) {
  const row = await prisma.deduction.findUnique({
    where: { id },
    select: { userId: true, day: true },
  });
  if (!row) throw new Error("NOT_FOUND");

  if (viewer.role !== "OWNER") {
    if (row.userId !== viewer.userId) throw new Error("NOT_FOUND");

    const paid = await prisma.payrollPayment.findFirst({
      where: { userId: row.userId, month: row.day.slice(0, 7) },
      select: { id: true },
    });
    if (paid) throw new Error("ALREADY_PAID");
  }

  await prisma.deduction.delete({ where: { id } });
}

/** Each person's deductions for a month, added up: what Pay Salary takes off. */
export async function deductedIn(month: string) {
  const rows = await prisma.deduction.groupBy({
    by: ["userId"],
    where: { day: { startsWith: month } },
    _sum: { total: true },
  });

  return new Map(rows.map((row) => [row.userId, row._sum.total?.toNumber() ?? 0]));
}

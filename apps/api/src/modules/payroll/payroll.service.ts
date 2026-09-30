import { Prisma } from "database";

import { prisma } from "../../plugins/prisma.js";

/**
 * Payroll: monthly salaries, commission on sales, and what was paid.
 *
 * Commission is set by the Owner per product category, as a percentage of
 * sales or birr per item sold, and may differ for one employee. A month's
 * commission comes from that person's approved sales in the month. Paying
 * stores the figures as they stood, so a later rate change never rewrites
 * what was already paid.
 */

export const CATEGORIES = ["AIRTIME_VOUCHER", "PHONE", "SIM_CARD"] as const;
type Category = (typeof CATEGORIES)[number];

export type RateKind = "PERCENT" | "PER_UNIT";

/** "2026-09" -> local month start and the start of the next. */
export function monthRange(month: string) {
  const match = /^(\d{4})-(\d{2})$/.exec(month);
  if (!match) throw new Error("BAD_MONTH");

  const start = new Date(Number(match[1]), Number(match[2]) - 1, 1);
  const end = new Date(Number(match[1]), Number(match[2]), 1);
  return { start, end };
}

/** Everyone the Owner pays: supervisors and salespeople, active or not. */
export async function getEmployees() {
  return prisma.user.findMany({
    where: { role: { not: "OWNER" } },
    select: {
      id: true,
      name: true,
      role: true,
      isActive: true,
      monthlySalary: true,
      branch: { select: { id: true, name: true } },
    },
    orderBy: [{ isActive: "desc" }, { name: "asc" }],
  });
}

export async function setSalary(userId: string, monthlySalary: number | null) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { role: true },
  });

  if (!user || user.role === "OWNER") throw new Error("NOT_FOUND");

  return prisma.user.update({
    where: { id: userId },
    data: {
      monthlySalary:
        monthlySalary == null ? null : new Prisma.Decimal(monthlySalary),
    },
    select: { id: true, monthlySalary: true },
  });
}

export async function getRates() {
  return prisma.commissionRate.findMany({
    include: { user: { select: { id: true, name: true } } },
    orderBy: [{ category: "asc" }, { createdAt: "asc" }],
  });
}

/** Creates or replaces the rate for a category (and employee, if given). */
export async function setRate(data: {
  category: Category;
  userId?: string | null;
  kind: RateKind;
  value: number;
}) {
  if (data.kind === "PERCENT" && data.value > 100) {
    throw new Error("PERCENT_TOO_HIGH");
  }

  const userId = data.userId || null;
  const existing = await prisma.commissionRate.findFirst({
    where: { category: data.category, userId },
    select: { id: true },
  });

  const values = {
    kind: data.kind,
    value: new Prisma.Decimal(data.value),
  };

  return existing
    ? prisma.commissionRate.update({ where: { id: existing.id }, data: values })
    : prisma.commissionRate.create({
        data: { category: data.category, userId, ...values },
      });
}

export async function deleteRate(id: string) {
  await prisma.commissionRate.deleteMany({ where: { id } });
}

type Figures = { units: number; sales: number; commission: number };

/**
 * Commission earned in a month, per employee and category. An employee's own
 * rate wins over the everyone-rate; no rate means no commission.
 */
async function commissionFor(month: string) {
  const { start, end } = monthRange(month);

  const [items, rates] = await Promise.all([
    prisma.saleItem.findMany({
      where: {
        sale: { status: "APPROVED", saleDate: { gte: start, lt: end } },
      },
      select: {
        quantity: true,
        lineTotal: true,
        product: { select: { category: true } },
        sale: { select: { salespersonId: true } },
      },
    }),
    prisma.commissionRate.findMany(),
  ]);

  const rateFor = (userId: string, category: string) =>
    rates.find((rate) => rate.category === category && rate.userId === userId) ??
    rates.find((rate) => rate.category === category && rate.userId === null);

  const byUser = new Map<string, Record<Category, Figures>>();

  for (const item of items) {
    const userId = item.sale.salespersonId;
    const category = item.product.category as Category;
    const figures =
      byUser.get(userId) ??
      (Object.fromEntries(
        CATEGORIES.map((key) => [key, { units: 0, sales: 0, commission: 0 }]),
      ) as Record<Category, Figures>);

    const cell = figures[category];
    const line = item.lineTotal.toNumber();
    const rate = rateFor(userId, category);

    cell.units += item.quantity;
    cell.sales += line;

    if (rate) {
      cell.commission +=
        rate.kind === "PERCENT"
          ? (line * rate.value.toNumber()) / 100
          : item.quantity * rate.value.toNumber();
    }

    byUser.set(userId, figures);
  }

  // Birr to the cent, so a percentage never leaves a long tail.
  for (const figures of byUser.values()) {
    for (const key of CATEGORIES) {
      figures[key].commission = Math.round(figures[key].commission * 100) / 100;
    }
  }

  return byUser;
}

const zero = (): Record<Category, Figures> =>
  Object.fromEntries(
    CATEGORIES.map((key) => [key, { units: 0, sales: 0, commission: 0 }]),
  ) as Record<Category, Figures>;

/**
 * One month's payroll: each employee's salary, commission by category, and
 * the payment if it has been made. An unpaid row shows today's figures; a
 * paid row shows what was actually paid.
 */
export async function getMonth(month: string) {
  monthRange(month);

  const [employees, commission, payments] = await Promise.all([
    getEmployees(),
    commissionFor(month),
    prisma.payrollPayment.findMany({
      where: { month },
      include: { paidBy: { select: { name: true } } },
    }),
  ]);

  const rows = employees
    .map((employee) => {
      const byCategory = commission.get(employee.id) ?? zero();
      const payment = payments.find((row) => row.userId === employee.id);
      const earned = CATEGORIES.reduce(
        (sum, key) => sum + byCategory[key].commission,
        0,
      );
      const salary = employee.monthlySalary?.toNumber() ?? 0;

      return {
        employee: {
          id: employee.id,
          name: employee.name,
          role: employee.role,
          isActive: employee.isActive,
          branch: employee.branch,
          monthlySalary: employee.monthlySalary?.toString() ?? null,
        },
        byCategory,
        salary: payment ? payment.salary.toNumber() : salary,
        commission: payment ? payment.commission.toNumber() : earned,
        payment: payment
          ? {
              id: payment.id,
              bonus: payment.bonus.toNumber(),
              deduction: payment.deduction.toNumber(),
              net: payment.net.toNumber(),
              note: payment.note,
              paidAt: payment.paidAt.toISOString(),
              paidBy: payment.paidBy.name,
            }
          : null,
      };
    })
    // A deactivated employee only shows in a month they earned or were paid.
    .filter(
      (row) =>
        row.employee.isActive ||
        row.payment ||
        row.commission > 0,
    );

  const totals = rows.reduce(
    (acc, row) => {
      acc.salary += row.salary;
      acc.commission += row.commission;
      if (row.payment) acc.paid += row.payment.net;
      else acc.unpaid += row.salary + row.commission;
      return acc;
    },
    { salary: 0, commission: 0, paid: 0, unpaid: 0 },
  );

  return { month, rows, totals };
}

export async function pay(
  paidById: string,
  data: {
    userId: string;
    month: string;
    // Typed on the form; each person's salary differs month to month.
    salary?: number;
    commission?: number;
    bonus: number;
    deduction: number;
    note?: string;
  },
) {
  const { rows } = await getMonth(data.month);
  const row = rows.find((entry) => entry.employee.id === data.userId);

  if (!row) throw new Error("NOT_FOUND");
  if (row.payment) throw new Error("ALREADY_PAID");

  const salary = data.salary ?? row.salary;
  const commission = data.commission ?? row.commission;
  const net = salary + commission + data.bonus - data.deduction;
  if (net < 0) throw new Error("NEGATIVE_NET");

  try {
    return await prisma.payrollPayment.create({
      data: {
        userId: data.userId,
        month: data.month,
        salary: new Prisma.Decimal(salary),
        commission: new Prisma.Decimal(commission),
        bonus: new Prisma.Decimal(data.bonus),
        deduction: new Prisma.Decimal(data.deduction),
        net: new Prisma.Decimal(net),
        note: data.note?.trim() || null,
        paidById,
      },
    });
  } catch (error) {
    // Two clicks at once: the unique (userId, month) index keeps one.
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      throw new Error("ALREADY_PAID");
    }
    throw error;
  }
}

/** Corrects a recorded payment; the net is worked out again. */
export async function updatePayment(
  id: string,
  data: {
    salary: number;
    commission: number;
    bonus: number;
    deduction: number;
    note?: string;
  },
) {
  const net = data.salary + data.commission + data.bonus - data.deduction;
  if (net < 0) throw new Error("NEGATIVE_NET");

  const existing = await prisma.payrollPayment.findUnique({ where: { id }, select: { id: true } });
  if (!existing) throw new Error("NOT_FOUND");

  return prisma.payrollPayment.update({
    where: { id },
    data: {
      salary: new Prisma.Decimal(data.salary),
      commission: new Prisma.Decimal(data.commission),
      bonus: new Prisma.Decimal(data.bonus),
      deduction: new Prisma.Decimal(data.deduction),
      net: new Prisma.Decimal(net),
      note: data.note?.trim() || null,
    },
  });
}

/** Undoes a payment recorded by mistake; the month goes back to unpaid. */
export async function undoPayment(id: string) {
  const { count } = await prisma.payrollPayment.deleteMany({ where: { id } });
  if (count === 0) throw new Error("NOT_FOUND");
}

/* ---------------------------------------------------------------------------
   Commission paid by hand: an employee, and one line per item with its amount.
   --------------------------------------------------------------------------- */

/** A commission line's item: one of the Owner's categories, or National ID. */
export const NATIONAL_ID = "NATIONAL_ID";

type Line = {
  item: string;
  quantity: number;
  unitPrice: number;
  /** Airtime only: a percent of quantity x value. Left out, the commission
   * is quantity x value itself. */
  percent?: number | null;
};

type PricedLine = Line & {
  amount: number;
  category: "SIM_CARD" | "PHONE" | "AIRTIME_VOUCHER" | "OTHER";
  categoryId: string | null;
  label: string;
};

const commissionInclude = {
  lines: {
    select: {
      id: true,
      category: true,
      categoryId: true,
      label: true,
      amount: true,
      quantity: true,
      unitPrice: true,
      percent: true,
      product: { select: { id: true, name: true, sku: true } },
    },
  },
  user: {
    select: {
      id: true,
      name: true,
      role: true,
      branch: { select: { id: true, name: true } },
    },
  },
  paidBy: { select: { name: true } },
} as const;

export async function listCommissions(month: string) {
  monthRange(month);

  return prisma.commissionPayment.findMany({
    where: { month },
    include: commissionInclude,
    orderBy: { paidAt: "desc" },
  });
}

/**
 * Each line's commission: quantity x price x percent. The item is one of the
 * Owner's categories (built-in or added) or National ID; its name is kept on
 * the line so the report reads the same after a rename.
 */
async function price(lines: Line[]): Promise<PricedLine[]> {
  if (lines.length === 0) throw new Error("NO_LINES");

  const categories = await prisma.category.findMany({
    where: { id: { in: lines.map((line) => line.item) } },
    select: { id: true, name: true, kind: true },
  });

  return lines.map((line) => {
    const base = line.quantity * line.unitPrice;
    const amount = Math.round((line.percent ? (base * line.percent) / 100 : base) * 100) / 100;
    if (amount <= 0) throw new Error("ZERO_COMMISSION");

    if (line.item === NATIONAL_ID) {
      return { ...line, amount, category: "OTHER" as const, categoryId: null, label: "National ID" };
    }

    const category = categories.find((entry) => entry.id === line.item);
    if (!category) throw new Error("ITEM_NOT_FOUND");

    return { ...line, amount, category: category.kind, categoryId: category.id, label: category.name };
  });
}

const totalOf = (lines: PricedLine[]) =>
  lines.reduce((sum, line) => sum + line.amount, 0);

const lineData = (line: PricedLine) => ({
  category: line.category,
  categoryId: line.categoryId,
  label: line.label,
  quantity: line.quantity,
  unitPrice: new Prisma.Decimal(line.unitPrice),
  percent: line.percent ? new Prisma.Decimal(line.percent) : null,
  amount: new Prisma.Decimal(line.amount),
});

export async function payCommission(
  paidById: string,
  data: { userId: string; month: string; lines: Line[]; note?: string },
) {
  monthRange(data.month);

  const user = await prisma.user.findUnique({
    where: { id: data.userId },
    select: { role: true },
  });
  if (!user || user.role === "OWNER") throw new Error("NOT_FOUND");

  const lines = await price(data.lines);

  return prisma.commissionPayment.create({
    data: {
      userId: data.userId,
      month: data.month,
      total: new Prisma.Decimal(totalOf(lines)),
      note: data.note?.trim() || null,
      paidById,
      lines: { create: lines.map(lineData) },
    },
    include: commissionInclude,
  });
}

/** Replaces the lines of a commission payment. */
export async function updateCommission(
  id: string,
  data: { lines: Line[]; note?: string },
) {
  const lines = await price(data.lines);
  const total = totalOf(lines);

  return prisma.$transaction(async (tx) => {
    const existing = await tx.commissionPayment.findUnique({ where: { id }, select: { id: true } });
    if (!existing) throw new Error("NOT_FOUND");

    await tx.commissionLine.deleteMany({ where: { paymentId: id } });

    return tx.commissionPayment.update({
      where: { id },
      data: {
        total: new Prisma.Decimal(total),
        note: data.note?.trim() || null,
        lines: { create: lines.map(lineData) },
      },
      include: commissionInclude,
    });
  });
}

export async function deleteCommission(id: string) {
  const { count } = await prisma.commissionPayment.deleteMany({ where: { id } });
  if (count === 0) throw new Error("NOT_FOUND");
}

import { Prisma } from "database";

import { prisma } from "../../plugins/prisma.js";
import { deductedIn } from "../deductions/deduction.service.js";

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

  const [employees, commission, payments, deducted, carried] = await Promise.all([
    getEmployees(),
    commissionFor(month),
    prisma.payrollPayment.findMany({
      where: { month },
      include: { paidBy: { select: { name: true } } },
    }),
    deductedIn(month),
    carriedInto(month),
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
        // What they recorded on the Deductions page this month, plus what
        // their last salary could not cover.
        deducted: (deducted.get(employee.id) ?? 0) + (carried.get(employee.id) ?? 0),
        carriedIn: carried.get(employee.id) ?? 0,
        payment: payment
          ? {
              id: payment.id,
              bonus: payment.bonus.toNumber(),
              deduction: payment.deduction.toNumber(),
              net: payment.net.toNumber(),
              carriedOver: payment.carriedOver.toNumber(),
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

/**
 * Pay never goes below 0: deduction it cannot cover is carried over and
 * added to the next salary's deduction.
 */
function settle(gross: number, deduction: number) {
  const left = Math.round((gross - deduction) * 100) / 100;
  return left >= 0 ? { net: left, carriedOver: 0 } : { net: 0, carriedOver: -left };
}

/**
 * What each person's last salary before this month could not cover. Only the
 * latest earlier payment counts: anything older was already carried into it.
 */
async function carriedInto(month: string) {
  const earlier = await prisma.payrollPayment.findMany({
    where: { month: { lt: month } },
    select: { userId: true, carriedOver: true },
    orderBy: { month: "desc" },
  });

  const carried = new Map<string, number>();
  const seen = new Set<string>();
  for (const row of earlier) {
    if (seen.has(row.userId)) continue;
    seen.add(row.userId);
    if (row.carriedOver.toNumber() > 0) carried.set(row.userId, row.carriedOver.toNumber());
  }
  return carried;
}

// A calendar day as midday local time, so no time zone moves it a day.
function paidDate(day: string) {
  return new Date(`${day}T12:00:00`);
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
    /** The day it was paid; today when not given. */
    paidOn?: string;
  },
) {
  const { rows } = await getMonth(data.month);
  const row = rows.find((entry) => entry.employee.id === data.userId);

  if (!row) throw new Error("NOT_FOUND");
  if (row.payment) throw new Error("ALREADY_PAID");

  const salary = data.salary ?? row.salary;
  const commission = data.commission ?? row.commission;
  const { net, carriedOver } = settle(salary + commission + data.bonus, data.deduction);

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
        carriedOver: new Prisma.Decimal(carriedOver),
        note: data.note?.trim() || null,
        paidById,
        ...(data.paidOn ? { paidAt: paidDate(data.paidOn) } : {}),
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
    paidOn?: string;
  },
) {
  const { net, carriedOver } = settle(
    data.salary + data.commission + data.bonus,
    data.deduction,
  );

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
      carriedOver: new Prisma.Decimal(carriedOver),
      note: data.note?.trim() || null,
      ...(data.paidOn ? { paidAt: paidDate(data.paidOn) } : {}),
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

/** What the Owner gives for one item: the commission, not the quantity. */
type Line = {
  item: string;
  /** Birr per item sold, or a percent of the sales when percent is set. */
  rate: number;
  percent?: boolean;
};

type PricedLine = {
  quantity: number;
  unitPrice: number;
  percent: number | null;
  amount: number;
  periodStart: Date;
  periodEnd: Date;
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
      periodStart: true,
      periodEnd: true,
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

/** A paid period that overlaps the dates asked about. */
type Overlap = { from: Date; to: Date };
type Sold = { quantity: number; sales: number; paid: Overlap | null };

/** "2026-10-01" .. "2026-10-15" as [start of the 1st, start of the 16th). */
export function dayRange(from: string, to: string) {
  const start = new Date(`${from}T00:00:00`);
  const end = new Date(`${to}T00:00:00`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end < start) {
    throw new Error("BAD_DATES");
  }
  end.setDate(end.getDate() + 1);
  return { start, end };
}

/**
 * Commission already paid to each person for each item over dates that
 * overlap these: "userId|item" -> that paid period. One payment can be left
 * out, so editing it does not count against itself.
 */
async function paidOverlapping(userIds: string[], start: Date, end: Date, excludePaymentId?: string) {
  const lines = await prisma.commissionLine.findMany({
    where: {
      periodStart: { lt: end },
      periodEnd: { gt: start },
      payment: {
        userId: { in: userIds },
        ...(excludePaymentId ? { id: { not: excludePaymentId } } : {}),
      },
    },
    select: {
      categoryId: true,
      label: true,
      periodStart: true,
      periodEnd: true,
      payment: { select: { userId: true } },
    },
  });

  const paid = new Map<string, Overlap>();
  for (const line of lines) {
    const item = line.categoryId ?? (line.label === "National ID" ? NATIONAL_ID : null);
    if (!item || !line.periodStart || !line.periodEnd) continue;
    // The last day paid is the day before the period's end.
    const to = new Date(line.periodEnd.getTime() - 1);
    paid.set(`${line.payment.userId}|${item}`, { from: line.periodStart, to });
  }
  return paid;
}

/**
 * What each person sold between two days, per item: each of the Owner's
 * categories by its id, and National ID work by "NATIONAL_ID". Counted from
 * the sales and records themselves, so a commission's quantity is never typed
 * in. Where commission was already paid for some of those days, it says so,
 * so the same sales are not paid twice.
 */
export async function soldBy(
  userIds: string[],
  dates: { from: string; to: string },
  options: { excludePaymentId?: string } = {},
) {
  const { start, end } = dayRange(dates.from, dates.to);

  // A supervisor sells nothing themselves: their commission is on what the
  // whole branch sold, every salesperson's sales added up.
  const supervisors = await prisma.user.findMany({
    where: { id: { in: userIds }, role: "SUPERVISOR", branchId: { not: null } },
    select: { id: true, branchId: true },
  });
  const branchOf = new Map(supervisors.map((row) => [row.id, row.branchId!]));
  const supervisorsAt = new Map<string, string[]>();
  for (const [id, branchId] of branchOf) supervisorsAt.set(branchId, [...(supervisorsAt.get(branchId) ?? []), id]);
  const branchIds = [...supervisorsAt.keys()];

  const [items, nid, paid] = await Promise.all([
    prisma.saleItem.findMany({
      where: {
        sale: {
          status: "APPROVED",
          saleDate: { gte: start, lt: end },
          OR: [{ salespersonId: { in: userIds } }, ...(branchIds.length ? [{ locationId: { in: branchIds } }] : [])],
        },
      },
      select: {
        quantity: true,
        lineTotal: true,
        product: { select: { categoryId: true } },
        sale: { select: { salespersonId: true, locationId: true } },
      },
    }),
    // National ID sold: each customer registered (original or copy) is one,
    // at the price charged. The same records the daily sales report counts.
    prisma.nationalIdOrder.findMany({
      where: {
        createdAt: { gte: start, lt: end },
        OR: [{ recordedById: { in: userIds } }, ...(branchIds.length ? [{ locationId: { in: branchIds } }] : [])],
      },
      select: { recordedById: true, locationId: true, price: true },
    }),
    paidOverlapping(userIds, start, end, options.excludePaymentId),
  ]);

  const sold = new Map<string, Map<string, Sold>>();
  const cell = (userId: string, item: string) => {
    const person = sold.get(userId) ?? new Map<string, Sold>();
    const found = person.get(item) ?? { quantity: 0, sales: 0, paid: paid.get(`${userId}|${item}`) ?? null };
    person.set(item, found);
    sold.set(userId, person);
    return found;
  };

  for (const key of paid.keys()) {
    const [userId, item] = key.split("|");
    cell(userId, item);
  }

  // Who a sale counts for: the seller (if asked about) and the supervisors
  // of the branch it was made at.
  const countFor = (sellerId: string, locationId: string) => {
    const people = new Set<string>(supervisorsAt.get(locationId) ?? []);
    if (userIds.includes(sellerId) && !branchOf.has(sellerId)) people.add(sellerId);
    return [...people];
  };

  for (const item of items) {
    if (!item.product.categoryId) continue;
    for (const userId of countFor(item.sale.salespersonId, item.sale.locationId)) {
      const found = cell(userId, item.product.categoryId);
      found.quantity += item.quantity;
      found.sales += item.lineTotal.toNumber();
    }
  }

  for (const row of nid) {
    for (const userId of countFor(row.recordedById, row.locationId)) {
      const found = cell(userId, NATIONAL_ID);
      found.quantity += 1;
      found.sales += row.price.toNumber();
    }
  }

  return { sold, start, end };
}

/**
 * One person's commission lines for the chosen days: quantity is what they
 * sold of each item, and the commission is that times the rate, or the rate
 * percent of the sales (airtime). An item they sold none of earns nothing
 * and is left out; an item already paid for any of those days is refused.
 * Each line keeps the days it paid for, and the item's name so the report
 * reads the same after a rename.
 */
async function price(
  userId: string,
  dates: { from: string; to: string },
  lines: Line[],
  options: { excludePaymentId?: string } = {},
): Promise<PricedLine[]> {
  if (lines.length === 0) throw new Error("NO_LINES");

  const [{ sold, start, end }, categories] = await Promise.all([
    soldBy([userId], dates, options),
    prisma.category.findMany({
      where: { id: { in: lines.map((line) => line.item) } },
      select: { id: true, name: true, kind: true },
    }),
  ]);
  const mine = sold.get(userId) ?? new Map<string, Sold>();

  const priced: PricedLine[] = [];
  for (const line of lines) {
    const { quantity, sales, paid } = mine.get(line.item) ?? { quantity: 0, sales: 0, paid: null };
    if (paid) throw new Error("ALREADY_PAID_DAYS");

    const raw = line.percent ? (sales * line.rate) / 100 : quantity * line.rate;
    const amount = Math.round(raw * 100) / 100;
    if (quantity === 0 || amount <= 0) continue;

    const figures = {
      quantity,
      // For a percent line, the average price the items sold at.
      unitPrice: line.percent ? Math.round((sales / quantity) * 100) / 100 : line.rate,
      percent: line.percent ? line.rate : null,
      amount,
      periodStart: start,
      periodEnd: end,
    };

    if (line.item === NATIONAL_ID) {
      priced.push({ ...figures, category: "OTHER", categoryId: null, label: "National ID" });
      continue;
    }

    const category = categories.find((entry) => entry.id === line.item);
    if (!category) throw new Error("ITEM_NOT_FOUND");
    priced.push({ ...figures, category: category.kind, categoryId: category.id, label: category.name });
  }

  return priced;
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
  periodStart: line.periodStart,
  periodEnd: line.periodEnd,
});

/**
 * Pays the same commission rates to one or more people. Each gets their own
 * payment, priced from what they themselves sold; anyone who sold none of
 * the items is skipped and named back.
 */
export async function payCommission(
  paidById: string,
  data: {
    userIds: string[];
    month: string;
    /** The days whose sales are paid for: "2026-10-01" .. "2026-10-15". */
    from: string;
    to: string;
    lines: Line[];
    note?: string;
    paidOn?: string;
  },
) {
  monthRange(data.month);

  const people = await prisma.user.findMany({
    where: { id: { in: data.userIds }, role: { not: "OWNER" } },
    select: { id: true, name: true },
  });
  if (people.length !== new Set(data.userIds).size) throw new Error("NOT_FOUND");

  const priced = await Promise.all(
    people.map(async (person) => ({ person, lines: await price(person.id, data, data.lines) })),
  );
  const payable = priced.filter((entry) => entry.lines.length > 0);
  if (payable.length === 0) throw new Error("NOTHING_SOLD");

  const commissions = await prisma.$transaction(
    payable.map(({ person, lines }) =>
      prisma.commissionPayment.create({
        data: {
          userId: person.id,
          month: data.month,
          total: new Prisma.Decimal(totalOf(lines)),
          note: data.note?.trim() || null,
          paidById,
          ...(data.paidOn ? { paidAt: paidDate(data.paidOn) } : {}),
          lines: { create: lines.map(lineData) },
        },
        include: commissionInclude,
      }),
    ),
  );

  return {
    commissions,
    skipped: priced.filter((entry) => entry.lines.length === 0).map((entry) => entry.person.name),
  };
}

/** Replaces the lines of a commission payment, priced again from the sales. */
export async function updateCommission(
  id: string,
  data: { from: string; to: string; lines: Line[]; note?: string; paidOn?: string },
) {
  const existing = await prisma.commissionPayment.findUnique({
    where: { id },
    select: { userId: true },
  });
  if (!existing) throw new Error("NOT_FOUND");

  const lines = await price(existing.userId, data, data.lines, { excludePaymentId: id });
  if (lines.length === 0) throw new Error("NOTHING_SOLD");
  const total = totalOf(lines);

  return prisma.$transaction(async (tx) => {
    await tx.commissionLine.deleteMany({ where: { paymentId: id } });

    return tx.commissionPayment.update({
      where: { id },
      data: {
        total: new Prisma.Decimal(total),
        note: data.note?.trim() || null,
        ...(data.paidOn ? { paidAt: paidDate(data.paidOn) } : {}),
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

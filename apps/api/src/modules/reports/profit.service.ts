import { Prisma } from "database";

import { prisma } from "../../plugins/prisma.js";

/**
 * Profit and loss for the Owner, over a date range and optionally one branch.
 *
 * Income is item sales plus National ID money. Costs are what the items sold
 * cost to buy, branch expenses, what payroll actually paid (salary, commission
 * and bonus less deductions), commission paid separately, stock written off
 * as damaged or lost, and office equipment bought. Profit is the difference.
 *
 * Every amount is filed under its day and its branch, so the same figures
 * add up to the statement, the branch table, the day-by-day table and each
 * branch's sales per day.
 *
 * Each sale line keeps the buying price it had when sold; lines sold before a
 * price was entered fall back to today's buying price, and lines with none at
 * all are counted apart so the Owner can see what the figure is missing.
 */

export type ProfitQuery = { from?: string; to?: string; branchId?: string };

const FIELDS = [
  "sales",
  "nationalId",
  "goods",
  "expenses",
  "payroll",
  "commission",
  "losses",
  "equipment",
] as const;
type Field = (typeof FIELDS)[number];
type Totals = Record<Field, number>;

const COSTS: Field[] = ["goods", "expenses", "payroll", "commission", "losses", "equipment"];
const OFFICE = "__office__";

const money = (value: Prisma.Decimal | number | null | undefined) => Number(value ?? 0);
const round = (value: number) => Math.round(value * 100) / 100;
const empty = (): Totals => Object.fromEntries(FIELDS.map((field) => [field, 0])) as Totals;

/** A date as the local day it falls on, "2026-10-04". */
function dayOf(date: Date) {
  return `${date.getFullYear()}-${`${date.getMonth() + 1}`.padStart(2, "0")}-${`${date.getDate()}`.padStart(2, "0")}`;
}

/** "2026-10-01".."2026-10-31" as local day bounds; this month when left out. */
function bounds(from?: string, to?: string) {
  const now = new Date();
  const start = from ? new Date(`${from}T00:00:00`) : new Date(now.getFullYear(), now.getMonth(), 1);
  const end = to ? new Date(`${to}T23:59:59.999`) : now;
  return { start, end };
}

/** Income, costs and profit worked out from a set of totals. */
function settle(totals: Totals) {
  const rounded = Object.fromEntries(FIELDS.map((field) => [field, round(totals[field])])) as Totals;
  const income = round(totals.sales + totals.nationalId);
  const costs = round(COSTS.reduce((sum, field) => sum + totals[field], 0));
  return { ...rounded, income, costs, profit: round(income - costs) };
}

export async function getProfitAndLoss(query: ProfitQuery) {
  const { start, end } = bounds(query.from, query.to);
  const within = { gte: start, lte: end };
  const branch = query.branchId || undefined;

  const [saleLines, nidOrders, nidRecords, expenses, payroll, commissions, losses, equipment, locations] =
    await Promise.all([
      prisma.saleItem.findMany({
        where: {
          sale: { status: "APPROVED", saleDate: within, ...(branch ? { locationId: branch } : {}) },
        },
        select: {
          quantity: true,
          lineTotal: true,
          unitCost: true,
          product: {
            select: {
              costPrice: true,
              category: true,
              productCategory: { select: { name: true } },
            },
          },
          sale: { select: { locationId: true, saleDate: true } },
        },
      }),
      prisma.nationalIdOrder.findMany({
        where: { createdAt: within, ...(branch ? { locationId: branch } : {}) },
        select: { price: true, locationId: true, createdAt: true },
      }),
      prisma.nationalIdRecord.findMany({
        where: { date: within, ...(branch ? { locationId: branch } : {}) },
        select: { revenue: true, locationId: true, date: true },
      }),
      prisma.expense.findMany({
        where: { expenseDate: within, ...(branch ? { locationId: branch } : {}) },
        select: { amount: true, locationId: true, expenseDate: true },
      }),
      prisma.payrollPayment.findMany({
        where: { paidAt: within, ...(branch ? { user: { branchId: branch } } : {}) },
        select: {
          salary: true,
          commission: true,
          bonus: true,
          deduction: true,
          net: true,
          paidAt: true,
          user: { select: { branchId: true } },
        },
      }),
      prisma.commissionPayment.findMany({
        where: { paidAt: within, ...(branch ? { user: { branchId: branch } } : {}) },
        select: { total: true, paidAt: true, user: { select: { branchId: true } } },
      }),
      prisma.stockLossReport.findMany({
        where: { status: "APPROVED", reviewedAt: within, ...(branch ? { locationId: branch } : {}) },
        select: {
          quantity: true,
          locationId: true,
          reviewedAt: true,
          product: { select: { costPrice: true, price: true } },
        },
      }),
      // Equipment counts as spent on the day it reached the branch; one
      // without a recorded cost adds nothing.
      prisma.officeAsset.findMany({
        where: { receivedAt: within, cost: { not: null }, ...(branch ? { locationId: branch } : {}) },
        select: { cost: true, quantity: true, locationId: true, receivedAt: true },
      }),
      prisma.stockLocation.findMany({ select: { id: true, name: true, isActive: true } }),
    ]);

  // Every amount lands in three places: its branch, its day, and (for sales)
  // that branch on that day.
  const byBranch = new Map<string, Totals>();
  const byDay = new Map<string, Totals>();
  const salesByDayBranch = new Map<string, Map<string, number>>();

  const add = (field: Field, at: Date, locationId: string | null | undefined, amount: number) => {
    const branchKey = locationId ?? OFFICE;
    const day = dayOf(at);
    const branchRow = byBranch.get(branchKey) ?? empty();
    branchRow[field] += amount;
    byBranch.set(branchKey, branchRow);
    const dayRow = byDay.get(day) ?? empty();
    dayRow[field] += amount;
    byDay.set(day, dayRow);
    if (field === "sales") {
      const cells = salesByDayBranch.get(day) ?? new Map<string, number>();
      cells.set(branchKey, (cells.get(branchKey) ?? 0) + amount);
      salesByDayBranch.set(day, cells);
    }
  };

  // Each branch's item sales, split by category, for the income lines.
  const branchCategories = new Map<string, Map<string, { kind: string; name: string | null; amount: number }>>();

  // Item sales and what they cost to buy.
  const salesByCategory = new Map<string, { kind: string; name: string | null; amount: number; cost: number }>();
  let uncostedQuantity = 0;
  let uncostedRevenue = 0;
  for (const line of saleLines) {
    const revenue = money(line.lineTotal);
    const unitCost = line.unitCost ?? line.product.costPrice;
    const cost = unitCost === null ? 0 : money(unitCost) * line.quantity;
    if (unitCost === null) {
      uncostedQuantity += line.quantity;
      uncostedRevenue += revenue;
    }

    const key = line.product.productCategory?.name ?? line.product.category;
    const entry = salesByCategory.get(key) ?? {
      kind: line.product.category,
      name: line.product.productCategory?.name ?? null,
      amount: 0,
      cost: 0,
    };
    entry.amount += revenue;
    entry.cost += cost;
    salesByCategory.set(key, entry);

    const cats = branchCategories.get(line.sale.locationId) ?? new Map();
    const cat = cats.get(key) ?? { kind: line.product.category, name: line.product.productCategory?.name ?? null, amount: 0 };
    cat.amount += revenue;
    cats.set(key, cat);
    branchCategories.set(line.sale.locationId, cats);

    add("sales", line.sale.saleDate, line.sale.locationId, revenue);
    add("goods", line.sale.saleDate, line.sale.locationId, cost);
  }

  for (const row of nidOrders) add("nationalId", row.createdAt, row.locationId, money(row.price));
  for (const row of nidRecords) add("nationalId", row.date, row.locationId, money(row.revenue));
  for (const row of expenses) add("expenses", row.expenseDate, row.locationId, money(row.amount));
  // Pay for staff with no branch (the Owner's own office) is kept under its
  // own line rather than spread over the branches.
  for (const row of payroll) add("payroll", row.paidAt, row.user.branchId, money(row.net));
  for (const row of commissions) add("commission", row.paidAt, row.user.branchId, money(row.total));
  for (const row of losses) {
    // Written off at what it cost to buy, else at its selling price.
    add("losses", row.reviewedAt ?? end, row.locationId, money(row.product.costPrice ?? row.product.price) * row.quantity);
  }
  for (const row of equipment) add("equipment", row.receivedAt, row.locationId, money(row.cost) * row.quantity);

  const total = [...byBranch.values()].reduce((sum, row) => {
    for (const field of FIELDS) sum[field] += row[field];
    return sum;
  }, empty());
  const overall = settle(total);

  // What made up the payroll paid, for the statement's breakdown.
  const payrollPart = (pick: (row: (typeof payroll)[number]) => Prisma.Decimal) =>
    round(payroll.reduce((sum, row) => sum + money(pick(row)), 0));

  const names = new Map(locations.map((row) => [row.id, row.name]));
  const nameOf = (key: string) => (key === OFFICE ? "" : (names.get(key) ?? "—"));
  const branchOrder = (a: string, b: string) =>
    a === OFFICE ? 1 : b === OFFICE ? -1 : nameOf(a).localeCompare(nameOf(b));

  // The branches with any sales, in name order, as the daily sales columns.
  const salesBranches = [...new Set([...salesByDayBranch.values()].flatMap((cells) => [...cells.keys()]))].sort(
    branchOrder,
  );

  // Every active branch gets an income line, even one that sold nothing, so
  // a missing branch never looks like a missing figure.
  const incomeBranches = locations
    .filter((row) => (branch ? row.id === branch : row.isActive || byBranch.has(row.id)))
    .map((row) => row.id)
    .sort(branchOrder);

  return {
    from: start.toISOString(),
    to: end.toISOString(),
    income: {
      sales: overall.sales,
      salesByBranch: incomeBranches.map((id) => ({
        id,
        name: nameOf(id),
        amount: round(byBranch.get(id)?.sales ?? 0),
        byCategory: [...(branchCategories.get(id)?.values() ?? [])]
          .map((row) => ({ ...row, amount: round(row.amount) }))
          .sort((a, b) => b.amount - a.amount),
      })),
      salesByCategory: [...salesByCategory.values()]
        .map((row) => ({ ...row, amount: round(row.amount), cost: round(row.cost) }))
        .sort((a, b) => b.amount - a.amount),
      nationalId: overall.nationalId,
      total: overall.income,
    },
    costs: {
      goods: overall.goods,
      expenses: overall.expenses,
      payroll: {
        net: overall.payroll,
        salary: payrollPart((row) => row.salary),
        commission: payrollPart((row) => row.commission),
        bonus: payrollPart((row) => row.bonus),
        deduction: payrollPart((row) => row.deduction),
      },
      commission: overall.commission,
      losses: overall.losses,
      equipment: overall.equipment,
      total: overall.costs,
    },
    grossProfit: round(overall.sales - overall.goods),
    profit: overall.profit,
    // Sold without any buying price: their cost is missing from the figures.
    uncosted: { quantity: uncostedQuantity, revenue: round(uncostedRevenue) },
    byBranch: [...byBranch.entries()]
      .sort(([a], [b]) => branchOrder(a, b))
      .map(([id, row]) => ({ id, name: nameOf(id), ...settle(row) })),
    // Newest day first.
    byDay: [...byDay.entries()]
      .sort(([a], [b]) => b.localeCompare(a))
      .map(([date, row]) => ({ date, ...settle(row) })),
    dailySales: {
      branches: salesBranches.map((id) => ({ id, name: nameOf(id) })),
      days: [...salesByDayBranch.entries()]
        .sort(([a], [b]) => b.localeCompare(a))
        .map(([date, cells]) => ({
          date,
          byBranch: Object.fromEntries(salesBranches.map((id) => [id, round(cells.get(id) ?? 0)])),
          total: round([...cells.values()].reduce((sum, value) => sum + value, 0)),
        })),
    },
  };
}

import { Prisma, type StockMovementType } from "database";
import { prisma } from "../../plugins/prisma.js";
import type { Viewer } from "../../middleware/auth.js";
import type {
  CashPositionQuery,
  InventoryReportQuery,
  Period,
  SalesReportQuery,
} from "./report.schema.js";

const CATEGORIES = [
  "SIM_CARD",
  "AIRTIME_VOUCHER",
  "PHONE",
  // Goods in categories the Owner added.
  "OTHER",
] as const;

type Category = (typeof CATEGORIES)[number];

function zeroByCategory() {
  return Object.fromEntries(
    CATEGORIES.map((c) => [c, { quantity: 0, revenue: 0 }]),
  ) as Record<Category, { quantity: number; revenue: number }>;
}

// Which period a date falls in. The key sorts chronologically as a string,
// so buckets need no extra sort field.
function bucketKey(date: Date, period: Period) {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");

  if (period === "yearly") {
    return { key: `${year}`, label: `${year}` };
  }

  if (period === "monthly") {
    return {
      key: `${year}-${month}`,
      label: date.toLocaleDateString("en-US", {
        month: "long",
        year: "numeric",
      }),
    };
  }

  if (period === "weekly") {
    // Week starting Monday.
    const monday = new Date(date);
    const offset = (date.getDay() + 6) % 7;
    monday.setDate(date.getDate() - offset);
    monday.setHours(0, 0, 0, 0);

    const mk = `${monday.getFullYear()}-${`${monday.getMonth() + 1}`.padStart(2, "0")}-${`${monday.getDate()}`.padStart(2, "0")}`;

    return { key: mk, label: `Week of ${mk}` };
  }

  return { key: `${year}-${month}-${day}`, label: `${year}-${month}-${day}` };
}

// Reads are branch-scoped exactly like every other module: the Owner sees
// every branch, a Supervisor their own, a Sales user only themselves.
function salesScope(
  viewer: Viewer,
  query: { branchId?: string; salespersonId?: string },
): Prisma.SaleWhereInput {
  if (viewer.role === "SALES") {
    return { salespersonId: viewer.userId };
  }

  if (viewer.role === "SUPERVISOR") {
    return {
      locationId: viewer.branchId ?? "__none__",
      ...(query.salespersonId
        ? { salespersonId: query.salespersonId }
        : {}),
    };
  }

  return {
    ...(query.branchId ? { locationId: query.branchId } : {}),
    ...(query.salespersonId
      ? { salespersonId: query.salespersonId }
      : {}),
  };
}

function dateRange(from?: string, to?: string) {
  const start = from ? new Date(from) : undefined;
  const end = to ? new Date(to) : undefined;

  // An end date with no time means "to the end of that day".
  if (end && to && !to.includes("T")) {
    end.setHours(23, 59, 59, 999);
  }

  return start || end
    ? {
        saleDate: {
          ...(start ? { gte: start } : {}),
          ...(end ? { lte: end } : {}),
        },
      }
    : {};
}

// Sales totals per period, with the per-category breakdown the dashboards
// need: airtime vouchers, SIM cards and phones.
export async function getSalesReport(
  query: SalesReportQuery,
  viewer: Viewer,
) {
  const sales = await prisma.sale.findMany({
    where: {
      // Only approved sales count as revenue; drafts and rejected sales do not.
      status: "APPROVED",
      ...salesScope(viewer, query),
      ...dateRange(query.from, query.to),
    },
    select: {
      id: true,
      saleDate: true,
      totalAmount: true,
      cashReceived: true,

      location: { select: { id: true, name: true } },
      salesperson: { select: { id: true, name: true } },

      items: {
        select: {
          quantity: true,
          lineTotal: true,
          product: {
            select: {
              id: true,
              sku: true,
              name: true,
              category: true,
              productCategory: { select: { name: true } },
            },
          },
        },
      },
    },
    orderBy: { saleDate: "asc" },
  });

  const buckets = new Map<
    string,
    {
      key: string;
      label: string;
      revenue: number;
      cashReceived: number;
      transactions: number;
      byCategory: ReturnType<typeof zeroByCategory>;
    }
  >();

  const branchTotals = new Map<
    string,
    {
      id: string;
      name: string;
      revenue: number;
      cashReceived: number;
      transactions: number;
      byCategory: ReturnType<typeof zeroByCategory>;
    }
  >();
  const sellerTotals = new Map<
    string,
    {
      id: string;
      name: string;
      branch: string;
      revenue: number;
      cashReceived: number;
      transactions: number;
      byCategory: ReturnType<typeof zeroByCategory>;
    }
  >();

  const summary = {
    revenue: 0,
    cashReceived: 0,
    transactions: 0,
    byCategory: zeroByCategory(),
  };

  // Item by item, per branch: "Airtime 100" is 40 Ibid 50 and 60 Voucher 15.
  const byItem = new Map<
    string,
    {
      id: string;
      sku: string;
      name: string;
      category: string;
      categoryName: string | null;
      quantity: number;
      revenue: number;
      branches: Record<string, { quantity: number; revenue: number }>;
    }
  >();

  const dailyByBranch = new Map<
    string,
    {
      day: string;
      branches: Record<
        string,
        { revenue: number; byCategory: ReturnType<typeof zeroByCategory> }
      >;
    }
  >();

  for (const sale of sales) {
    const { key, label } = bucketKey(sale.saleDate, query.period);

    if (!buckets.has(key)) {
      buckets.set(key, {
        key,
        label,
        revenue: 0,
        cashReceived: 0,
        transactions: 0,
        byCategory: zeroByCategory(),
      });
    }

    const bucket = buckets.get(key)!;
    const total = sale.totalAmount.toNumber();
    const cash = sale.cashReceived.toNumber();

    bucket.revenue += total;
    bucket.cashReceived += cash;
    bucket.transactions += 1;

    summary.revenue += total;
    summary.cashReceived += cash;
    summary.transactions += 1;

    for (const item of sale.items) {
      const category = item.product.category as Category;
      const line = item.lineTotal.toNumber();

      bucket.byCategory[category].quantity += item.quantity;
      bucket.byCategory[category].revenue += line;

      summary.byCategory[category].quantity += item.quantity;
      summary.byCategory[category].revenue += line;
    }

    const branch = branchTotals.get(sale.location.id) ?? {
      id: sale.location.id,
      name: sale.location.name,
      revenue: 0,
      cashReceived: 0,
      transactions: 0,
      byCategory: zeroByCategory(),
    };

    branch.revenue += total;
    branch.cashReceived += cash;
    branch.transactions += 1;

    // The branch table breaks its sales down the same way the summary does,
    // so a row and the chart beside it cannot tell different stories.
    for (const item of sale.items) {
      const category = item.product.category as Category;
      branch.byCategory[category].quantity += item.quantity;
      branch.byCategory[category].revenue += item.lineTotal.toNumber();
    }

    branchTotals.set(sale.location.id, branch);

    // The same figures per salesperson, so a supervisor reads each name.
    const seller = sellerTotals.get(sale.salesperson.id) ?? {
      id: sale.salesperson.id,
      name: sale.salesperson.name,
      branch: sale.location.name,
      revenue: 0,
      cashReceived: 0,
      transactions: 0,
      byCategory: zeroByCategory(),
    };
    seller.revenue += total;
    seller.cashReceived += cash;
    seller.transactions += 1;
    for (const item of sale.items) {
      const category = item.product.category as Category;
      seller.byCategory[category].quantity += item.quantity;
      seller.byCategory[category].revenue += item.lineTotal.toNumber();
    }
    sellerTotals.set(sale.salesperson.id, seller);

    // Day x branch, so a range of days can be read branch by branch without
    // picking each day in turn.
    const day = dayKey(sale.saleDate);
    const row = dailyByBranch.get(day) ?? { day, branches: {} };
    const cell =
      row.branches[sale.location.id] ??
      { revenue: 0, byCategory: zeroByCategory() };

    cell.revenue += total;
    for (const item of sale.items) {
      const category = item.product.category as Category;
      cell.byCategory[category].quantity += item.quantity;
      cell.byCategory[category].revenue += item.lineTotal.toNumber();
    }
    row.branches[sale.location.id] = cell;
    dailyByBranch.set(day, row);

    for (const item of sale.items) {
      const entry = byItem.get(item.product.id) ?? {
        id: item.product.id,
        sku: item.product.sku,
        name: item.product.name,
        category: item.product.category,
        categoryName: item.product.productCategory?.name ?? null,
        quantity: 0,
        revenue: 0,
        branches: {},
      };
      const at = entry.branches[sale.location.id] ?? { quantity: 0, revenue: 0 };
      const line = item.lineTotal.toNumber();

      at.quantity += item.quantity;
      at.revenue += line;
      entry.branches[sale.location.id] = at;
      entry.quantity += item.quantity;
      entry.revenue += line;
      byItem.set(item.product.id, entry);
    }
  }

  return {
    byItem: [...byItem.values()].sort((a, b) => a.name.localeCompare(b.name)),
    dailyByBranch: [...dailyByBranch.values()].sort((a, b) =>
      b.day.localeCompare(a.day),
    ),
    period: query.period,
    from: query.from ?? null,
    to: query.to ?? null,
    summary,
    buckets: [...buckets.values()].sort((a, b) =>
      a.key.localeCompare(b.key),
    ),
    byBranch: [...branchTotals.values()].sort(
      (a, b) => b.revenue - a.revenue,
    ),
    bySalesperson: [...sellerTotals.values()].sort(
      (a, b) => b.revenue - a.revenue,
    ),
  };
}

// A date with no time means "from the start of that day", in local time:
// new Date("2026-10-09") alone is UTC midnight, which misses a deposit or
// expense stamped at local midnight on a server not set to UTC.
function startOfDay(value: string) {
  return value.includes("T") ? new Date(value) : new Date(`${value}T00:00:00`);
}

// A date with no time means "to the end of that day".
function endOfDay(value: string) {
  const date = new Date(value);
  if (!value.includes("T")) date.setHours(23, 59, 59, 999);
  return date;
}

function dayKey(date: Date) {
  return `${date.getFullYear()}-${`${date.getMonth() + 1}`.padStart(2, "0")}-${`${date.getDate()}`.padStart(2, "0")}`;
}

/**
 * Deposits are scoped by who uploaded them, mirroring salesScope: a Sales
 * user sees only their own, a Supervisor their branch's, the Owner every
 * branch. Only verified receipts count as banked — an unverified upload is a
 * claim, not a confirmed deposit.
 */
function receiptScope(
  viewer: Viewer,
  query: { branchId?: string },
): Prisma.BankReceiptWhereInput {
  return {
    status: "VERIFIED",
    ...(viewer.role === "SALES"
      ? { uploadedById: viewer.userId }
      : viewer.role === "SUPERVISOR"
        ? { uploadedBy: { branchId: viewer.branchId ?? "__none__" } }
        : query.branchId
          ? { uploadedBy: { branchId: query.branchId } }
          : {}),
  };
}

/**
 * Cash that moves outside sales and handovers, person by person: National ID
 * and Telebirr money taken in cash adds to what someone holds; an expense paid
 * from their cash and a deduction (money lost, taken from their salary) come
 * off it. `when` limits the window, as for the other movements.
 */
async function otherCash(
  viewer: Viewer,
  query: { branchId?: string },
  when: { gte?: Date; lt?: Date; lte?: Date },
) {
  const branch =
    viewer.role === "SUPERVISOR" ? (viewer.branchId ?? "__none__") : viewer.role === "OWNER" ? query.branchId : undefined;
  const mine = viewer.role === "SALES" ? viewer.userId : undefined;
  const hasWindow = when.gte || when.lt || when.lte;
  const person = { select: { id: true, name: true, branch: { select: { id: true, name: true } } } };
  // A deduction's day is a "YYYY-MM-DD" string, compared as one.
  const dayWindow = {
    ...(when.gte ? { gte: dayKey(when.gte) } : {}),
    ...(when.lt ? { lt: dayKey(when.lt) } : {}),
    ...(when.lte ? { lte: dayKey(when.lte) } : {}),
  };

  const [orders, telebirr, expenses, deductions] = await Promise.all([
    prisma.nationalIdOrder.findMany({
      where: {
        ...(hasWindow ? { createdAt: when } : {}),
        ...(branch ? { locationId: branch } : {}),
        ...(mine ? { recordedById: mine } : {}),
      },
      select: { price: true, transferAmount: true, createdAt: true, recordedBy: person },
    }),
    prisma.telebirrTransaction.findMany({
      where: {
        ...(hasWindow ? { createdAt: when } : {}),
        ...(branch ? { locationId: branch } : {}),
        ...(mine ? { recordedById: mine } : {}),
      },
      select: { amount: true, transferAmount: true, createdAt: true, recordedBy: person },
    }),
    // Only expenses that name whose cash paid them; older ones did not.
    prisma.expense.findMany({
      where: {
        spentById: mine ?? { not: null },
        ...(hasWindow ? { expenseDate: when } : {}),
        ...(branch ? { locationId: branch } : {}),
      },
      select: { amount: true, expenseDate: true, spentBy: person },
    }),
    prisma.deduction.findMany({
      where: {
        ...(hasWindow ? { day: dayWindow } : {}),
        ...(branch ? { user: { branchId: branch } } : {}),
        ...(mine ? { userId: mine } : {}),
      },
      select: { total: true, day: true, user: person },
    }),
  ]);

  type Who = { id: string; name: string; branch: { id: string; name: string } | null };
  const moves: { who: Who; date: Date; kind: "other" | "expenses" | "deductions"; amount: number }[] = [];
  for (const row of orders) {
    moves.push({ who: row.recordedBy, date: row.createdAt, kind: "other", amount: row.price.toNumber() - row.transferAmount.toNumber() });
  }
  for (const row of telebirr) {
    moves.push({ who: row.recordedBy, date: row.createdAt, kind: "other", amount: row.amount.toNumber() - row.transferAmount.toNumber() });
  }
  for (const row of expenses) {
    if (row.spentBy) moves.push({ who: row.spentBy, date: row.expenseDate, kind: "expenses", amount: row.amount.toNumber() });
  }
  for (const row of deductions) {
    moves.push({ who: row.user, date: new Date(`${row.day}T12:00:00`), kind: "deductions", amount: row.total.toNumber() });
  }
  return moves;
}

/**
 * Cash held before the report's first day — "yadere", the balance brought
 * forward.
 *
 * Sales made after the bank shuts cannot be deposited the same day, so the
 * money sits with the salesperson overnight and is banked the next morning.
 * That carry-over is not a figure anyone types: it is every cash sale ever
 * made, less every verified deposit, up to the day before this report starts.
 */
export async function openingBalances(
  from: string,
  viewer: Viewer,
  query: { branchId?: string; salespersonId?: string },
) {
  const before = new Date(from);
  before.setHours(0, 0, 0, 0);

  const [sales, receipts, collections] = await Promise.all([
    prisma.sale.findMany({
      where: {
        status: "APPROVED",
        ...salesScope(viewer, query),
        saleDate: { lt: before },
      },
      select: { cashReceived: true, salespersonId: true },
    }),
    prisma.bankReceipt.findMany({
      where: {
        ...receiptScope(viewer, query),
        receiptDate: { lt: before },
      },
      select: { amount: true, uploadedById: true },
    }),
    prisma.cashCollection.findMany({
      where: {
        ...collectionScope(viewer, query),
        collectedAt: { lt: before },
      },
      select: { amount: true, supervisorId: true, salespersonId: true },
    }),
  ]);

  const opening = new Map<string, number>();

  const move = (userId: string, amount: number) =>
    opening.set(userId, (opening.get(userId) ?? 0) + amount);

  for (const sale of sales) {
    move(sale.salespersonId, sale.cashReceived.toNumber());
  }

  for (const receipt of receipts) {
    move(receipt.uploadedById, -receipt.amount.toNumber());
  }

  // A handover leaves one pair of hands and enters another; the branch's
  // total is unchanged, which is why both sides are recorded.
  for (const collection of collections) {
    move(collection.salespersonId, -collection.amount.toNumber());
    move(collection.supervisorId, collection.amount.toNumber());
  }

  for (const entry of await otherCash(viewer, query, { lt: before })) {
    move(entry.who.id, entry.kind === "other" ? entry.amount : -entry.amount);
  }

  return opening;
}

/** Handovers inside the viewer's reach, scoped like sales and receipts. */
function collectionScope(
  viewer: Viewer,
  query: { branchId?: string },
): Prisma.CashCollectionWhereInput {
  if (viewer.role === "SALES") return { salespersonId: viewer.userId };

  if (viewer.role === "SUPERVISOR") {
    return { salesperson: { branchId: viewer.branchId ?? "__none__" } };
  }

  return query.branchId
    ? { salesperson: { branchId: query.branchId } }
    : {};
}

// What each salesperson took in versus what they have banked. The difference
// is the cash still in their hand.
export async function getCashPosition(
  query: CashPositionQuery,
  viewer: Viewer,
) {
  const range = dateRange(query.from, query.to);

  const sales = await prisma.sale.findMany({
    where: {
      status: "APPROVED",
      ...salesScope(viewer, query),
      ...range,
    },
    select: {
      saleDate: true,
      cashReceived: true,
      salesperson: {
        select: {
          id: true,
          name: true,
          branch: { select: { id: true, name: true } },
        },
      },
    },
  });

  const receiptWhere: Prisma.BankReceiptWhereInput = {
    ...receiptScope(viewer, query),
    ...(query.from || query.to
      ? {
          receiptDate: {
            ...(query.from ? { gte: startOfDay(query.from) } : {}),
            ...(query.to ? { lte: endOfDay(query.to) } : {}),
          },
        }
      : {}),
  };

  const collections = await prisma.cashCollection.findMany({
    where: {
      ...collectionScope(viewer, query),
      ...(query.from || query.to
        ? {
            collectedAt: {
              ...(query.from ? { gte: startOfDay(query.from) } : {}),
              ...(query.to ? { lte: endOfDay(query.to) } : {}),
            },
          }
        : {}),
    },
    select: {
      amount: true,
      supervisor: {
        select: {
          id: true,
          name: true,
          branch: { select: { id: true, name: true } },
        },
      },
      salesperson: { select: { id: true } },
    },
  });

  const receipts = await prisma.bankReceipt.findMany({
    where: receiptWhere,
    select: {
      receiptDate: true,
      amount: true,
      uploadedBy: {
        select: {
          id: true,
          name: true,
          branch: { select: { id: true, name: true } },
        },
      },
    },
  });

  const people = new Map<
    string,
    {
      id: string;
      name: string;
      branch: string | null;
      /** Held from before this report's first day: yadere. */
      opening: number;
      sold: number;
      /** National ID and Telebirr money taken in cash. */
      other: number;
      /** Expenses paid from this person's cash. */
      expenses: number;
      /** Money lost, also taken off their salary. */
      deductions: number;
      /** Cash this seller handed to their supervisor. */
      handedOver: number;
      /** Cash this supervisor took in from their sellers. */
      collected: number;
      banked: number;
      /** Still held at the end of the last day: keri, tomorrow's yadere. */
      inHand: number;
    }
  >();

  function row(
    id: string,
    name: string,
    branch: { name: string } | null,
  ) {
    if (!people.has(id)) {
      people.set(id, {
        id,
        name,
        branch: branch?.name ?? null,
        opening: 0,
        sold: 0,
        other: 0,
        expenses: 0,
        deductions: 0,
        handedOver: 0,
        collected: 0,
        banked: 0,
        inHand: 0,
      });
    }

    return people.get(id)!;
  }

  // Someone may hold cash from earlier days without selling or banking
  // anything inside the range, so these rows exist on their own account.
  if (query.from) {
    const opening = await openingBalances(query.from, viewer, query);

    if (opening.size > 0) {
      const holders = await prisma.user.findMany({
        where: { id: { in: [...opening.keys()] } },
        select: { id: true, name: true, branch: { select: { name: true } } },
      });

      for (const holder of holders) {
        row(holder.id, holder.name, holder.branch).opening =
          opening.get(holder.id) ?? 0;
      }
    }
  }

  for (const sale of sales) {
    const person = row(
      sale.salesperson.id,
      sale.salesperson.name,
      sale.salesperson.branch,
    );

    person.sold += sale.cashReceived.toNumber();
  }

  for (const receipt of receipts) {
    const person = row(
      receipt.uploadedBy.id,
      receipt.uploadedBy.name,
      receipt.uploadedBy.branch,
    );

    person.banked += receipt.amount.toNumber();
  }

  // Both sides of the handover, except that a salesperson is shown only their
  // own line: the supervisor's balance — the branch's yadere — is not theirs
  // to see, and counting it would inflate their own "still to hand over".
  for (const collection of collections) {
    const amount = collection.amount.toNumber();

    if (viewer.role !== "SALES") {
      row(
        collection.supervisor.id,
        collection.supervisor.name,
        collection.supervisor.branch,
      ).collected += amount;
    }

    const seller = people.get(collection.salesperson.id);
    if (seller) seller.handedOver += amount;
  }

  const others = await otherCash(viewer, query, {
    ...(query.from ? { gte: startOfDay(query.from) } : {}),
    ...(query.to ? { lte: endOfDay(query.to) } : {}),
  });
  for (const entry of others) {
    row(entry.who.id, entry.who.name, entry.who.branch)[entry.kind] += entry.amount;
  }

  // One line for everyone, whatever their role: what they started with, plus
  // what came in, less what went out. A seller takes cash in over the counter
  // and hands it up; a supervisor takes it in from sellers and banks it, and
  // whatever is left with them tonight is the yadere.
  for (const person of people.values()) {
    person.inHand =
      person.opening +
      person.sold +
      person.other +
      person.collected -
      person.handedOver -
      person.banked -
      person.expenses -
      person.deductions;
  }

  const rows = [...people.values()].sort(
    (a, b) => b.inHand - a.inHand,
  );

  return {
    from: query.from ?? null,
    to: query.to ?? null,
    salespeople: rows,
    totals: {
      opening: rows.reduce((s, r) => s + r.opening, 0),
      sold: rows.reduce((s, r) => s + r.sold, 0),
      other: rows.reduce((s, r) => s + r.other, 0),
      expenses: rows.reduce((s, r) => s + r.expenses, 0),
      deductions: rows.reduce((s, r) => s + r.deductions, 0),
      handedOver: rows.reduce((s, r) => s + r.handedOver, 0),
      collected: rows.reduce((s, r) => s + r.collected, 0),
      banked: rows.reduce((s, r) => s + r.banked, 0),
      inHand: rows.reduce((s, r) => s + r.inHand, 0),
    },
    days: dailyLedger(query, sales, receipts, rows, others),
  };
}

/** A day in the cash ledger: what was carried in, moved, and carried out. */
type LedgerDay = {
  date: string;
  opening: number;
  collected: number;
  /** Expenses and deductions. */
  spent: number;
  deposited: number;
  closing: number;
};

/**
 * The report read the way the branch keeps it by hand: each day opens with
 * what was carried over (yadere), takes in the day's cash, pays out what
 * reached the bank, and closes with what is still held (keri) — which is the
 * next day's opening. Every day in the range appears, including days with no
 * trade, because a day with no deposit still carries money forward.
 *
 * Only built when both ends of the range are given; without them there is no
 * first day to open from.
 */
function dailyLedger(
  query: CashPositionQuery,
  sales: { saleDate: Date; cashReceived: Prisma.Decimal }[],
  receipts: { receiptDate: Date; amount: Prisma.Decimal }[],
  rows: { opening: number }[],
  others: { date: Date; kind: "other" | "expenses" | "deductions"; amount: number }[],
): LedgerDay[] | null {
  if (!query.from || !query.to) return null;

  const collected = new Map<string, number>();
  const deposited = new Map<string, number>();
  const spent = new Map<string, number>();

  for (const entry of others) {
    const key = dayKey(entry.date);
    const into = entry.kind === "other" ? collected : spent;
    into.set(key, (into.get(key) ?? 0) + entry.amount);
  }

  for (const sale of sales) {
    const key = dayKey(sale.saleDate);
    collected.set(key, (collected.get(key) ?? 0) + sale.cashReceived.toNumber());
  }

  for (const receipt of receipts) {
    const key = dayKey(receipt.receiptDate);
    deposited.set(key, (deposited.get(key) ?? 0) + receipt.amount.toNumber());
  }

  const cursor = new Date(query.from);
  cursor.setHours(0, 0, 0, 0);

  const last = endOfDay(query.to);
  const days: LedgerDay[] = [];

  let balance = rows.reduce((sum, person) => sum + person.opening, 0);

  // A guard against an open-ended range asking for thousands of rows.
  while (cursor <= last && days.length < 370) {
    const key = dayKey(cursor);
    const day = {
      date: key,
      opening: balance,
      collected: collected.get(key) ?? 0,
      spent: spent.get(key) ?? 0,
      deposited: deposited.get(key) ?? 0,
      closing: 0,
    };

    day.closing = day.opening + day.collected - day.spent - day.deposited;
    balance = day.closing;

    days.push(day);
    cursor.setDate(cursor.getDate() + 1);
  }

  return days;
}

// Stock remaining, per branch and per category.
export async function getInventoryReport(
  query: InventoryReportQuery,
  viewer: Viewer,
) {
  const branchId =
    viewer.role === "OWNER" ? query.branchId : viewer.branchId;

  const productSelect = {
    id: true,
    sku: true,
    name: true,
    category: true,
    price: true,
    productCategory: { select: { name: true } },
  } as const;

  // A salesperson's stock is what they hold, not the branch's shelf.
  const balances =
    viewer.role === "SALES"
      ? await (async () => {
          const [holdings, location] = await Promise.all([
            prisma.salespersonHolding.findMany({
              where: { userId: viewer.userId, quantity: { gt: 0 } },
              select: { quantity: true, product: { select: productSelect } },
            }),
            branchId
              ? prisma.stockLocation.findUnique({
                  where: { id: branchId },
                  select: { id: true, name: true },
                })
              : null,
          ]);
          const own = location ?? { id: viewer.userId, name: "" };
          return holdings.map((holding) => ({ ...holding, location: own }));
        })()
      : await prisma.inventoryBalance.findMany({
          where: branchId ? { locationId: branchId } : {},
          select: {
            quantity: true,
            product: { select: productSelect },
            location: { select: { id: true, name: true } },
          },
          orderBy: [{ location: { name: "asc" } }],
        });

  const branches = new Map<
    string,
    {
      id: string;
      name: string;
      byCategory: ReturnType<typeof zeroByCategory>;
      totalUnits: number;
      stockValue: number;
      items: {
        sku: string;
        name: string;
        category: string;
        categoryName: string | null;
        quantity: number;
        value: number;
      }[];
    }
  >();

  for (const balance of balances) {
    const branch = branches.get(balance.location.id) ?? {
      id: balance.location.id,
      name: balance.location.name,
      byCategory: zeroByCategory(),
      totalUnits: 0,
      stockValue: 0,
      items: [],
    };

    const category = balance.product.category as Category;
    const value = balance.product.price.toNumber() * balance.quantity;

    branch.byCategory[category].quantity += balance.quantity;
    branch.byCategory[category].revenue += value;
    branch.totalUnits += balance.quantity;
    branch.stockValue += value;

    branch.items.push({
      sku: balance.product.sku,
      name: balance.product.name,
      category: balance.product.category,
      categoryName: balance.product.productCategory?.name ?? null,
      quantity: balance.quantity,
      value,
    });

    branches.set(balance.location.id, branch);
  }

  const rows = [...branches.values()];

  return {
    branches: rows,
    totals: {
      totalUnits: rows.reduce((s, b) => s + b.totalUnits, 0),
      stockValue: rows.reduce((s, b) => s + b.stockValue, 0),
    },
  };
}

// Stock on hand per category, plus how it moved over the last 30 days against
// the 30 before that. The percentage on a stat tile is real movement, not a
// placeholder.
export async function getStockChange(viewer: Viewer) {
  const branchId =
    viewer.role === "OWNER" ? undefined : viewer.branchId ?? "__none__";

  const now = new Date();
  const thirty = new Date(now);
  thirty.setDate(now.getDate() - 30);
  const sixty = new Date(now);
  sixty.setDate(now.getDate() - 60);

  const [balances, movements] = await Promise.all([
    prisma.inventoryBalance.findMany({
      where: branchId ? { locationId: branchId } : {},
      select: {
        quantity: true,
        product: { select: { category: true, price: true } },
      },
    }),
    prisma.stockMovement.findMany({
      where: {
        createdAt: { gte: sixty },
        ...(branchId
          ? {
              OR: [
                { fromLocationId: branchId },
                { toLocationId: branchId },
              ],
            }
          : {}),
      },
      select: {
        quantity: true,
        type: true,
        createdAt: true,
        fromLocationId: true,
        toLocationId: true,
        product: { select: { category: true } },
      },
    }),
  ]);

  const onHand = zeroByCategory();
  let stockValue = 0;

  for (const balance of balances) {
    const category = balance.product.category as Category;
    onHand[category].quantity += balance.quantity;
    stockValue += balance.product.price.toNumber() * balance.quantity;
  }

  // Net movement into the viewer's scope: arrivals count up, departures down.
  function net(from: Date, to: Date) {
    const totals = zeroByCategory();

    for (const movement of movements) {
      if (movement.createdAt < from || movement.createdAt >= to) continue;

      const category = movement.product.category as Category;

      const arriving = branchId
        ? movement.toLocationId === branchId
        : movement.type === "STOCK_IN";
      const leaving = branchId
        ? movement.fromLocationId === branchId
        : movement.type === "SALE";

      if (arriving) totals[category].quantity += movement.quantity;
      if (leaving) totals[category].quantity -= movement.quantity;
    }

    return totals;
  }

  const recent = net(thirty, new Date(now.getTime() + 1));
  const prior = net(sixty, thirty);

  const byCategory = Object.fromEntries(
    CATEGORIES.map((category) => {
      const current = onHand[category].quantity;
      const change = recent[category].quantity;
      const before = current - change;

      // Percent change against where the stock stood 30 days ago.
      const changePct =
        before > 0 ? (change / before) * 100 : change > 0 ? 100 : 0;

      return [
        category,
        {
          onHand: current,
          change,
          changePct: Math.round(changePct * 10) / 10,
          priorChange: prior[category].quantity,
        },
      ];
    }),
  ) as Record<
    Category,
    { onHand: number; change: number; changePct: number; priorChange: number }
  >;

  return {
    byCategory,
    totalUnits: CATEGORIES.reduce(
      (sum, category) => sum + byCategory[category].onHand,
      0,
    ),
    stockValue,
  };
}

// The activity feed: what has just happened, in the viewer's scope only.
//
// Facts, not sentences: each row carries the product, a signed quantity, the
// branch, who did it and why, and the client words it in the reader's
// language. Up to PER_GROUP of each kind come back, so the dashboard can show
// a mix (a sale, a delivery, a request, a correction) rather than letting one
// busy morning of any single kind fill the card.
export type ActivityKind =
  | "SALE"
  | "STOCK_IN"
  | "TRANSFER"
  | "REQUEST"
  | "ADJUSTMENT"
  | "LOSS"
  | "OTHER";

export type ActivityItem = {
  id: string;
  kind: ActivityKind;
  at: string;
  branch: string | null;
  by: string | null;
  product?: string;
  /** Signed for corrections: negative left the branch, positive arrived. */
  quantity?: number;
  /** Sales: the total; requests: the number of units asked for. */
  amount?: number;
  units?: number;
  status?: string;
  from?: string | null;
  to?: string | null;
  /** The person's own words: why stock was corrected or written off. */
  note?: string | null;
  /** A correction's balance before and after. */
  before?: number;
  after?: number;
  /** A write-off's cause, or REVERSED when the write-off was rejected. */
  cause?: "DAMAGED" | "LOST" | "REVERSED";
};

// Movement notes are written in English by the services that create them
// (inventory.service, stockLoss.service). Pulled apart here so the client
// can word them in the reader's language and show only the person's reason.
function readNote(note: string | null): Pick<
  ActivityItem,
  "note" | "before" | "after" | "cause"
> {
  if (!note) return { note: null };

  const corrected = /^Corrected (-?\d+) → (-?\d+)\.\s*(.*)$/s.exec(note);
  if (corrected) {
    return {
      before: Number(corrected[1]),
      after: Number(corrected[2]),
      note: corrected[3] || null,
    };
  }

  const loss = /^(Damaged|Lost|Write-off rejected):\s*(.*)$/s.exec(note);
  if (loss) {
    return {
      cause:
        loss[1] === "Damaged" ? "DAMAGED" : loss[1] === "Lost" ? "LOST" : "REVERSED",
      note: loss[2] || null,
    };
  }

  const removed = /^Stock row removed\.\s*(.*)$/s.exec(note);
  if (removed) return { note: removed[1] || null };

  return { note };
}

const PER_GROUP = 3;

export async function getRecentActivity(viewer: Viewer) {
  const branchId =
    viewer.role === "OWNER" ? undefined : viewer.branchId ?? "__none__";

  const touchesBranch = branchId
    ? { OR: [{ fromLocationId: branchId }, { toLocationId: branchId }] }
    : {};

  const movementSelect = {
    id: true,
    type: true,
    quantity: true,
    createdAt: true,
    notes: true,
    referenceType: true,
    product: { select: { name: true } },
    fromLocation: { select: { name: true } },
    toLocation: { select: { name: true } },
    createdBy: { select: { name: true } },
  } as const;

  function movements(types: StockMovementType[]) {
    // Branch stock movements are not a salesperson's to read.
    if (viewer.role === "SALES") return Promise.resolve([]);

    return prisma.stockMovement.findMany({
      where: { type: { in: types }, ...touchesBranch },
      select: movementSelect,
      orderBy: { createdAt: "desc" },
      take: PER_GROUP,
    });
  }

  const [sales, stockIn, transfers, corrections, other, requests] =
    await Promise.all([
      // One row per sale. Sale movements are one per line item, so a basket
      // of five things would otherwise read as five sales.
      prisma.sale.findMany({
        where: {
          status: { in: ["SUBMITTED", "APPROVED"] },
          ...salesScope(viewer, {}),
        },
        select: {
          id: true,
          createdAt: true,
          totalAmount: true,
          location: { select: { name: true } },
          salesperson: { select: { name: true } },
          items: { select: { quantity: true } },
        },
        orderBy: { createdAt: "desc" },
        take: PER_GROUP,
      }),
      movements(["STOCK_IN"]),
      movements(["TRANSFER"]),
      movements(["ADJUSTMENT"]),
      movements(["STOCK_OUT", "RETURN"]),
      prisma.stockRequest.findMany({
        where:
          viewer.role === "SALES"
            ? { requestedById: viewer.userId }
            : branchId
              ? { requestedBy: { branchId } }
              : {},
        select: {
          id: true,
          status: true,
          createdAt: true,
          requestedBy: {
            select: { name: true, branch: { select: { name: true } } },
          },
          items: { select: { quantity: true } },
        },
        orderBy: { createdAt: "desc" },
        take: PER_GROUP,
      }),
    ]);

  const feed: ActivityItem[] = [];

  for (const sale of sales) {
    feed.push({
      id: sale.id,
      kind: "SALE",
      at: sale.createdAt.toISOString(),
      branch: sale.location.name,
      by: sale.salesperson.name,
      amount: sale.totalAmount.toNumber(),
      units: sale.items.reduce((sum, item) => sum + item.quantity, 0),
    });
  }

  for (const movement of [...stockIn, ...transfers, ...corrections, ...other]) {
    // An increase is recorded as arriving at a branch, a decrease as leaving
    // it (see inventory.service and stockLoss.service).
    const arriving = movement.toLocation != null && movement.fromLocation == null;

    const kind: ActivityKind =
      movement.type === "STOCK_IN"
        ? "STOCK_IN"
        : movement.type === "TRANSFER"
          ? "TRANSFER"
          : movement.type === "ADJUSTMENT"
            ? movement.referenceType === "StockLossReport" && !arriving
              ? "LOSS"
              : "ADJUSTMENT"
            : "OTHER";

    feed.push({
      id: movement.id,
      kind,
      at: movement.createdAt.toISOString(),
      branch: movement.toLocation?.name ?? movement.fromLocation?.name ?? null,
      by: movement.createdBy?.name ?? null,
      product: movement.product.name,
      quantity:
        kind === "ADJUSTMENT" || kind === "LOSS"
          ? arriving
            ? movement.quantity
            : -movement.quantity
          : movement.quantity,
      from: movement.fromLocation?.name ?? null,
      to: movement.toLocation?.name ?? null,
      ...readNote(movement.notes),
      ...(kind === "OTHER" ? { status: movement.type } : {}),
    });
  }

  for (const request of requests) {
    feed.push({
      id: request.id,
      kind: "REQUEST",
      at: request.createdAt.toISOString(),
      branch: request.requestedBy.branch?.name ?? null,
      by: request.requestedBy.name,
      status: request.status,
      units: request.items.reduce((sum, item) => sum + item.quantity, 0),
    });
  }

  return feed.sort((a, b) => b.at.localeCompare(a.at));
}

// Best sellers over a window, by units moved. The share is of total units sold
// in the same window, so the numbers add up to 100% across all products.
export async function getTopProducts(
  viewer: Viewer,
  from: Date,
  limit = 5,
) {
  const items = await prisma.saleItem.findMany({
    where: {
      sale: {
        status: "APPROVED",
        saleDate: { gte: from },
        ...salesScope(viewer, {}),
      },
    },
    select: {
      quantity: true,
      lineTotal: true,
      product: {
        select: {
          id: true,
          sku: true,
          name: true,
          category: true,
          price: true,
          productCategory: { select: { name: true } },
        },
      },
    },
  });

  const totals = new Map<
    string,
    {
      id: string;
      sku: string;
      name: string;
      category: string;
      price: number;
      units: number;
      revenue: number;
    }
  >();

  let allUnits = 0;

  for (const item of items) {
    const entry = totals.get(item.product.id) ?? {
      id: item.product.id,
      sku: item.product.sku,
      name: item.product.name,
      category: item.product.category,
      price: item.product.price.toNumber(),
      units: 0,
      revenue: 0,
    };

    entry.units += item.quantity;
    entry.revenue += item.lineTotal.toNumber();
    allUnits += item.quantity;

    totals.set(item.product.id, entry);
  }

  return [...totals.values()]
    .sort((a, b) => b.units - a.units)
    .slice(0, limit)
    .map((entry) => ({
      ...entry,
      sharePct:
        allUnits > 0 ? Math.round((entry.units / allUnits) * 1000) / 10 : 0,
    }));
}

// Products at or near zero in the viewer's branches. Serialized goods run out
// faster than vouchers, so the threshold is per category.
export async function getLowStock(viewer: Viewer, limit = 5) {
  const branchId =
    viewer.role === "OWNER" ? undefined : viewer.branchId ?? "__none__";

  const productSelect = { id: true, sku: true, name: true, category: true } as const;

  // A salesperson is warned about the goods issued to them running low; the
  // branch's shelf is the supervisor's to watch.
  const balances =
    viewer.role === "SALES"
      ? (
          await prisma.salespersonHolding.findMany({
            where: { userId: viewer.userId },
            select: { quantity: true, product: { select: productSelect } },
          })
        ).map((holding) => ({
          ...holding,
          location: { id: viewer.userId, name: "" },
        }))
      : [
          // Branch shelves. The main store's own figure is only the sum of
          // the branches' shares, so it is watched share by share instead.
          ...(await prisma.inventoryBalance.findMany({
            where: branchId ? { locationId: branchId } : { location: { isMainStock: false } },
            select: {
              quantity: true,
              product: { select: productSelect },
              location: { select: { id: true, name: true } },
            },
          })),
          // The Owner's stock held for each branch at the main store.
          ...(viewer.role === "OWNER"
            ? (
                await prisma.branchStock.findMany({
                  select: {
                    quantity: true,
                    product: { select: productSelect },
                    branch: { select: { id: true, name: true } },
                  },
                })
              ).map((row) => ({
                quantity: row.quantity,
                product: row.product,
                location: { id: `share-${row.branch.id}`, name: `${row.branch.name} · Owner stock` },
              }))
            : []),
        ];

  const threshold: Record<string, number> = {
    SIM_CARD: 10,
    PHONE: 5,
    AIRTIME_VOUCHER: 40,
  };

  return balances
    .filter(
      (balance) =>
        balance.quantity <= (threshold[balance.product.category] ?? 10),
    )
    .sort((a, b) => a.quantity - b.quantity)
    .slice(0, limit)
    .map((balance) => ({
      id: `${balance.location.id}-${balance.product.id}`,
      sku: balance.product.sku,
      name: balance.product.name,
      category: balance.product.category,
      branch: balance.location.name,
      quantity: balance.quantity,
      threshold: threshold[balance.product.category] ?? 10,
    }));
}

// The latest sales with enough detail for a table row: who, where, what, and
// the status badge.
export async function getRecentSales(viewer: Viewer, limit = 5) {
  const sales = await prisma.sale.findMany({
    where: salesScope(viewer, {}),
    select: {
      id: true,
      status: true,
      saleDate: true,
      totalAmount: true,
      salesperson: { select: { id: true, name: true } },
      location: { select: { id: true, name: true } },
      items: {
        select: {
          quantity: true,
          product: { select: { name: true, category: true } },
        },
      },
    },
    orderBy: { saleDate: "desc" },
    take: limit,
  });

  return sales.map((sale) => {
    const units = sale.items.reduce((sum, item) => sum + item.quantity, 0);
    const lead = sale.items[0]?.product;

    return {
      id: sale.id,
      status: sale.status,
      saleDate: sale.saleDate.toISOString(),
      total: sale.totalAmount.toNumber(),
      salesperson: sale.salesperson.name,
      branch: sale.location.name,
      units,
      summary:
        sale.items.length > 1
          ? `${lead?.name ?? "Item"} +${sale.items.length - 1} more`
          : (lead?.name ?? "Item"),
      category: lead?.category ?? "OTHER",
    };
  });
}

// Per-branch trading activity. Each approved sale is one customer purchase,
// so "customers" here means distinct completed purchases, not a customer
// record - the system does not store customer identities.
export async function getBranchActivity(viewer: Viewer, from: Date) {
  const sales = await prisma.sale.findMany({
    where: {
      status: "APPROVED",
      saleDate: { gte: from },
      ...salesScope(viewer, {}),
    },
    select: {
      totalAmount: true,
      salespersonId: true,
      location: { select: { id: true, name: true } },
      items: { select: { quantity: true } },
    },
  });

  const branches = new Map<
    string,
    {
      id: string;
      name: string;
      customers: number;
      revenue: number;
      units: number;
      staff: Set<string>;
    }
  >();

  for (const sale of sales) {
    const entry = branches.get(sale.location.id) ?? {
      id: sale.location.id,
      name: sale.location.name,
      customers: 0,
      revenue: 0,
      units: 0,
      staff: new Set<string>(),
    };

    entry.customers += 1;
    entry.revenue += sale.totalAmount.toNumber();
    entry.units += sale.items.reduce((sum, item) => sum + item.quantity, 0);
    entry.staff.add(sale.salespersonId);

    branches.set(sale.location.id, entry);
  }

  return [...branches.values()]
    .map((entry) => ({
      id: entry.id,
      name: entry.name,
      customers: entry.customers,
      revenue: entry.revenue,
      units: entry.units,
      staff: entry.staff.size,
    }))
    .sort((a, b) => b.customers - a.customers);
}

// --- CSV rendering ----------------------------------------------------------

function csvCell(value: unknown) {
  const text = value === null || value === undefined ? "" : String(value);

  return /[",\n]/.test(text)
    ? `"${text.replace(/"/g, '""')}"`
    : text;
}

export function toCsv(
  headers: string[],
  rows: unknown[][],
): string {
  return [
    headers.map(csvCell).join(","),
    ...rows.map((row) => row.map(csvCell).join(",")),
  ].join("\n");
}

export function salesReportCsv(
  report: Awaited<ReturnType<typeof getSalesReport>>,
) {
  return toCsv(
    [
      "Period",
      "Transactions",
      "Revenue",
      "Cash received",
      "SIM cards sold",
      "SIM revenue",
      "Vouchers sold",
      "Voucher revenue",
      "Phones sold",
      "Phone revenue",
    ],
    report.buckets.map((b) => [
      b.label,
      b.transactions,
      b.revenue.toFixed(2),
      b.cashReceived.toFixed(2),
      b.byCategory.SIM_CARD.quantity,
      b.byCategory.SIM_CARD.revenue.toFixed(2),
      b.byCategory.AIRTIME_VOUCHER.quantity,
      b.byCategory.AIRTIME_VOUCHER.revenue.toFixed(2),
      b.byCategory.PHONE.quantity,
      b.byCategory.PHONE.revenue.toFixed(2),
    ]),
  );
}

/**
 * Money credited to each bank, person by person: the cash deposits they made
 * (verified slips only) and the transfers customers sent them for sales,
 * National ID and Telebirr. Each bank lists its people and its total.
 */
export async function getBankReport(
  query: { from?: string; to?: string; branchId?: string },
  viewer: Viewer,
) {
  const when = {
    ...(query.from ? { gte: startOfDay(query.from) } : {}),
    ...(query.to ? { lte: endOfDay(query.to) } : {}),
  };
  const hasWindow = Boolean(query.from || query.to);
  const branch =
    viewer.role === "SUPERVISOR" ? (viewer.branchId ?? "__none__") : viewer.role === "OWNER" ? query.branchId : undefined;
  const mine = viewer.role === "SALES" ? viewer.userId : undefined;
  const person = { select: { id: true, name: true, branch: { select: { name: true } } } };

  const [receipts, sales, orders, telebirr] = await Promise.all([
    prisma.bankReceipt.findMany({
      where: { ...receiptScope(viewer, query), ...(hasWindow ? { receiptDate: when } : {}) },
      select: { bankName: true, amount: true, uploadedBy: person },
    }),
    prisma.sale.findMany({
      where: {
        status: "APPROVED",
        transferReceived: { gt: 0 },
        ...salesScope(viewer, query),
        ...(hasWindow ? { saleDate: when } : {}),
      },
      select: { bankName: true, transferReceived: true, salesperson: person },
    }),
    prisma.nationalIdOrder.findMany({
      where: {
        transferAmount: { gt: 0 },
        ...(hasWindow ? { createdAt: when } : {}),
        ...(branch ? { locationId: branch } : {}),
        ...(mine ? { recordedById: mine } : {}),
      },
      select: { bankName: true, transferAmount: true, recordedBy: person },
    }),
    prisma.telebirrTransaction.findMany({
      where: {
        transferAmount: { gt: 0 },
        ...(hasWindow ? { createdAt: when } : {}),
        ...(branch ? { locationId: branch } : {}),
        ...(mine ? { recordedById: mine } : {}),
      },
      select: { bankName: true, transferAmount: true, recordedBy: person },
    }),
  ]);

  type Person = { id: string; name: string; branch: string | null; deposits: number; transfers: number; total: number };
  const banks = new Map<string, Map<string, Person>>();
  const add = (
    bankName: string | null,
    who: { id: string; name: string; branch: { name: string } | null },
    kind: "deposits" | "transfers",
    amount: number,
  ) => {
    const bank = bankName?.trim() || "—";
    const people = banks.get(bank) ?? new Map<string, Person>();
    banks.set(bank, people);
    const row =
      people.get(who.id) ??
      { id: who.id, name: who.name, branch: who.branch?.name ?? null, deposits: 0, transfers: 0, total: 0 };
    people.set(who.id, row);
    row[kind] += amount;
    row.total += amount;
  };

  for (const row of receipts) add(row.bankName, row.uploadedBy, "deposits", row.amount.toNumber());
  for (const row of sales) add(row.bankName, row.salesperson, "transfers", row.transferReceived.toNumber());
  for (const row of orders) add(row.bankName, row.recordedBy, "transfers", row.transferAmount.toNumber());
  for (const row of telebirr) add(row.bankName, row.recordedBy, "transfers", row.transferAmount.toNumber());

  const sum = (rows: Person[], key: "deposits" | "transfers" | "total") =>
    Math.round(rows.reduce((total, row) => total + row[key], 0) * 100) / 100;

  const list = [...banks.entries()]
    .map(([bank, people]) => {
      const rows = [...people.values()].sort((a, b) => b.total - a.total);
      return { bank, people: rows, deposits: sum(rows, "deposits"), transfers: sum(rows, "transfers"), total: sum(rows, "total") };
    })
    .sort((a, b) => b.total - a.total);

  const everyone = list.flatMap((bank) => bank.people);
  return {
    banks: list,
    totals: { deposits: sum(everyone, "deposits"), transfers: sum(everyone, "transfers"), total: sum(everyone, "total") },
  };
}

/**
 * One person's whole picture for the dates chosen: every sale with every item
 * on it, and what else touched their money: deductions, expenses, stock lost
 * or damaged, bank deposits, National ID and Telebirr. A supervisor reads
 * people in their own branch, a salesperson only themselves.
 */
export async function getPersonReport(
  query: { userId: string; from?: string; to?: string },
  viewer: Viewer,
) {
  const person = await prisma.user.findUnique({
    where: { id: viewer.role === "SALES" ? viewer.userId : query.userId },
    select: { id: true, name: true, role: true, branchId: true, branch: { select: { name: true } } },
  });
  if (!person || person.role === "OWNER") throw new Error("PERSON_NOT_FOUND");
  if (viewer.role === "SUPERVISOR" && person.branchId !== viewer.branchId) throw new Error("PERSON_NOT_FOUND");

  const when = {
    ...(query.from ? { gte: startOfDay(query.from) } : {}),
    ...(query.to ? { lte: endOfDay(query.to) } : {}),
  };
  const hasWindow = Boolean(query.from || query.to);
  const days = {
    ...(query.from ? { gte: query.from.slice(0, 10) } : {}),
    ...(query.to ? { lte: query.to.slice(0, 10) } : {}),
  };

  const [sales, deductions, expenses, losses, deposits, orders, telebirr] = await Promise.all([
    prisma.sale.findMany({
      where: { salespersonId: person.id, status: "APPROVED", ...(hasWindow ? { saleDate: when } : {}) },
      select: {
        id: true,
        saleDate: true,
        totalAmount: true,
        cashReceived: true,
        transferReceived: true,
        paymentMethod: true,
        bankName: true,
        items: { select: { quantity: true, lineTotal: true, product: { select: { name: true } } } },
      },
      orderBy: { saleDate: "desc" },
    }),
    prisma.deduction.findMany({
      where: { userId: person.id, ...(hasWindow ? { day: days } : {}) },
      select: {
        id: true,
        day: true,
        total: true,
        note: true,
        lines: { select: { productId: true, label: true, quantity: true, amount: true } },
      },
      orderBy: { day: "desc" },
    }),
    prisma.expense.findMany({
      where: { spentById: person.id, ...(hasWindow ? { expenseDate: when } : {}) },
      select: { id: true, expenseDate: true, reason: true, amount: true, note: true },
      orderBy: { expenseDate: "desc" },
    }),
    prisma.stockLossReport.findMany({
      where: { reportedById: person.id, ...(hasWindow ? { createdAt: when } : {}) },
      select: {
        id: true,
        createdAt: true,
        kind: true,
        status: true,
        quantity: true,
        reason: true,
        product: { select: { name: true, price: true } },
      },
      orderBy: { createdAt: "desc" },
    }),
    prisma.bankReceipt.findMany({
      where: { uploadedById: person.id, ...(hasWindow ? { receiptDate: when } : {}) },
      select: { id: true, receiptDate: true, bankName: true, amount: true, status: true },
      orderBy: { receiptDate: "desc" },
    }),
    prisma.nationalIdOrder.findMany({
      where: { recordedById: person.id, ...(hasWindow ? { createdAt: when } : {}) },
      select: { price: true, transferAmount: true },
    }),
    prisma.telebirrTransaction.findMany({
      where: { recordedById: person.id, ...(hasWindow ? { createdAt: when } : {}) },
      select: { amount: true, transferAmount: true },
    }),
  ]);

  const n = (value: { toNumber(): number }) => value.toNumber();
  const round = (value: number) => Math.round(value * 100) / 100;
  const add = (list: number[]) => round(list.reduce((sum, value) => sum + value, 0));

  return {
    person: { id: person.id, name: person.name, role: person.role, branch: person.branch?.name ?? null },
    totals: {
      sales: add(sales.map((row) => n(row.totalAmount))),
      salesCount: sales.length,
      items: sales.reduce((sum, row) => sum + row.items.reduce((acc, item) => acc + item.quantity, 0), 0),
      cash: add(sales.map((row) => n(row.cashReceived))),
      transfer: add(sales.map((row) => n(row.transferReceived))),
      nationalId: add(orders.map((row) => n(row.price))),
      telebirr: add(telebirr.map((row) => n(row.amount))),
      deductions: add(deductions.map((row) => n(row.total))),
      expenses: add(expenses.map((row) => n(row.amount))),
      lost: add(losses.filter((row) => row.status !== "REJECTED").map((row) => n(row.product.price) * row.quantity)),
      banked: add(deposits.filter((row) => row.status === "VERIFIED").map((row) => n(row.amount))),
    },
    sales: sales.map((row) => ({
      id: row.id,
      date: row.saleDate.toISOString(),
      total: n(row.totalAmount),
      cash: n(row.cashReceived),
      transfer: n(row.transferReceived),
      paymentMethod: row.paymentMethod,
      bankName: row.bankName,
      items: row.items.map((item) => ({ name: item.product.name, quantity: item.quantity, total: n(item.lineTotal) })),
    })),
    deductions: deductions.map((row) => ({
      id: row.id,
      day: row.day,
      total: n(row.total),
      note: row.note,
      lines: row.lines.map((line) => ({
        label: line.productId ? line.label : null,
        quantity: line.quantity,
        amount: n(line.amount),
      })),
    })),
    expenses: expenses.map((row) => ({
      id: row.id,
      date: row.expenseDate.toISOString(),
      reason: row.reason,
      note: row.note,
      amount: n(row.amount),
    })),
    losses: losses.map((row) => ({
      id: row.id,
      date: row.createdAt.toISOString(),
      kind: row.kind,
      status: row.status,
      product: row.product.name,
      quantity: row.quantity,
      value: round(n(row.product.price) * row.quantity),
      reason: row.reason,
    })),
    deposits: deposits.map((row) => ({
      id: row.id,
      date: row.receiptDate.toISOString(),
      bankName: row.bankName,
      amount: n(row.amount),
      status: row.status,
    })),
  };
}

/**
 * National ID and Telebirr money per person per day, split into cash and
 * transfer, so a day of sales can carry them alongside the items sold. Scoped
 * like everything else: a salesperson their own, a supervisor their branch.
 */
export async function getOtherDaily(
  query: { from?: string; to?: string; branchId?: string },
  viewer: Viewer,
) {
  const when = {
    ...(query.from ? { gte: startOfDay(query.from) } : {}),
    ...(query.to ? { lte: endOfDay(query.to) } : {}),
  };
  const hasWindow = Boolean(query.from || query.to);
  const branch =
    viewer.role === "SUPERVISOR" ? (viewer.branchId ?? "__none__") : viewer.role === "OWNER" ? query.branchId || undefined : undefined;
  const scope =
    viewer.role === "SALES" ? { recordedById: viewer.userId } : branch ? { locationId: branch } : {};
  const person = { select: { id: true, name: true } };
  const days = {
    ...(query.from ? { gte: query.from.slice(0, 10) } : {}),
    ...(query.to ? { lte: query.to.slice(0, 10) } : {}),
  };

  const [orders, telebirr, deductions, deposits, expenses, declaredYadere] = await Promise.all([
    prisma.nationalIdOrder.findMany({
      where: { ...scope, ...(hasWindow ? { createdAt: when } : {}) },
      select: { kind: true, price: true, transferAmount: true, bankName: true, createdAt: true, recordedBy: person, location: { select: { name: true } } },
    }),
    prisma.telebirrTransaction.findMany({
      where: { ...scope, ...(hasWindow ? { createdAt: when } : {}) },
      select: { amount: true, transferAmount: true, bankName: true, createdAt: true, recordedBy: person, location: { select: { name: true } } },
    }),
    // Money taken off the person that day: it comes off the day's takings.
    prisma.deduction.findMany({
      where: {
        ...(hasWindow ? { day: days } : {}),
        ...(viewer.role === "SALES" ? { userId: viewer.userId } : branch ? { user: { branchId: branch } } : {}),
      },
      select: {
        day: true,
        total: true,
        note: true,
        user: { select: { id: true, name: true, branch: { select: { name: true } } } },
        lines: { select: { productId: true, label: true, quantity: true, amount: true } },
      },
    }),
    // Cash the person took to the bank that day; a rejected slip never counted.
    prisma.bankReceipt.findMany({
      where: {
        status: { not: "REJECTED" },
        ...(hasWindow ? { receiptDate: when } : {}),
        ...(viewer.role === "SALES" ? { uploadedById: viewer.userId } : branch ? { uploadedBy: { branchId: branch } } : {}),
      },
      select: {
        amount: true,
        bankName: true,
        status: true,
        receiptDate: true,
        uploadedBy: { select: { id: true, name: true, role: true, branch: { select: { name: true } } } },
        location: { select: { name: true } },
      },
    }),
    // Paid out of the person's cash that day.
    prisma.expense.findMany({
      where: {
        spentById: viewer.role === "SALES" ? viewer.userId : { not: null },
        ...(hasWindow ? { expenseDate: when } : {}),
        ...(viewer.role !== "SALES" && branch ? { locationId: branch } : {}),
      },
      select: {
        amount: true,
        reason: true,
        expenseDate: true,
        location: { select: { name: true } },
        spentBy: { select: { id: true, name: true, role: true, branch: { select: { name: true } } } },
      },
    }),
    prisma.salesYadere.findMany({
      where: {
        ...(hasWindow ? { day: when } : {}),
        ...(viewer.role === "SALES" ? { salespersonId: viewer.userId } : branch ? { salesperson: { branchId: branch } } : {}),
      },
      select: {
        day: true,
        amount: true,
        salesperson: { select: { branch: { select: { name: true } } } },
      },
    }),
  ]);

  type Money = { count: number; amount: number; cash: number; transfer: number };
  const money = (): Money => ({ count: 0, amount: 0, cash: 0, transfer: 0 });
  const rows = new Map<
    string,
    {
      date: string;
      person: { id: string; name: string };
      branch: string;
      nationalId: Money;
      /** National ID split by kind: how many and for how much. */
      nidOriginal: { count: number; amount: number };
      nidCopy: { count: number; amount: number };
      telebirr: Money;
      deposits: { amount: number; items: { bankName: string | null; amount: number; status: string }[] };
      /** National ID and Telebirr money customers sent to a bank. */
      transfers: { bankName: string | null; amount: number }[];
      expenses: { amount: number; items: { reason: string; amount: number }[] };
      deductions: { amount: number; items: { label: string | null; quantity: number; amount: number; note: string | null }[] };
    }
  >();
  const at = (date: Date, who: { id: string; name: string }, branch: string) => {
    const key = `${dayKey(date)}|${who.id}`;
    const row =
      rows.get(key) ??
      {
        date: dayKey(date),
        person: who,
        branch,
        nationalId: money(),
        nidOriginal: { count: 0, amount: 0 },
        nidCopy: { count: 0, amount: 0 },
        telebirr: money(),
        deposits: { amount: 0, items: [] },
        transfers: [],
        expenses: { amount: 0, items: [] },
        deductions: { amount: 0, items: [] },
      };
    rows.set(key, row);
    return row;
  };
  const add = (into: Money, amount: number, transfer: number) => {
    into.count += 1;
    into.amount += amount;
    into.transfer += transfer;
    into.cash += amount - transfer;
  };

  for (const row of orders) {
    const day = at(row.createdAt, row.recordedBy, row.location.name);
    add(day.nationalId, row.price.toNumber(), row.transferAmount.toNumber());
    const kind = row.kind === "COPY" ? day.nidCopy : day.nidOriginal;
    kind.count += 1;
    kind.amount += row.price.toNumber();
    if (row.transferAmount.toNumber() > 0) day.transfers.push({ bankName: row.bankName, amount: row.transferAmount.toNumber() });
  }
  for (const row of telebirr) {
    const day = at(row.createdAt, row.recordedBy, row.location.name);
    add(day.telebirr, row.amount.toNumber(), row.transferAmount.toNumber());
    if (row.transferAmount.toNumber() > 0) day.transfers.push({ bankName: row.bankName, amount: row.transferAmount.toNumber() });
  }

  // A salesperson's slip comes off their own day. A supervisor (or the
  // Owner) banks the branch's takings, so theirs comes off the branch's day.
  // The same for expenses: the supervisor pays theirs out of the money
  // collected from the whole branch.
  const branchDeposits = new Map<
    string,
    {
      date: string;
      branch: string;
      amount: number;
      items: { bankName: string | null; amount: number; status: string; by: string }[];
      expenseAmount: number;
      expenses: { reason: string; amount: number; by: string }[];
    }
  >();

  for (const row of expenses) {
    if (!row.spentBy) continue;
    if (row.spentBy.role !== "SALES") {
      const branchName = row.location?.name ?? row.spentBy.branch?.name ?? "—";
      const key = `${dayKey(row.expenseDate)}|${branchName}`;
      const entry = branchDeposits.get(key) ?? {
        date: dayKey(row.expenseDate),
        branch: branchName,
        amount: 0,
        items: [],
        expenseAmount: 0,
        expenses: [],
      };
      entry.expenseAmount += row.amount.toNumber();
      entry.expenses.push({ reason: row.reason, amount: row.amount.toNumber(), by: row.spentBy.name });
      branchDeposits.set(key, entry);
      continue;
    }
    const day = at(row.expenseDate, { id: row.spentBy.id, name: row.spentBy.name }, row.spentBy.branch?.name ?? "—");
    day.expenses.amount += row.amount.toNumber();
    day.expenses.items.push({ reason: row.reason, amount: row.amount.toNumber() });
  }
  for (const row of deposits) {
    if (row.uploadedBy.role === "SALES") {
      const day = at(row.receiptDate, { id: row.uploadedBy.id, name: row.uploadedBy.name }, row.uploadedBy.branch?.name ?? "—");
      day.deposits.amount += row.amount.toNumber();
      day.deposits.items.push({ bankName: row.bankName, amount: row.amount.toNumber(), status: row.status });
      continue;
    }
    const branchName = row.location?.name ?? row.uploadedBy.branch?.name ?? "—";
    const key = `${dayKey(row.receiptDate)}|${branchName}`;
    const entry = branchDeposits.get(key) ?? {
      date: dayKey(row.receiptDate),
      branch: branchName,
      amount: 0,
      items: [],
      expenseAmount: 0,
      expenses: [],
    };
    entry.amount += row.amount.toNumber();
    entry.items.push({ bankName: row.bankName, amount: row.amount.toNumber(), status: row.status, by: row.uploadedBy.name });
    branchDeposits.set(key, entry);
  }

  for (const row of deductions) {
    const day = at(new Date(`${row.day}T12:00:00`), { id: row.user.id, name: row.user.name }, row.user.branch?.name ?? "—");
    day.deductions.amount += row.total.toNumber();
    for (const line of row.lines) {
      day.deductions.items.push({
        // A product's name, or null for money with no product behind it.
        label: line.productId ? line.label : null,
        quantity: line.quantity,
        amount: line.amount.toNumber(),
        note: line.productId ? null : row.note,
      });
    }
  }

  const branchYadereDaily = new Map<string, { date: string; branch: string; amount: number }>();
  for (const row of declaredYadere) {
    const branchName = row.salesperson.branch?.name ?? "—";
    const date = dayKey(row.day);
    const key = `${date}|${branchName}`;
    const entry = branchYadereDaily.get(key) ?? { date, branch: branchName, amount: 0 };
    entry.amount += row.amount.toNumber();
    branchYadereDaily.set(key, entry);
  }

  return { days: [...rows.values()], branchDeposits: [...branchDeposits.values()], branchYadereDaily: [...branchYadereDaily.values()] };
}

/**
 * Per branch name: the yadere the branch held when a day began. Salespeople
 * hold nothing overnight: everything they took in cash, less deductions,
 * expenses and what they banked, went to the supervisor, who banked what they
 * could. What is left of all of it, before the day, is the branch's yadere.
 */
export async function branchYadereBefore(from: string, viewer: Viewer, branchId?: string) {
  const branch =
    viewer.role === "SUPERVISOR" ? (viewer.branchId ?? "__none__") : viewer.role === "OWNER" ? branchId || undefined : "__none__";
  const before = startOfDay(from);
  const at = branch ? { locationId: branch } : {};

  const [sales, orders, telebirr, deductions, expenses, receipts, locations] = await Promise.all([
    prisma.sale.findMany({
      where: { status: "APPROVED", saleDate: { lt: before }, ...at },
      select: { locationId: true, totalAmount: true, transferReceived: true },
    }),
    prisma.nationalIdOrder.findMany({
      where: { createdAt: { lt: before }, ...at },
      select: { locationId: true, price: true, transferAmount: true },
    }),
    prisma.telebirrTransaction.findMany({
      where: { createdAt: { lt: before }, ...at },
      select: { locationId: true, amount: true, transferAmount: true },
    }),
    prisma.deduction.findMany({
      where: { day: { lt: from.slice(0, 10) }, ...(branch ? { user: { branchId: branch } } : {}) },
      select: { total: true, user: { select: { branchId: true } } },
    }),
    prisma.expense.findMany({
      where: { spentById: { not: null }, expenseDate: { lt: before }, ...at },
      select: { locationId: true, amount: true },
    }),
    prisma.bankReceipt.findMany({
      where: { status: { not: "REJECTED" }, receiptDate: { lt: before }, ...at },
      select: { locationId: true, amount: true },
    }),
    prisma.stockLocation.findMany({ select: { id: true, name: true } }),
  ]);

  const held = new Map<string, number>();
  const move = (locationId: string | null | undefined, amount: number) => {
    if (!locationId) return;
    held.set(locationId, (held.get(locationId) ?? 0) + amount);
  };
  for (const row of sales) {
    const total = row.totalAmount.toNumber();
    move(row.locationId, total - Math.min(row.transferReceived.toNumber(), total));
  }
  for (const row of orders) move(row.locationId, row.price.toNumber() - row.transferAmount.toNumber());
  for (const row of telebirr) move(row.locationId, row.amount.toNumber() - row.transferAmount.toNumber());
  for (const row of deductions) move(row.user.branchId, -row.total.toNumber());
  for (const row of expenses) move(row.locationId, -row.amount.toNumber());
  for (const row of receipts) move(row.locationId, -row.amount.toNumber());

  const names = new Map(locations.map((row) => [row.id, row.name]));
  const out: Record<string, number> = {};
  for (const [id, amount] of held) out[names.get(id) ?? "—"] = Math.round(amount * 100) / 100;
  return out;
}

export function cashPositionCsv(
  report: Awaited<ReturnType<typeof getCashPosition>>,
) {
  const people = toCsv(
    [
      "Salesperson",
      "Branch",
      "Brought forward",
      "Sold",
      "National ID + Telebirr cash",
      "Handed to supervisor",
      "Taken in from team",
      "Banked",
      "Expenses",
      "Deductions",
      "Still in hand",
    ],
    [
      ...report.salespeople.map((p) => [
        p.name,
        p.branch ?? "",
        p.opening.toFixed(2),
        p.sold.toFixed(2),
        p.other.toFixed(2),
        p.handedOver.toFixed(2),
        p.collected.toFixed(2),
        p.banked.toFixed(2),
        p.expenses.toFixed(2),
        p.deductions.toFixed(2),
        p.inHand.toFixed(2),
      ]),
      [
        "TOTAL",
        "",
        report.totals.opening.toFixed(2),
        report.totals.sold.toFixed(2),
        report.totals.other.toFixed(2),
        report.totals.handedOver.toFixed(2),
        report.totals.collected.toFixed(2),
        report.totals.banked.toFixed(2),
        report.totals.expenses.toFixed(2),
        report.totals.deductions.toFixed(2),
        report.totals.inHand.toFixed(2),
      ],
    ],
  );

  if (!report.days) return people;

  // One file, two tables: who holds what, then how the money moved day by
  // day. A blank line keeps the two apart when the file opens in Excel.
  const ledger = toCsv(
    ["Date", "Brought forward", "Collected", "Expenses and deductions", "Deposited", "Carried forward"],
    report.days.map((day) => [
      day.date,
      day.opening.toFixed(2),
      day.collected.toFixed(2),
      day.spent.toFixed(2),
      day.deposited.toFixed(2),
      day.closing.toFixed(2),
    ]),
  );

  return `${people}\n\n${ledger}`;
}

export function inventoryReportCsv(
  report: Awaited<ReturnType<typeof getInventoryReport>>,
) {
  return toCsv(
    ["Branch", "SKU", "Product", "Category", "Quantity", "Value"],
    report.branches.flatMap((branch) =>
      branch.items.map((item) => [
        branch.name,
        item.sku,
        item.name,
        item.category,
        item.quantity,
        item.value.toFixed(2),
      ]),
    ),
  );
}

/**
 * Every phone and SIM card sold, one row per unit, with the IMEI or ICCID the
 * seller typed at the sale. Stock is counted by quantity until then, so this
 * is where each handset's details first appear. Scoped like the sales report.
 */
export async function getSoldUnits(
  query: { from?: string; to?: string; branchId?: string },
  viewer: Viewer,
) {
  const units = await prisma.inventoryUnit.findMany({
    where: {
      saleItem: {
        sale: {
          status: "APPROVED",
          ...salesScope(viewer, query),
          ...dateRange(query.from, query.to),
        },
      },
    },
    select: {
      id: true,
      imei: true,
      iccid: true,
      product: {
        select: {
          name: true,
          category: true,
          phoneDetails: { select: { model: true, storage: true, color: true } },
          type: { select: { name: true, parent: { select: { name: true } } } },
        },
      },
      saleItem: {
        select: {
          unitPrice: true,
          sale: {
            select: {
              id: true,
              saleDate: true,
              notes: true,
              location: { select: { name: true } },
              salesperson: { select: { name: true } },
            },
          },
        },
      },
    },
    take: 2000,
  });

  return units
    .map((unit) => ({
      id: unit.id,
      date: unit.saleItem!.sale.saleDate.toISOString(),
      saleId: unit.saleItem!.sale.id,
      branch: unit.saleItem!.sale.location.name,
      salesperson: unit.saleItem!.sale.salesperson.name,
      category: unit.product.category,
      product: unit.product.name,
      brand: unit.product.type?.parent?.name ?? unit.product.type?.name ?? null,
      model: unit.product.phoneDetails?.model ?? null,
      storage: unit.product.phoneDetails?.storage ?? null,
      color: unit.product.phoneDetails?.color ?? null,
      serial: unit.imei ?? unit.iccid ?? null,
      price: unit.saleItem!.unitPrice.toNumber(),
      note: unit.saleItem!.sale.notes,
    }))
    .sort((a, b) => b.date.localeCompare(a.date));
}

/**
 * The money each branch took each day: item sales, split into the cash kept
 * (cash received less any change handed back) and transfers, plus National ID
 * prints and copies. This is what the salespeople collect and hand to their
 * supervisor. Scoped like the sales report: the Owner every branch, a
 * supervisor theirs, a salesperson their own sales.
 */
export async function getDailyMoney(
  query: { from?: string; to?: string; branchId?: string },
  viewer: Viewer,
) {
  const range = dateRange(query.from, query.to).saleDate;
  const branchOnly =
    viewer.role === "OWNER" ? query.branchId || undefined : (viewer.branchId ?? "__none__");
  const mineOnly = viewer.role === "SALES";

  // Expenses are stamped at local midnight and deductions carry a plain day,
  // so both are windowed by day rather than by the instant.
  const dayWindow = {
    ...(query.from ? { gte: startOfDay(query.from) } : {}),
    ...(query.to ? { lte: endOfDay(query.to) } : {}),
  };
  const [sales, nidOrders, nidRecords, telebirr, locations, deductions, expenses] = await Promise.all([
    prisma.sale.findMany({
      where: { status: "APPROVED", ...salesScope(viewer, query), ...(range ? { saleDate: range } : {}) },
      select: {
        saleDate: true,
        locationId: true,
        totalAmount: true,
        cashReceived: true,
        transferReceived: true,
      },
    }),
    prisma.nationalIdOrder.findMany({
      where: {
        ...(range ? { createdAt: range } : {}),
        ...(branchOnly ? { locationId: branchOnly } : {}),
        ...(mineOnly ? { recordedById: viewer.userId } : {}),
      },
      select: { kind: true, price: true, transferAmount: true, locationId: true, createdAt: true },
    }),
    // The older daily National ID records; a salesperson has none of their own.
    mineOnly
      ? Promise.resolve([])
      : prisma.nationalIdRecord.findMany({
          where: { ...(range ? { date: range } : {}), ...(branchOnly ? { locationId: branchOnly } : {}) },
          select: {
            date: true,
            locationId: true,
            originalCount: true,
            copyCount: true,
            originalRate: true,
            copyRate: true,
          },
        }),
    prisma.telebirrTransaction.findMany({
      where: {
        ...(range ? { createdAt: range } : {}),
        ...(branchOnly ? { locationId: branchOnly } : {}),
        ...(mineOnly ? { recordedById: viewer.userId } : {}),
      },
      select: { amount: true, transferAmount: true, locationId: true, createdAt: true },
    }),
    prisma.stockLocation.findMany({ select: { id: true, name: true } }),
    // Money lost: it comes off the day's cash (and off the person's salary).
    prisma.deduction.findMany({
      where: {
        ...(query.from || query.to
          ? { day: { ...(query.from ? { gte: query.from.slice(0, 10) } : {}), ...(query.to ? { lte: query.to.slice(0, 10) } : {}) } }
          : {}),
        ...(branchOnly ? { user: { branchId: branchOnly } } : {}),
        ...(mineOnly ? { userId: viewer.userId } : {}),
      },
      select: { day: true, total: true, user: { select: { branchId: true } } },
    }),
    // Paid out of someone's cash; older expenses that name nobody stay out.
    prisma.expense.findMany({
      where: {
        spentById: mineOnly ? viewer.userId : { not: null },
        ...(query.from || query.to ? { expenseDate: dayWindow } : {}),
        ...(branchOnly ? { locationId: branchOnly } : {}),
      },
      select: { amount: true, expenseDate: true, locationId: true },
    }),
  ]);

  const dayOf = (date: Date) =>
    `${date.getFullYear()}-${`${date.getMonth() + 1}`.padStart(2, "0")}-${`${date.getDate()}`.padStart(2, "0")}`;
  const names = new Map(locations.map((row) => [row.id, row.name]));
  // Each kind of income on its own, split into cash kept and transfer.
  const FIELDS = [
    "sales", "salesCash", "salesTransfer",
    "idOriginal", "idCopy", "idCash", "idTransfer",
    "telebirr", "telebirrCash", "telebirrTransfer",
    "deductions", "expenses",
  ] as const;
  type Row = Record<(typeof FIELDS)[number], number>;
  const rows = new Map<string, Row>();
  const at = (date: Date, locationId: string) => {
    const key = `${dayOf(date)}|${locationId}`;
    const row = rows.get(key) ?? (Object.fromEntries(FIELDS.map((field) => [field, 0])) as Row);
    rows.set(key, row);
    return row;
  };

  for (const sale of sales) {
    const total = sale.totalAmount.toNumber();
    const cash = sale.cashReceived.toNumber();
    const transfer = sale.transferReceived.toNumber();
    // Change goes back in cash, so it is not money kept.
    const change = Math.max(0, cash + transfer - total);
    const row = at(sale.saleDate, sale.locationId);
    row.sales += total;
    row.salesCash += Math.max(0, cash - change);
    row.salesTransfer += transfer;
  }
  for (const order of nidOrders) {
    const row = at(order.createdAt, order.locationId);
    const price = order.price.toNumber();
    const transfer = order.transferAmount.toNumber();
    if (order.kind === "COPY") row.idCopy += price;
    else row.idOriginal += price;
    row.idCash += price - transfer;
    row.idTransfer += transfer;
  }
  // The older daily records were all taken in cash.
  for (const record of nidRecords) {
    const row = at(record.date, record.locationId);
    const original = record.originalRate.toNumber() * record.originalCount;
    const copy = record.copyRate.toNumber() * record.copyCount;
    row.idOriginal += original;
    row.idCopy += copy;
    row.idCash += original + copy;
  }
  for (const entry of telebirr) {
    const row = at(entry.createdAt, entry.locationId);
    const amount = entry.amount.toNumber();
    const transfer = entry.transferAmount.toNumber();
    row.telebirr += amount;
    row.telebirrCash += amount - transfer;
    row.telebirrTransfer += transfer;
  }
  for (const entry of deductions) {
    if (!entry.user.branchId) continue;
    at(new Date(`${entry.day}T12:00:00`), entry.user.branchId).deductions += entry.total.toNumber();
  }
  for (const entry of expenses) {
    at(entry.expenseDate, entry.locationId).expenses += entry.amount.toNumber();
  }

  const round = (value: number) => Math.round(value * 100) / 100;
  return [...rows.entries()]
    .map(([key, row]) => {
      const [date, branchId] = key.split("|");
      return {
        date,
        branchId,
        branch: names.get(branchId) ?? "—",
        ...(Object.fromEntries(FIELDS.map((field) => [field, round(row[field])])) as Row),
        cash: round(row.salesCash + row.idCash + row.telebirrCash),
        // The cash to hand in: taken in, less money lost and paid out.
        cashLeft: round(row.salesCash + row.idCash + row.telebirrCash - row.deductions - row.expenses),
        transfer: round(row.salesTransfer + row.idTransfer + row.telebirrTransfer),
        total: round(row.sales + row.idOriginal + row.idCopy + row.telebirr - row.deductions - row.expenses),
      };
    })
    .sort((a, b) => b.date.localeCompare(a.date) || a.branch.localeCompare(b.branch));
}

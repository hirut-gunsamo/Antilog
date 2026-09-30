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
  };
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
 * Cash held before the report's first day — "yadere", the balance brought
 * forward.
 *
 * Sales made after the bank shuts cannot be deposited the same day, so the
 * money sits with the salesperson overnight and is banked the next morning.
 * That carry-over is not a figure anyone types: it is every cash sale ever
 * made, less every verified deposit, up to the day before this report starts.
 */
async function openingBalances(
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
            ...(query.from ? { gte: new Date(query.from) } : {}),
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
              ...(query.from ? { gte: new Date(query.from) } : {}),
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

  // One line for everyone, whatever their role: what they started with, plus
  // what came in, less what went out. A seller takes cash in over the counter
  // and hands it up; a supervisor takes it in from sellers and banks it, and
  // whatever is left with them tonight is the yadere.
  for (const person of people.values()) {
    person.inHand =
      person.opening +
      person.sold +
      person.collected -
      person.handedOver -
      person.banked;
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
      handedOver: rows.reduce((s, r) => s + r.handedOver, 0),
      collected: rows.reduce((s, r) => s + r.collected, 0),
      banked: rows.reduce((s, r) => s + r.banked, 0),
      inHand: rows.reduce((s, r) => s + r.inHand, 0),
    },
    days: dailyLedger(query, sales, receipts, rows),
  };
}

/** A day in the cash ledger: what was carried in, moved, and carried out. */
type LedgerDay = {
  date: string;
  opening: number;
  collected: number;
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
): LedgerDay[] | null {
  if (!query.from || !query.to) return null;

  const collected = new Map<string, number>();
  const deposited = new Map<string, number>();

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
      deposited: deposited.get(key) ?? 0,
      closing: 0,
    };

    day.closing = day.opening + day.collected - day.deposited;
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
      : await prisma.inventoryBalance.findMany({
          where: branchId ? { locationId: branchId } : {},
          select: {
            quantity: true,
            product: { select: productSelect },
            location: { select: { id: true, name: true } },
          },
        });

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

export function cashPositionCsv(
  report: Awaited<ReturnType<typeof getCashPosition>>,
) {
  const people = toCsv(
    [
      "Salesperson",
      "Branch",
      "Brought forward",
      "Sold",
      "Handed to supervisor",
      "Taken in from team",
      "Banked",
      "Still in hand",
    ],
    [
      ...report.salespeople.map((p) => [
        p.name,
        p.branch ?? "",
        p.opening.toFixed(2),
        p.sold.toFixed(2),
        p.handedOver.toFixed(2),
        p.collected.toFixed(2),
        p.banked.toFixed(2),
        p.inHand.toFixed(2),
      ]),
      [
        "TOTAL",
        "",
        report.totals.opening.toFixed(2),
        report.totals.sold.toFixed(2),
        report.totals.handedOver.toFixed(2),
        report.totals.collected.toFixed(2),
        report.totals.banked.toFixed(2),
        report.totals.inHand.toFixed(2),
      ],
    ],
  );

  if (!report.days) return people;

  // One file, two tables: who holds what, then how the money moved day by
  // day. A blank line keeps the two apart when the file opens in Excel.
  const ledger = toCsv(
    ["Date", "Brought forward", "Collected", "Deposited", "Carried forward"],
    report.days.map((day) => [
      day.date,
      day.opening.toFixed(2),
      day.collected.toFixed(2),
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

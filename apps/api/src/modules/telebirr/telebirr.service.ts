import { Prisma } from "database";
import { grantedDays, ownEntryEditable } from "../../utils/editGrant.js";

import type { Viewer } from "../../middleware/auth.js";
import { prisma } from "../../plugins/prisma.js";
import { paymentColumns, type PaymentInput } from "../../utils/payment.js";

/**
 * Telebirr: every branch has its own Telebirr account, so its own balance.
 * The Owner loads money into one branch; that branch's sellers spend it on
 * cash-ins (a customer pays cash and gets Telebirr money) and on airtime sold
 * from Telebirr. A branch's balance = its loads less its transactions.
 */

export const KINDS = ["CASH_IN", "AIRTIME"] as const;
export type Kind = (typeof KINDS)[number];

// Two sellers spending the last of a branch's balance at once cannot both
// succeed. The lock is per branch, so branches never wait on each other.
const BALANCE_LOCK = 734_216_002;

type Tx = Prisma.TransactionClient;

async function balanceOf(db: Tx | typeof prisma, locationId: string) {
  const [loads, spent] = await Promise.all([
    db.telebirrLoad.aggregate({ where: { locationId }, _sum: { amount: true } }),
    db.telebirrTransaction.aggregate({ where: { locationId }, _sum: { amount: true } }),
  ]);

  const loaded = loads._sum.amount ?? new Prisma.Decimal(0);
  return loaded.minus(spent._sum.amount ?? new Prisma.Decimal(0));
}

/** Every active branch with what is left in its Telebirr account. */
async function balancesByBranch() {
  const [branches, loads, spent] = await Promise.all([
    prisma.stockLocation.findMany({
      where: { isActive: true },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
    prisma.telebirrLoad.groupBy({ by: ["locationId"], _sum: { amount: true } }),
    prisma.telebirrTransaction.groupBy({ by: ["locationId"], _sum: { amount: true } }),
  ]);

  const loaded = new Map(loads.map((row) => [row.locationId, Number(row._sum.amount ?? 0)]));
  const used = new Map(spent.map((row) => [row.locationId, Number(row._sum.amount ?? 0)]));

  return branches.map((branch) => ({
    ...branch,
    balance: (loaded.get(branch.id) ?? 0) - (used.get(branch.id) ?? 0),
  }));
}

async function lock(tx: Tx, locationId: string) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(${BALANCE_LOCK}::int4, hashtext(${locationId}))`;
}

export async function loadMoney(
  viewer: Viewer,
  data: { amount: number; branchId: string; note?: string },
) {
  const branch = await prisma.stockLocation.findFirst({
    where: { id: data.branchId, isActive: true },
    select: { id: true },
  });
  if (!branch) throw new Error("BRANCH_REQUIRED");

  return prisma.telebirrLoad.create({
    data: {
      amount: new Prisma.Decimal(data.amount),
      locationId: branch.id,
      note: data.note?.trim() || null,
      createdById: viewer.userId,
    },
  });
}

export async function record(
  viewer: Viewer,
  data: {
    kind: Kind;
    amount: number;
    branchId?: string;
    customerPhone?: string;
    note?: string;
  } & PaymentInput,
) {
  // How the customer paid; refused before anything is locked.
  const payment = paymentColumns(data, data.amount);

  // Sellers and supervisors record for their own branch; the Owner names one.
  const locationId = viewer.role === "OWNER" ? data.branchId : viewer.branchId;
  if (!locationId) throw new Error("BRANCH_REQUIRED");

  const amount = new Prisma.Decimal(data.amount);

  return prisma.$transaction(async (tx) => {
    await lock(tx, locationId);

    // A sale done on the real Telebirr account is always recorded, even when
    // the Owner has not recorded a load yet; the page shows the shortfall.
    return tx.telebirrTransaction.create({
      data: {
        kind: data.kind,
        amount,
        locationId,
        recordedById: viewer.userId,
        customerPhone: data.customerPhone?.trim() || null,
        note: data.note?.trim() || null,
        ...payment,
      },
    });
  });
}

/**
 * Who may change an entry: the Owner any, a supervisor their branch's, a
 * seller only their own from today or a day the Owner opened.
 */
async function loadEditable(viewer: Viewer, id: string, action: "edit" | "delete") {
  const row = await prisma.telebirrTransaction.findUnique({ where: { id } });
  if (!row) throw new Error("NOT_FOUND");
  if (viewer.role === "OWNER") return row;
  if (viewer.role === "SUPERVISOR" && row.locationId === viewer.branchId) return row;

  // A seller edits or removes their own, from today or a day the Owner opened.
  void action;
  if (
    viewer.role === "SALES" &&
    row.recordedById === viewer.userId &&
    ownEntryEditable(row.createdAt, await grantedDays(viewer.userId))
  ) {
    return row;
  }
  throw new Error("NOT_ALLOWED");
}

/** A cash-in or airtime corrected: kind, amount, phone, note and payment. */
export async function updateTransaction(
  viewer: Viewer,
  id: string,
  data: { kind: Kind; amount: number; customerPhone?: string; note?: string } & PaymentInput,
) {
  await loadEditable(viewer, id, "edit");
  const payment = paymentColumns(data, data.amount);

  return prisma.telebirrTransaction.update({
    where: { id },
    data: {
      kind: data.kind,
      amount: new Prisma.Decimal(data.amount),
      customerPhone: data.customerPhone?.trim() || null,
      note: data.note?.trim() || null,
      ...payment,
    },
  });
}

/** The Owner or the branch's supervisor removes an entry; its amount goes back. */
export async function deleteTransaction(viewer: Viewer, id: string) {
  await loadEditable(viewer, id, "delete");
  await prisma.telebirrTransaction.delete({ where: { id } });
}

/** A load can only go while its branch's balance still covers it. */
export async function deleteLoad(id: string) {
  await prisma.$transaction(async (tx) => {
    const row = await tx.telebirrLoad.findUnique({ where: { id } });
    if (!row) throw new Error("NOT_FOUND");

    // A load from before branches had their own balance counts towards none.
    if (row.locationId) {
      await lock(tx, row.locationId);

      if ((await balanceOf(tx, row.locationId)).lessThan(row.amount)) {
        throw new Error("LOAD_ALREADY_SPENT");
      }
    }

    await tx.telebirrLoad.delete({ where: { id } });
  });
}

/**
 * A load corrected: its amount or note. Lowering it takes money back off the
 * branch's balance, so that is only allowed while the balance still covers
 * the difference, the same rule as removing a load.
 */
export async function updateLoad(id: string, data: { amount?: number; note?: string | null }) {
  return prisma.$transaction(async (tx) => {
    const row = await tx.telebirrLoad.findUnique({ where: { id } });
    if (!row) throw new Error("NOT_FOUND");

    const amount = data.amount !== undefined ? new Prisma.Decimal(data.amount) : row.amount;
    const lowering = row.amount.minus(amount);
    if (row.locationId && lowering.greaterThan(0)) {
      await lock(tx, row.locationId);
      if ((await balanceOf(tx, row.locationId)).lessThan(lowering)) {
        throw new Error("LOAD_ALREADY_SPENT_EDIT");
      }
    }

    return tx.telebirrLoad.update({
      where: { id },
      data: {
        amount,
        ...(data.note !== undefined ? { note: data.note?.trim() || null } : {}),
      },
    });
  });
}

type Split = { cashIn: number; airtime: number; count: number };
const empty = (): Split => ({ cashIn: 0, airtime: 0, count: 0 });

/**
 * The page's figures for a period. Balances are always the live ones. The
 * Owner sees every branch's balance and loads; a supervisor their branch's
 * balance, loads and records; a seller their branch's balance and their own
 * transactions.
 */
export async function getSummary(
  viewer: Viewer,
  query: { from?: string; to?: string; branchId?: string },
) {
  const now = new Date();
  const from = query.from
    ? new Date(`${query.from.slice(0, 10)}T00:00:00`)
    : new Date(now.getFullYear(), now.getMonth(), 1);
  const to = query.to ? new Date(`${query.to.slice(0, 10)}T00:00:00`) : new Date(now);
  if (query.to) to.setDate(to.getDate() + 1);

  const scope: Prisma.TelebirrTransactionWhereInput =
    viewer.role === "OWNER"
      ? query.branchId
        ? { locationId: query.branchId }
        : {}
      : viewer.role === "SUPERVISOR"
        ? { locationId: viewer.branchId ?? "__none__" }
        : { recordedById: viewer.userId };

  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  // Whose balance the page shows: the Owner's chosen branch (or all of them),
  // anyone else their own branch.
  const balanceBranch = viewer.role === "OWNER" ? query.branchId : viewer.branchId;
  const loadScope: Prisma.TelebirrLoadWhereInput | null =
    viewer.role === "OWNER"
      ? query.branchId
        ? { locationId: query.branchId }
        : {}
      : viewer.role === "SUPERVISOR"
        ? { locationId: viewer.branchId ?? "__none__" }
        : null;

  const [balances, rows, loads, today] = await Promise.all([
    viewer.role === "OWNER" ? balancesByBranch() : Promise.resolve([]),
    prisma.telebirrTransaction.findMany({
      where: { ...scope, createdAt: { gte: from, lt: to } },
      include: {
        location: { select: { id: true, name: true } },
        recordedBy: { select: { id: true, name: true } },
      },
      orderBy: { createdAt: "desc" },
    }),
    loadScope
      ? prisma.telebirrLoad.findMany({
          where: { ...loadScope, createdAt: { gte: from, lt: to } },
          include: {
            createdBy: { select: { id: true, name: true } },
            location: { select: { id: true, name: true } },
          },
          orderBy: { createdAt: "desc" },
        })
      : Promise.resolve([]),
    prisma.telebirrTransaction.findMany({
      where: { ...scope, createdAt: { gte: startOfToday } },
      select: { kind: true, amount: true },
    }),
  ]);

  const add = (split: Split, kind: string, amount: number) => {
    if (kind === "CASH_IN") split.cashIn += amount;
    else split.airtime += amount;
    split.count += 1;
  };

  const period = empty();
  const todaySplit = empty();
  const byBranch = new Map<string, Split & { id: string; name: string }>();
  const bySeller = new Map<string, Split & { id: string; name: string; branch: string }>();

  for (const row of today) add(todaySplit, row.kind, Number(row.amount));

  for (const row of rows) {
    const amount = Number(row.amount);
    add(period, row.kind, amount);

    const branch = byBranch.get(row.locationId) ?? { id: row.locationId, name: row.location.name, ...empty() };
    add(branch, row.kind, amount);
    byBranch.set(row.locationId, branch);

    const seller =
      bySeller.get(row.recordedById) ??
      { id: row.recordedById, name: row.recordedBy.name, branch: row.location.name, ...empty() };
    add(seller, row.kind, amount);
    bySeller.set(row.recordedById, seller);
  }

  // Which of a seller's own entries they may still correct.
  const granted = viewer.role === "SALES" ? await grantedDays(viewer.userId) : new Set<string>();
  const entries = [
    ...rows.map((row) => ({
      id: row.id,
      kind: row.kind as Kind,
      at: row.createdAt,
      amount: row.amount.toString(),
      branch: row.location,
      by: row.recordedBy,
      customerPhone: row.customerPhone,
      note: row.note,
      paymentMethod: row.paymentMethod,
      transferAmount: row.transferAmount.toString(),
      bankName: row.bankName,
      editable:
        viewer.role !== "SALES" ||
        (row.recordedById === viewer.userId && ownEntryEditable(row.createdAt, granted)),
    })),
    ...loads.map((row) => ({
      id: row.id,
      kind: "LOAD" as const,
      at: row.createdAt,
      amount: row.amount.toString(),
      branch: row.location,
      by: row.createdBy,
      customerPhone: null,
      note: row.note,
    })),
  ].sort((a, b) => b.at.getTime() - a.at.getTime());

  const balance =
    viewer.role === "OWNER"
      ? balanceBranch
        ? (balances.find((row) => row.id === balanceBranch)?.balance ?? 0)
        : balances.reduce((sum, row) => sum + row.balance, 0)
      : balanceBranch
        ? Number(await balanceOf(prisma, balanceBranch))
        : 0;

  return {
    balance: balance.toString(),
    balances,
    loadedInPeriod: loads.reduce((sum, row) => sum + Number(row.amount), 0),
    period,
    today: todaySplit,
    byBranch: [...byBranch.values()].sort((a, b) => a.name.localeCompare(b.name)),
    bySeller: [...bySeller.values()].sort((a, b) => a.name.localeCompare(b.name)),
    entries,
  };
}

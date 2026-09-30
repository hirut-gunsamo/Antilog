import { Prisma } from "database";

import type { Viewer } from "../../middleware/auth.js";
import { prisma } from "../../plugins/prisma.js";

/**
 * Telebirr: one money balance the Owner loads. Sellers spend it on cash-ins
 * (a customer pays cash and gets Telebirr money) and on airtime sold from
 * Telebirr; both come off the balance. Balance = loads less transactions.
 */

export const KINDS = ["CASH_IN", "AIRTIME"] as const;
export type Kind = (typeof KINDS)[number];

// Two sellers spending the last of the balance at once cannot both succeed.
const BALANCE_LOCK = 734_216_002;

type Tx = Prisma.TransactionClient;

async function balanceOf(db: Tx | typeof prisma) {
  const [loads, spent] = await Promise.all([
    db.telebirrLoad.aggregate({ _sum: { amount: true } }),
    db.telebirrTransaction.aggregate({ _sum: { amount: true } }),
  ]);

  const loaded = loads._sum.amount ?? new Prisma.Decimal(0);
  return loaded.minus(spent._sum.amount ?? new Prisma.Decimal(0));
}

async function lock(tx: Tx) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(${BALANCE_LOCK})`;
}

export async function loadMoney(viewer: Viewer, data: { amount: number; note?: string }) {
  return prisma.telebirrLoad.create({
    data: {
      amount: new Prisma.Decimal(data.amount),
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
  },
) {
  // Sellers and supervisors record for their own branch; the Owner names one.
  const locationId = viewer.role === "OWNER" ? data.branchId : viewer.branchId;
  if (!locationId) throw new Error("BRANCH_REQUIRED");

  const amount = new Prisma.Decimal(data.amount);

  return prisma.$transaction(async (tx) => {
    await lock(tx);

    if ((await balanceOf(tx)).lessThan(amount)) {
      throw new Error("NOT_ENOUGH_BALANCE");
    }

    return tx.telebirrTransaction.create({
      data: {
        kind: data.kind,
        amount,
        locationId,
        recordedById: viewer.userId,
        customerPhone: data.customerPhone?.trim() || null,
        note: data.note?.trim() || null,
      },
    });
  });
}

/** Owner corrections. A transaction removed puts its amount back. */
export async function deleteTransaction(id: string) {
  const { count } = await prisma.telebirrTransaction.deleteMany({ where: { id } });
  if (count === 0) throw new Error("NOT_FOUND");
}

/** A load can only go while the balance still covers what was spent. */
export async function deleteLoad(id: string) {
  await prisma.$transaction(async (tx) => {
    await lock(tx);

    const row = await tx.telebirrLoad.findUnique({ where: { id } });
    if (!row) throw new Error("NOT_FOUND");

    if ((await balanceOf(tx)).lessThan(row.amount)) {
      throw new Error("LOAD_ALREADY_SPENT");
    }

    await tx.telebirrLoad.delete({ where: { id } });
  });
}

type Split = { cashIn: number; airtime: number; count: number };
const empty = (): Split => ({ cashIn: 0, airtime: 0, count: 0 });

/**
 * The page's figures for a period. The balance is always the live one. The
 * Owner sees every branch and the loads; a supervisor their branch; a seller
 * their own transactions.
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

  const [balance, rows, loads, today] = await Promise.all([
    balanceOf(prisma),
    prisma.telebirrTransaction.findMany({
      where: { ...scope, createdAt: { gte: from, lt: to } },
      include: {
        location: { select: { id: true, name: true } },
        recordedBy: { select: { id: true, name: true } },
      },
      orderBy: { createdAt: "desc" },
    }),
    viewer.role === "OWNER"
      ? prisma.telebirrLoad.findMany({
          where: { createdAt: { gte: from, lt: to } },
          include: { createdBy: { select: { id: true, name: true } } },
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
    })),
    ...loads.map((row) => ({
      id: row.id,
      kind: "LOAD" as const,
      at: row.createdAt,
      amount: row.amount.toString(),
      branch: null,
      by: row.createdBy,
      customerPhone: null,
      note: row.note,
    })),
  ].sort((a, b) => b.at.getTime() - a.at.getTime());

  return {
    balance: balance.toString(),
    loadedInPeriod: loads.reduce((sum, row) => sum + Number(row.amount), 0),
    period,
    today: todaySplit,
    byBranch: [...byBranch.values()].sort((a, b) => a.name.localeCompare(b.name)),
    bySeller: [...bySeller.values()].sort((a, b) => a.name.localeCompare(b.name)),
    entries,
  };
}

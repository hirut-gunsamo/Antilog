import { Prisma } from "database";

import type { Viewer } from "../../middleware/auth.js";
import { prisma } from "../../plugins/prisma.js";

/**
 * Ibid: digital airtime held as one birr balance.
 *
 * The Owner loads birr into the main balance. A branch supervisor prints Ibid
 * cards of one value for a birr amount, and that amount comes off the main
 * balance. Nothing else touches it: printing is not selling, and sold cards
 * are reported with the rest of the airtime.
 */

/** The card values Ethio telecom issues Ibid in. */
export const IBID_VALUES = [10, 15, 25, 50, 100] as const;

/** Ibid is printed by the carta: one carta holds 20 cards. */
export const CARDS_PER_CARTA = 20;

// One lock for everything that moves the balance, so two supervisors printing
// at the same moment cannot both spend the last of it.
const BALANCE_LOCK = 734_216_001;

type Tx = Prisma.TransactionClient;

async function balanceOf(db: Tx | typeof prisma) {
  const [loads, prints] = await Promise.all([
    db.ibidLoad.aggregate({ _sum: { amount: true } }),
    db.ibidPrint.aggregate({ _sum: { amount: true } }),
  ]);

  const loaded = loads._sum.amount ?? new Prisma.Decimal(0);
  const printed = prints._sum.amount ?? new Prisma.Decimal(0);

  return { loaded, printed, balance: loaded.minus(printed) };
}

async function lock(tx: Tx) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(${BALANCE_LOCK})`;
}

export async function loadBalance(
  viewer: Viewer,
  data: { amount: number; note?: string },
) {
  return prisma.ibidLoad.create({
    data: {
      amount: new Prisma.Decimal(data.amount),
      note: data.note?.trim() || null,
      createdById: viewer.userId,
    },
  });
}

export async function printIbid(
  viewer: Viewer,
  data: {
    denomination: number;
    cartas?: number;
    cards?: number;
    branchId?: string;
    note?: string;
  },
) {
  // A supervisor prints for their own branch; the Owner names one.
  const locationId = viewer.role === "OWNER" ? data.branchId : viewer.branchId;

  if (!locationId) throw new Error("BRANCH_REQUIRED");

  if (!IBID_VALUES.includes(data.denomination as (typeof IBID_VALUES)[number])) {
    throw new Error("BAD_VALUE");
  }

  // Counted in carta (20 cards each) and loose cards; the birr follows.
  const cards = (data.cartas ?? 0) * CARDS_PER_CARTA + (data.cards ?? 0);
  if (cards <= 0) throw new Error("NO_CARDS");

  const amount = new Prisma.Decimal(cards * data.denomination);

  return prisma.$transaction(async (tx) => {
    await lock(tx);

    const { balance } = await balanceOf(tx);

    if (balance.lessThan(amount)) {
      throw new Error("NOT_ENOUGH_BALANCE");
    }

    return tx.ibidPrint.create({
      data: {
        locationId,
        denomination: data.denomination,
        amount,
        cards,
        note: data.note?.trim() || null,
        printedById: viewer.userId,
      },
    });
  });
}

/** Owner corrections. A print removed puts its amount back on the balance. */
export async function deletePrint(id: string) {
  const row = await prisma.ibidPrint.findUnique({ where: { id }, select: { id: true } });
  if (!row) throw new Error("NOT_FOUND");
  await prisma.ibidPrint.delete({ where: { id } });
}

/** A load can only be removed while the balance can still cover what was printed. */
export async function deleteLoad(id: string) {
  await prisma.$transaction(async (tx) => {
    await lock(tx);

    const row = await tx.ibidLoad.findUnique({ where: { id } });
    if (!row) throw new Error("NOT_FOUND");

    const { balance } = await balanceOf(tx);

    if (balance.lessThan(row.amount)) {
      throw new Error("LOAD_ALREADY_SPENT");
    }

    await tx.ibidLoad.delete({ where: { id } });
  });
}

/**
 * The page's figures for a period: the main balance (always the live one),
 * what was loaded and printed in the period, a branch-by-value table, and the
 * entries themselves. A supervisor sees their own branch's prints and the
 * balance they print from, not the Owner's loads.
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

  const branchScope =
    viewer.role === "OWNER" ? query.branchId || undefined : (viewer.branchId ?? "__none__");

  const inPeriod = { gte: from, lt: to };
  const printWhere: Prisma.IbidPrintWhereInput = {
    createdAt: inPeriod,
    ...(branchScope ? { locationId: branchScope } : {}),
  };

  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  const [totals, prints, loads, today] = await Promise.all([
    balanceOf(prisma),
    prisma.ibidPrint.findMany({
      where: printWhere,
      include: {
        location: { select: { id: true, name: true } },
        printedBy: { select: { id: true, name: true } },
      },
      orderBy: { createdAt: "desc" },
    }),
    viewer.role === "OWNER"
      ? prisma.ibidLoad.findMany({
          where: { createdAt: inPeriod },
          include: { createdBy: { select: { id: true, name: true } } },
          orderBy: { createdAt: "desc" },
        })
      : Promise.resolve([]),
    prisma.ibidPrint.aggregate({
      where: {
        createdAt: { gte: startOfToday },
        ...(branchScope ? { locationId: branchScope } : {}),
      },
      _sum: { amount: true },
    }),
  ]);

  // Branch x value, amounts and card counts.
  const byBranch = new Map<
    string,
    {
      branchId: string;
      name: string;
      total: number;
      cards: number;
      values: Record<string, { amount: number; cards: number }>;
    }
  >();

  for (const row of prints) {
    const entry = byBranch.get(row.locationId) ?? {
      branchId: row.locationId,
      name: row.location.name,
      total: 0,
      cards: 0,
      values: {},
    };
    const cell = entry.values[row.denomination] ?? { amount: 0, cards: 0 };

    cell.amount += Number(row.amount);
    cell.cards += row.cards;
    entry.values[row.denomination] = cell;
    entry.total += Number(row.amount);
    entry.cards += row.cards;
    byBranch.set(row.locationId, entry);
  }

  const entries = [
    ...prints.map((row) => ({
      id: row.id,
      kind: "PRINT" as const,
      at: row.createdAt,
      amount: row.amount.toString(),
      denomination: row.denomination,
      cards: row.cards,
      branch: row.location,
      by: row.printedBy,
      note: row.note,
    })),
    ...loads.map((row) => ({
      id: row.id,
      kind: "LOAD" as const,
      at: row.createdAt,
      amount: row.amount.toString(),
      denomination: null,
      cards: null,
      branch: null,
      by: row.createdBy,
      note: row.note,
    })),
  ].sort((a, b) => b.at.getTime() - a.at.getTime());

  return {
    values: IBID_VALUES,
    cardsPerCarta: CARDS_PER_CARTA,
    balance: totals.balance.toString(),
    loadedInPeriod: loads.reduce((sum, row) => sum + Number(row.amount), 0),
    printedInPeriod: prints.reduce((sum, row) => sum + Number(row.amount), 0),
    printedToday: Number(today._sum.amount ?? 0),
    byBranch: [...byBranch.values()].sort((a, b) => a.name.localeCompare(b.name)),
    entries,
    period: { from: from.toISOString(), to: to.toISOString() },
  };
}

import { Prisma } from "database";

import type { Viewer } from "../../middleware/auth.js";
import { prisma } from "../../plugins/prisma.js";
import { addToBranchShare, mainStoreId, takeFromBranchShare } from "../inventory/branchStock.js";

/**
 * EVD (stored as Ibid): digital airtime held as a birr balance, one per
 * branch.
 *
 * The Owner loads birr into a branch's own balance. That branch's supervisor
 * prints cards of one value for a birr amount, and it comes off that
 * branch's balance. The printed cards become stock of the airtime product
 * with the same value (CARD_50 for a 50-birr card): on the branch's shelf
 * when its supervisor prints, or in the Owner's stock held for that branch
 * when the Owner prints for it.
 */

/** The airtime product printed cards of this value become. */
async function evdProduct(db: Tx | typeof prisma, value: number) {
  const candidates = await db.product.findMany({
    where: { status: "ACTIVE", category: "AIRTIME_VOUCHER", voucherDetails: { denomination: value } },
    select: { id: true, name: true, sku: true, type: { select: { name: true } } },
    orderBy: { createdAt: "asc" },
  });
  if (candidates.length === 0) throw new Error("NO_EVD_PRODUCT");
  // Where both a voucher and an EVD card of that value exist, the card.
  const evd = candidates.find((row) => /evd|card|ibid/i.test(`${row.name} ${row.sku} ${row.type?.name ?? ""}`));
  return (evd ?? candidates[0]).id;
}

/** The card values Ethio telecom issues Ibid in. */
export const IBID_VALUES = [10, 15, 25, 50, 100] as const;

/** Ibid is printed by the carta: one carta holds 20 cards. */
export const CARDS_PER_CARTA = 20;

// A lock per branch on everything that moves its balance, so two people
// printing at once cannot both spend the last of it; branches never wait on
// each other.
const BALANCE_LOCK = 734_216_001;

type Tx = Prisma.TransactionClient;

async function balanceOf(db: Tx | typeof prisma, locationId: string) {
  const [loads, prints] = await Promise.all([
    db.ibidLoad.aggregate({ where: { locationId }, _sum: { amount: true } }),
    db.ibidPrint.aggregate({ where: { locationId }, _sum: { amount: true } }),
  ]);

  const loaded = loads._sum.amount ?? new Prisma.Decimal(0);
  const printed = prints._sum.amount ?? new Prisma.Decimal(0);

  return { loaded, printed, balance: loaded.minus(printed) };
}

/** Every active branch with what is left in its EVD balance. */
async function balancesByBranch() {
  const [branches, loads, prints] = await Promise.all([
    prisma.stockLocation.findMany({
      where: { isActive: true },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
    prisma.ibidLoad.groupBy({ by: ["locationId"], _sum: { amount: true } }),
    prisma.ibidPrint.groupBy({ by: ["locationId"], _sum: { amount: true } }),
  ]);

  const loaded = new Map(loads.map((row) => [row.locationId, Number(row._sum.amount ?? 0)]));
  const printed = new Map(prints.map((row) => [row.locationId, Number(row._sum.amount ?? 0)]));

  return branches.map((branch) => ({
    ...branch,
    balance: (loaded.get(branch.id) ?? 0) - (printed.get(branch.id) ?? 0),
  }));
}

async function lock(tx: Tx, locationId: string) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(${BALANCE_LOCK}::int4, hashtext(${locationId}))`;
}

export async function loadBalance(
  viewer: Viewer,
  data: { amount: number; branchId: string; note?: string },
) {
  const branch = await prisma.stockLocation.findFirst({
    where: { id: data.branchId, isActive: true },
    select: { id: true },
  });
  if (!branch) throw new Error("BRANCH_REQUIRED");

  return prisma.ibidLoad.create({
    data: {
      amount: new Prisma.Decimal(data.amount),
      locationId: branch.id,
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
    await lock(tx, locationId);

    const { balance } = await balanceOf(tx, locationId);

    if (balance.lessThan(amount)) {
      throw new Error("NOT_ENOUGH_BALANCE");
    }

    const productId = await evdProduct(tx, data.denomination);
    // Airtime is stocked and sold by the carta (20 cards), so the print adds
    // whole cartas; loose cards short of a carta are not stock.
    const cartas = Math.floor(cards / CARDS_PER_CARTA);
    // A supervisor prints at the branch; the Owner prints into the main
    // store, in that branch's share, ready to send.
    const stockedAtId = viewer.role === "OWNER" ? await mainStoreId(tx) : locationId;

    await tx.inventoryBalance.upsert({
      where: { locationId_productId: { locationId: stockedAtId, productId } },
      create: { locationId: stockedAtId, productId, quantity: cartas },
      update: { quantity: { increment: cartas } },
    });
    if (stockedAtId !== locationId) await addToBranchShare(tx, locationId, productId, cartas);

    await tx.stockMovement.create({
      data: {
        productId,
        toLocationId: stockedAtId,
        quantity: cartas,
        type: "STOCK_IN",
        createdById: viewer.userId,
        notes: `EVD printed: ${cartas} carta × ${data.denomination}`,
      },
    });

    return tx.ibidPrint.create({
      data: {
        locationId,
        denomination: data.denomination,
        amount,
        cards,
        note: data.note?.trim() || null,
        printedById: viewer.userId,
        productId,
        stockedAtId,
      },
    });
  });
}

/**
 * Correcting a print: its value, how many, its note. The supervisor who
 * printed it can on the same day; the Owner any time. The old cards come back
 * out of stock and the corrected ones go in, and the EVD balance follows.
 */
export async function editPrint(
  viewer: Viewer,
  id: string,
  data: { denomination: number; cartas?: number; cards?: number; note?: string },
) {
  const row = await prisma.ibidPrint.findUnique({
    where: { id },
    select: {
      id: true,
      locationId: true,
      cards: true,
      amount: true,
      createdAt: true,
      printedById: true,
      productId: true,
      stockedAtId: true,
    },
  });
  if (!row) throw new Error("NOT_FOUND");
  if (viewer.role !== "OWNER") {
    if (row.printedById !== viewer.userId) throw new Error("NOT_YOURS");
    const now = new Date();
    const sameDay =
      row.createdAt.getFullYear() === now.getFullYear() &&
      row.createdAt.getMonth() === now.getMonth() &&
      row.createdAt.getDate() === now.getDate();
    if (!sameDay) throw new Error("EDIT_LOCKED");
  }
  if (!IBID_VALUES.includes(data.denomination as (typeof IBID_VALUES)[number])) throw new Error("BAD_VALUE");
  const cards = (data.cartas ?? 0) * CARDS_PER_CARTA + (data.cards ?? 0);
  if (cards <= 0) throw new Error("NO_CARDS");
  const amount = new Prisma.Decimal(cards * data.denomination);

  return prisma.$transaction(async (tx) => {
    await lock(tx, row.locationId);
    // The balance this print came out of, with the print itself put back.
    const { balance } = await balanceOf(tx, row.locationId);
    if (balance.plus(row.amount).lessThan(amount)) throw new Error("NOT_ENOUGH_BALANCE");

    // The old cards come back out of stock, if they are still there.
    if (row.productId && row.stockedAtId) {
      const oldCartas = Math.floor(row.cards / CARDS_PER_CARTA);
      const { count } = await tx.inventoryBalance.updateMany({
        where: { locationId: row.stockedAtId, productId: row.productId, quantity: { gte: oldCartas } },
        data: { quantity: { decrement: oldCartas } },
      });
      if (count === 0) throw new Error("PRINT_ALREADY_USED");
      if (row.stockedAtId !== row.locationId) {
        await takeFromBranchShare(tx, row.locationId, row.productId, oldCartas).catch(() => {
          throw new Error("PRINT_ALREADY_USED");
        });
      }
    }

    // The corrected cards go in where the print put them.
    const productId = await evdProduct(tx, data.denomination);
    const stockedAtId = row.stockedAtId ?? row.locationId;
    const cartas = Math.floor(cards / CARDS_PER_CARTA);
    await tx.inventoryBalance.upsert({
      where: { locationId_productId: { locationId: stockedAtId, productId } },
      create: { locationId: stockedAtId, productId, quantity: cartas },
      update: { quantity: { increment: cartas } },
    });
    if (stockedAtId !== row.locationId) await addToBranchShare(tx, row.locationId, productId, cartas);

    await tx.stockMovement.create({
      data: {
        productId,
        toLocationId: stockedAtId,
        quantity: cartas,
        type: "ADJUSTMENT",
        createdById: viewer.userId,
        notes: `EVD print corrected: ${cartas} carta × ${data.denomination}`,
      },
    });

    return tx.ibidPrint.update({
      where: { id },
      data: {
        denomination: data.denomination,
        amount,
        cards,
        note: data.note?.trim() || null,
        productId,
        stockedAtId,
      },
    });
  });
}

/** Owner corrections. A print removed puts its amount back on the balance. */
export async function deletePrint(id: string, userId?: string) {
  const row = await prisma.ibidPrint.findUnique({
    where: { id },
    select: { id: true, cards: true, locationId: true, productId: true, stockedAtId: true },
  });
  if (!row) throw new Error("NOT_FOUND");

  await prisma.$transaction(async (tx) => {
    // The cards it made come back out of stock, if they are still there.
    if (row.productId && row.stockedAtId) {
      const cartas = Math.floor(row.cards / CARDS_PER_CARTA);
      const { count } = await tx.inventoryBalance.updateMany({
        where: { locationId: row.stockedAtId, productId: row.productId, quantity: { gte: cartas } },
        data: { quantity: { decrement: cartas } },
      });
      if (count === 0) throw new Error("PRINT_ALREADY_USED");
      if (row.stockedAtId !== row.locationId) {
        await takeFromBranchShare(tx, row.locationId, row.productId, cartas).catch(() => {
          throw new Error("PRINT_ALREADY_USED");
        });
      }
      if (userId) {
        await tx.stockMovement.create({
          data: {
            productId: row.productId,
            fromLocationId: row.stockedAtId,
            quantity: cartas,
            type: "ADJUSTMENT",
            createdById: userId,
            notes: "EVD print removed",
          },
        });
      }
    }
    await tx.ibidPrint.delete({ where: { id } });
  });
}

/** A load can only be removed while its branch's balance still covers it. */
export async function deleteLoad(id: string) {
  await prisma.$transaction(async (tx) => {
    const row = await tx.ibidLoad.findUnique({ where: { id } });
    if (!row) throw new Error("NOT_FOUND");

    // A load from before branches had their own balance counts towards none.
    if (row.locationId) {
      await lock(tx, row.locationId);

      const { balance } = await balanceOf(tx, row.locationId);

      if (balance.lessThan(row.amount)) {
        throw new Error("LOAD_ALREADY_SPENT");
      }
    }

    await tx.ibidLoad.delete({ where: { id } });
  });
}

/**
 * A load corrected: its amount or note. Lowering it takes money back off the
 * branch's balance, so that is only allowed while the balance still covers
 * the difference, the same rule as removing a load.
 */
export async function updateLoad(id: string, data: { amount?: number; note?: string | null }) {
  return prisma.$transaction(async (tx) => {
    const row = await tx.ibidLoad.findUnique({ where: { id } });
    if (!row) throw new Error("NOT_FOUND");

    const amount = data.amount !== undefined ? new Prisma.Decimal(data.amount) : row.amount;
    const lowering = row.amount.minus(amount);
    if (row.locationId && lowering.greaterThan(0)) {
      await lock(tx, row.locationId);
      const { balance } = await balanceOf(tx, row.locationId);
      if (balance.lessThan(lowering)) throw new Error("LOAD_ALREADY_SPENT_EDIT");
    }

    return tx.ibidLoad.update({
      where: { id },
      data: {
        amount,
        ...(data.note !== undefined ? { note: data.note?.trim() || null } : {}),
      },
    });
  });
}

/**
 * The page's figures for a period: the balance (always the live one) of the
 * chosen branch or, for the Owner with none chosen, of all of them; every
 * branch's own balance for the Owner; what was loaded and printed in the
 * period; a branch-by-value table; and the entries themselves. A supervisor
 * sees their own branch's balance, loads and prints.
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

  const [balances, prints, loads, today] = await Promise.all([
    viewer.role === "OWNER" ? balancesByBranch() : Promise.resolve([]),
    prisma.ibidPrint.findMany({
      where: printWhere,
      include: {
        location: { select: { id: true, name: true } },
        printedBy: { select: { id: true, name: true } },
      },
      orderBy: { createdAt: "desc" },
    }),
    prisma.ibidLoad.findMany({
      where: { createdAt: inPeriod, ...(branchScope ? { locationId: branchScope } : {}) },
      include: {
        createdBy: { select: { id: true, name: true } },
        location: { select: { id: true, name: true } },
      },
      orderBy: { createdAt: "desc" },
    }),
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
      branch: row.location,
      by: row.createdBy,
      note: row.note,
    })),
  ].sort((a, b) => b.at.getTime() - a.at.getTime());

  const balance =
    viewer.role === "OWNER"
      ? branchScope
        ? (balances.find((row) => row.id === branchScope)?.balance ?? 0)
        : balances.reduce((sum, row) => sum + row.balance, 0)
      : Number((await balanceOf(prisma, branchScope ?? "__none__")).balance);

  return {
    values: IBID_VALUES,
    cardsPerCarta: CARDS_PER_CARTA,
    balance: balance.toString(),
    balances,
    loadedInPeriod: loads.reduce((sum, row) => sum + Number(row.amount), 0),
    printedInPeriod: prints.reduce((sum, row) => sum + Number(row.amount), 0),
    printedToday: Number(today._sum.amount ?? 0),
    byBranch: [...byBranch.values()].sort((a, b) => a.name.localeCompare(b.name)),
    entries,
    period: { from: from.toISOString(), to: to.toISOString() },
  };
}

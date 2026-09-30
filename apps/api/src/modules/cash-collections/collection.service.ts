import { Prisma } from "database";

import { prisma } from "../../plugins/prisma.js";
import type { Viewer } from "../../middleware/auth.js";

/**
 * Cash moving from a salesperson to their supervisor.
 *
 * Money enters the branch when a sale is made and leaves it when a deposit is
 * banked. What happens in between — a seller handing over their takings —
 * moves it between people without changing the branch's total, which is why
 * these are recorded separately from sales and receipts rather than as either.
 */

/** What a salesperson still holds: their cash sales, less what they handed in. */
export async function cashInHandOf(userId: string) {
  const [sales, handedOver] = await Promise.all([
    prisma.sale.aggregate({
      where: { salespersonId: userId, status: "APPROVED" },
      _sum: { cashReceived: true },
    }),
    prisma.cashCollection.aggregate({
      where: { salespersonId: userId },
      _sum: { amount: true },
    }),
  ]);

  return (sales._sum.cashReceived ?? new Prisma.Decimal(0)).minus(
    handedOver._sum.amount ?? new Prisma.Decimal(0),
  );
}

export async function collectCash(
  data: { salespersonId: string; amount: number; notes?: string },
  viewer: Viewer,
) {
  if (viewer.role !== "SUPERVISOR") {
    throw new Error("ONLY_SUPERVISOR_COLLECTS");
  }

  const seller = await prisma.user.findUnique({
    where: { id: data.salespersonId },
    select: { id: true, role: true, branchId: true, isActive: true },
  });

  if (!seller || seller.role !== "SALES" || !seller.isActive) {
    throw new Error("NOT_A_SELLER");
  }

  // A supervisor collects from their own branch's sellers, nobody else's.
  if (seller.branchId !== viewer.branchId) {
    throw new Error("NOT_YOUR_BRANCH");
  }

  const inHand = await cashInHandOf(seller.id);
  const amount = new Prisma.Decimal(data.amount);

  // Taking more than they hold would leave a negative balance behind, which
  // means one of the two figures is wrong — better to stop and find out.
  if (amount.greaterThan(inHand)) {
    const error = new Error("MORE_THAN_IN_HAND");
    Object.assign(error, { inHand: inHand.toNumber() });
    throw error;
  }

  return prisma.cashCollection.create({
    data: {
      supervisorId: viewer.userId,
      salespersonId: seller.id,
      amount,
      notes: data.notes ?? null,
    },
    select: collectionDetail,
  });
}

const collectionDetail = {
  id: true,
  amount: true,
  collectedAt: true,
  notes: true,
  supervisor: { select: { id: true, name: true } },
  salesperson: {
    select: {
      id: true,
      name: true,
      branch: { select: { id: true, name: true } },
    },
  },
};

export async function getCollections(
  query: { from?: string; to?: string; branchId?: string },
  viewer: Viewer,
) {
  const scope =
    viewer.role === "SALES"
      ? { salespersonId: viewer.userId }
      : viewer.role === "SUPERVISOR"
        ? { supervisorId: viewer.userId }
        : query.branchId
          ? { salesperson: { branchId: query.branchId } }
          : {};

  const to = query.to ? new Date(query.to) : undefined;
  if (to && !query.to?.includes("T")) to.setHours(23, 59, 59, 999);

  return prisma.cashCollection.findMany({
    where: {
      ...scope,
      ...(query.from || to
        ? {
            collectedAt: {
              ...(query.from ? { gte: new Date(query.from) } : {}),
              ...(to ? { lte: to } : {}),
            },
          }
        : {}),
    },
    select: collectionDetail,
    orderBy: { collectedAt: "desc" },
  });
}

/**
 * Each seller in the branch with what they are still holding, so the
 * supervisor can see who to go to before closing.
 */
export async function getTeamCash(viewer: Viewer) {
  if (viewer.role === "SALES") {
    return [
      {
        id: viewer.userId,
        name: "",
        inHand: (await cashInHandOf(viewer.userId)).toNumber(),
      },
    ];
  }

  const sellers = await prisma.user.findMany({
    where: {
      role: "SALES",
      isActive: true,
      ...(viewer.role === "SUPERVISOR"
        ? { branchId: viewer.branchId ?? "__none__" }
        : {}),
    },
    select: { id: true, name: true, branch: { select: { name: true } } },
    orderBy: { name: "asc" },
  });

  const rows = await Promise.all(
    sellers.map(async (seller) => ({
      id: seller.id,
      name: seller.name,
      branch: seller.branch?.name ?? null,
      inHand: (await cashInHandOf(seller.id)).toNumber(),
    })),
  );

  return rows.sort((a, b) => b.inHand - a.inHand);
}

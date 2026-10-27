import type { Prisma } from "database";

import { prisma } from "../../plugins/prisma.js";
import { shelfStock } from "../requests/request.service.js";

type Db = Prisma.TransactionClient | typeof prisma;

/**
 * The Owner's stock at a main store is split by the branch it is for. These
 * keep that split in step with the main store's balance: anything leaving a
 * main store for a branch comes out of that branch's share, anything coming
 * back from a branch goes into it.
 */

export async function isMainStore(db: Db, locationId: string) {
  const location = await db.stockLocation.findUnique({
    where: { id: locationId },
    select: { isMainStock: true },
  });
  return location?.isMainStock === true;
}

/** The first active main store: where the Owner's stock is kept. */
export async function mainStoreId(db: Db) {
  const store = await db.stockLocation.findFirst({
    where: { isMainStock: true, isActive: true },
    orderBy: { createdAt: "asc" },
    select: { id: true },
  });
  if (!store) throw new Error("NO_MAIN_STORE");
  return store.id;
}

export async function addToBranchShare(db: Db, branchId: string, productId: string, quantity: number) {
  await db.branchStock.upsert({
    where: { branchId_productId: { branchId, productId } },
    create: { branchId, productId, quantity },
    update: { quantity: { increment: quantity } },
  });
}

/** Takes from the branch's share, or refuses if it does not hold that much. */
export async function takeFromBranchShare(db: Db, branchId: string, productId: string, quantity: number) {
  const { count } = await db.branchStock.updateMany({
    where: { branchId, productId, quantity: { gte: quantity } },
    data: { quantity: { decrement: quantity } },
  });
  if (count === 0) throw new Error("NOT_ENOUGH_FOR_BRANCH");
}

/** Each product's share held for one branch. */
export async function branchShare(branchId: string, productIds: string[]) {
  const rows = await prisma.branchStock.findMany({
    where: { branchId, productId: { in: productIds } },
    select: { productId: true, quantity: true },
  });
  return new Map(rows.map((row) => [row.productId, row.quantity]));
}

/**
 * What can be sent from a location to a branch: the shelf, and from a main
 * store no more than the branch's own share.
 */
export async function sendableStock(sourceId: string, destinationId: string, productIds: string[]) {
  const shelf = await shelfStock(sourceId, productIds);
  if (!(await isMainStore(prisma, sourceId))) return shelf;
  const share = await branchShare(destinationId, productIds);
  return new Map(productIds.map((id) => [id, Math.min(shelf.get(id) ?? 0, share.get(id) ?? 0)]));
}

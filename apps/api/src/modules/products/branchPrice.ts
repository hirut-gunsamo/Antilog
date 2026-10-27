import type { Prisma } from "database";

import { prisma } from "../../plugins/prisma.js";

/**
 * Selling prices by branch. The Owner may set a product's price for one
 * branch; a branch without one sells at the product's own price. Everything
 * that charges or shows a price to a branch reads it through here.
 */

/** The branch prices set for these products at this branch, by product id. */
export async function branchPrices(locationId: string | null | undefined, productIds: string[]) {
  if (!locationId || productIds.length === 0) return new Map<string, Prisma.Decimal>();
  const rows = await prisma.productBranchPrice.findMany({
    where: { locationId, productId: { in: productIds } },
    select: { productId: true, price: true },
  });
  return new Map(rows.map((row) => [row.productId, row.price]));
}

/**
 * Sets each product's `price` to what it sells for at the given branch.
 * Products the Owner has not priced for that branch keep their own price.
 */
export async function withBranchPrice<T extends { id: string; price: Prisma.Decimal }>(
  locationId: string | null | undefined,
  products: T[],
): Promise<T[]> {
  const prices = await branchPrices(locationId, products.map((product) => product.id));
  return products.map((product) => {
    const own = prices.get(product.id);
    return own ? { ...product, price: own } : product;
  });
}

/**
 * The same, for rows that each sit at their own branch (stock balances):
 * every row gets the price of the branch it is at.
 */
export async function withRowBranchPrice<
  T extends { locationId: string; product: { id: string; price: Prisma.Decimal } },
>(rows: T[]): Promise<T[]> {
  if (rows.length === 0) return rows;
  const set = await prisma.productBranchPrice.findMany({
    where: {
      productId: { in: [...new Set(rows.map((row) => row.product.id))] },
      locationId: { in: [...new Set(rows.map((row) => row.locationId))] },
    },
    select: { productId: true, locationId: true, price: true },
  });
  const byKey = new Map(set.map((row) => [`${row.productId}:${row.locationId}`, row.price]));
  return rows.map((row) => {
    const own = byKey.get(`${row.product.id}:${row.locationId}`);
    return own ? { ...row, product: { ...row.product, price: own } } : row;
  });
}

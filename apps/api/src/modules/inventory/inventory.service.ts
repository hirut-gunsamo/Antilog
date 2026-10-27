import { Prisma } from "database";
import { prisma } from "../../plugins/prisma.js";
import { withRowBranchPrice } from "../products/branchPrice.js";
import type { Viewer } from "../../middleware/auth.js";
import type {
  AdjustBalanceInput,
  RemoveBalanceInput,
  StockInInput,
  UpdateProductInput,
} from "./inventory.schema.js";
import { addToBranchShare, mainStoreId } from "./branchStock.js";

// Branch identity as it appears alongside stock. Staff details are deliberately
// absent: a branch's stock says nothing about who works there.
const branchSummary = {
  select: {
    id: true,
    name: true,
    isMainStock: true,
    isActive: true,
  },
};

const productDetail = {
  include: {
    simDetails: true,
    voucherDetails: true,
    phoneDetails: true,
  },
};

// Restricts any inventory query to the branches the caller may read.
// The Owner sees every branch; everyone else sees only their own.
function branchScope(viewer: Viewer): string[] | null {
  if (viewer.role === "OWNER") {
    return null;
  }

  return viewer.branchId ? [viewer.branchId] : [];
}

function locationFilter(viewer: Viewer, locationId?: string) {
  const allowed = branchScope(viewer);

  if (allowed === null) {
    return locationId ? { locationId } : {};
  }

  // A non-owner asking for another branch gets their own scope, never a
  // wider one.
  const ids = locationId
    ? allowed.filter((id) => id === locationId)
    : allowed;

  return { locationId: { in: ids } };
}

export async function stockIn(
  data: StockInInput,
  performedById: string,
) {
  const product = await prisma.product.findUnique({
    where: {
      id: data.productId,
    },
  });

  if (!product) {
    throw new Error("PRODUCT_NOT_FOUND");
  }

  if (product.status !== "ACTIVE") {
    throw new Error("PRODUCT_INACTIVE");
  }

  // Stock bought for a branch arrives at the main store, in that branch's share.
  const locationId = data.locationId ?? (data.forBranchId ? await mainStoreId(prisma) : undefined);
  if (!locationId) throw new Error("BRANCH_REQUIRED");

  const location = await prisma.stockLocation.findUnique({
    where: {
      id: locationId,
    },
  });

  if (!location) {
    throw new Error("LOCATION_NOT_FOUND");
  }

  // Stock must not be added to a branch that has been closed.
  if (!location.isActive) {
    throw new Error("LOCATION_INACTIVE");
  }

  // At a main store everything belongs to some branch's share.
  if (location.isMainStock) {
    if (!data.forBranchId) throw new Error("BRANCH_REQUIRED");
    const branch = await prisma.stockLocation.findUnique({
      where: { id: data.forBranchId },
      select: { isActive: true, isMainStock: true },
    });
    if (!branch || branch.isMainStock) throw new Error("BRANCH_REQUIRED");
    if (!branch.isActive) throw new Error("LOCATION_INACTIVE");
  }

  return prisma.$transaction(async (tx) => {
    if (location.isMainStock && data.forBranchId) {
      await addToBranchShare(tx, data.forBranchId, data.productId, data.quantity);
    }

    // One balance row per product per branch.
    const balance = await tx.inventoryBalance.upsert({
      where: {
        locationId_productId: {
          locationId,
          productId: data.productId,
        },
      },
      create: {
        productId: data.productId,
        locationId,
        quantity: data.quantity,
      },
      update: {
        quantity: {
          increment: data.quantity,
        },
      },
    });

    await tx.stockMovement.create({
      data: {
        productId: data.productId,
        toLocationId: locationId,
        quantity: data.quantity,
        type: "STOCK_IN",
        createdById: performedById,
        notes: data.note ?? null,
      },
    });

    return balance;
  });
}

/**
 * Goods a supervisor has issued to a salesperson stay in the branch's balance
 * until they are sold, but they are no longer on the shelf to give out or send
 * away. Adds to each balance row how many are with salespeople and how many
 * are left on the shelf.
 */
async function withShelf<T extends { locationId: string; productId: string; quantity: number }>(
  balances: T[],
) {
  const holdings = await prisma.salespersonHolding.findMany({
    where: {
      quantity: { gt: 0 },
      productId: { in: [...new Set(balances.map((b) => b.productId))] },
      user: { branchId: { in: [...new Set(balances.map((b) => b.locationId))] } },
    },
    select: { productId: true, quantity: true, user: { select: { branchId: true } } },
  });

  const held = new Map<string, number>();
  for (const row of holdings) {
    const key = `${row.user.branchId}:${row.productId}`;
    held.set(key, (held.get(key) ?? 0) + row.quantity);
  }

  return balances.map((balance) => {
    const withSellers = Math.min(
      held.get(`${balance.locationId}:${balance.productId}`) ?? 0,
      balance.quantity,
    );
    return { ...balance, withSellers, onShelf: balance.quantity - withSellers };
  });
}

export async function getInventory(
  viewer: Viewer,
  locationId?: string,
) {
  const balances = await prisma.inventoryBalance.findMany({
    where: locationFilter(viewer, locationId),

    include: {
      product: productDetail,
      location: branchSummary,
    },

    orderBy: {
      updatedAt: "desc",
    },
  });

  return withShelf(balances);
}

export async function getInventoryUnits(
  viewer: Viewer,
  productId?: string,
  locationId?: string,
  status?: Prisma.InventoryUnitWhereInput["status"],
) {
  return prisma.inventoryUnit.findMany({
    where: {
      ...locationFilter(viewer, locationId),
      ...(productId ? { productId } : {}),
      ...(status ? { status } : {}),
    },

    include: {
      product: {
        select: {
          id: true,
          sku: true,
          name: true,
          category: true,
        },
      },

      location: branchSummary,
    },

    orderBy: {
      createdAt: "desc",
    },
  });
}

// Stock remaining per product for one branch, which is what both the Sales
// "available stock" view and the branch dashboard need.
export async function getStockSummary(
  viewer: Viewer,
  locationId?: string,
  mine = false,
) {
  const balances = await prisma.inventoryBalance.findMany({
    where: locationFilter(viewer, locationId),

    include: {
      product: {
        select: {
          id: true,
          sku: true,
          name: true,
          category: true,
          price: true,
          status: true,
          categoryId: true,
          // An airtime item's value, for its short name ("Voucher-10").
          voucherDetails: { select: { denomination: true } },
          // The Owner's type, and its parent (a phone's brand), so the sale
          // form can go category, then type, then product.
          type: {
            select: {
              id: true,
              name: true,
              parentId: true,
              parent: { select: { id: true, name: true } },
            },
          },
        },
      },
      location: branchSummary,
    },

    orderBy: [{ location: { name: "asc" } }, { quantity: "desc" }],
  });

  // Each row shows what the product sells for at that row's branch.
  let items = await withShelf(await withRowBranchPrice(balances));

  // A salesperson asking for their own stock gets only what was issued to
  // them: what they received, sold and handed back, and what they still hold.
  if (mine && viewer.role === "SALES") {
    const [holdings, requested, sold] = await Promise.all([
      prisma.salespersonHolding.findMany({
        where: { userId: viewer.userId },
        select: { productId: true, quantity: true },
      }),
      prisma.stockRequestItem.findMany({
        where: {
          approvedQuantity: { gt: 0 },
          request: {
            requestedById: viewer.userId,
            kind: { in: ["ISSUE", "RETURN"] },
            status: { in: ["PENDING", "APPROVED", "FULFILLED"] },
          },
        },
        select: { productId: true, approvedQuantity: true, request: { select: { kind: true } } },
      }),
      prisma.saleItem.groupBy({
        by: ["productId"],
        where: { sale: { salespersonId: viewer.userId, status: "APPROVED" } },
        _sum: { quantity: true },
      }),
    ]);

    const held = new Map(holdings.map((row) => [row.productId, row.quantity]));
    const received = new Map<string, number>();
    const returned = new Map<string, number>();
    for (const line of requested) {
      const into = line.request.kind === "ISSUE" ? received : returned;
      into.set(line.productId, (into.get(line.productId) ?? 0) + (line.approvedQuantity ?? 0));
    }
    const soldBy = new Map(sold.map((row) => [row.productId, row._sum.quantity ?? 0]));

    items = items
      .filter((item) => (held.get(item.productId) ?? 0) > 0 || received.has(item.productId))
      .map((item) => {
        const quantity = held.get(item.productId) ?? 0;
        return {
          ...item,
          quantity,
          onShelf: quantity,
          withSellers: 0,
          mine: {
            received: received.get(item.productId) ?? 0,
            sold: soldBy.get(item.productId) ?? 0,
            returned: returned.get(item.productId) ?? 0,
          },
        };
      });
  }

  const totals = items.reduce(
    (acc, item) => {
      acc[item.product.category] = (acc[item.product.category] ?? 0) + item.onShelf;
      return acc;
    },
    {} as Record<string, number>,
  );

  return {
    byCategory: {
      SIM_CARD: totals.SIM_CARD ?? 0,
      AIRTIME_VOUCHER: totals.AIRTIME_VOUCHER ?? 0,
      PHONE: totals.PHONE ?? 0,
    },
    // On the shelf; what salespeople hold is counted separately.
    totalUnits: items.reduce((sum, item) => sum + item.onShelf, 0),
    withSellers: items.reduce((sum, item) => sum + item.withSellers, 0),
    items,
  };
}

// Movement history is scoped by either end of the movement: a branch sees
// stock that arrived at it or left it.
export async function getStockMovements(
  viewer: Viewer,
  locationId?: string,
) {
  const allowed = branchScope(viewer);

  const scope =
    allowed === null
      ? locationId
        ? {
            OR: [
              { fromLocationId: locationId },
              { toLocationId: locationId },
            ],
          }
        : {}
      : {
          OR: [
            { fromLocationId: { in: allowed } },
            { toLocationId: { in: allowed } },
          ],
        };

  return prisma.stockMovement.findMany({
    where: scope,

    include: {
      product: {
        select: {
          id: true,
          sku: true,
          name: true,
          category: true,
        },
      },

      fromLocation: branchSummary,
      toLocation: branchSummary,

      createdBy: {
        select: {
          id: true,
          name: true,
          role: true,
        },
      },
    },

    orderBy: {
      createdAt: "desc",
    },
  });
}

// A mis-keyed intake is corrected here rather than by editing history: the
// balance is set to the true figure and the difference is recorded as an
// ADJUSTMENT movement, so the trail still explains itself afterwards.
export async function adjustBalance(
  balanceId: string,
  data: AdjustBalanceInput,
  performedById: string,
) {
  const balance = await prisma.inventoryBalance.findUnique({
    where: { id: balanceId },
    include: { product: true, location: true },
  });

  if (!balance) {
    throw new Error("BALANCE_NOT_FOUND");
  }

  // The main store's figure is the sum of the branches' shares; it is
  // corrected one share at a time instead.
  if (balance.location.isMainStock) {
    throw new Error("EDIT_BRANCH_SHARE");
  }

  if (!balance.location.isActive) {
    throw new Error("LOCATION_INACTIVE");
  }

  const difference = data.quantity - balance.quantity;

  if (difference === 0) {
    return balance;
  }

  // Nothing to reconcile against: stock is a count for every category, and
  // unit rows only exist for items already sold.

  return prisma.$transaction(async (tx) => {
    const updated = await tx.inventoryBalance.update({
      where: { id: balanceId },
      data: { quantity: data.quantity },
    });

    await tx.stockMovement.create({
      data: {
        productId: balance.productId,
        // An increase arrives at the branch; a decrease leaves it.
        ...(difference > 0
          ? { toLocationId: balance.locationId }
          : { fromLocationId: balance.locationId }),
        quantity: Math.abs(difference),
        type: "ADJUSTMENT",
        createdById: performedById,
        notes: `Corrected ${balance.quantity} → ${data.quantity}. ${data.reason}`,
      },
    });

    return updated;
  });
}

// Removing a stock row is only safe once it is empty: while it still holds
// units, deleting it would erase stock that physically exists.
export async function removeBalance(
  balanceId: string,
  data: RemoveBalanceInput,
  performedById: string,
) {
  const balance = await prisma.inventoryBalance.findUnique({
    where: { id: balanceId },
    include: { product: true },
  });

  if (!balance) {
    throw new Error("BALANCE_NOT_FOUND");
  }

  if (balance.quantity !== 0) {
    throw new Error("BALANCE_NOT_EMPTY");
  }

  const held = await prisma.inventoryUnit.count({
    where: {
      productId: balance.productId,
      locationId: balance.locationId,
      status: { in: ["IN_STOCK", "RESERVED"] },
    },
  });

  if (held > 0) {
    throw new Error("UNITS_STILL_HELD");
  }

  return prisma.$transaction(async (tx) => {
    await tx.stockMovement.create({
      data: {
        productId: balance.productId,
        fromLocationId: balance.locationId,
        quantity: 0,
        type: "ADJUSTMENT",
        createdById: performedById,
        notes: `Stock row removed. ${data.reason}`,
      },
    });

    await tx.inventoryBalance.delete({ where: { id: balanceId } });

    return { id: balanceId };
  });
}

// Correcting the product itself - a typo in the name, the wrong price. SKU
// and category are deliberately not editable: stock, sales and movements all
// already point at them.
export async function updateProduct(
  productId: string,
  data: UpdateProductInput,
) {
  const product = await prisma.product.findUnique({
    where: { id: productId },
  });

  if (!product) {
    throw new Error("PRODUCT_NOT_FOUND");
  }

  return prisma.product.update({
    where: { id: productId },
    data: {
      ...(data.name !== undefined ? { name: data.name } : {}),
      ...(data.price !== undefined ? { price: data.price } : {}),
      ...(data.description !== undefined
        ? { description: data.description }
        : {}),
    },
  });
}

/**
 * What each seller is holding right now, with the day's movement behind it:
 * issued this morning, sold since, and still in hand.
 *
 * This is the branch's card sheet — "given, sold, remaining" — kept by the
 * system rather than by hand, so the evening count has something to be
 * checked against.
 */
export async function getHoldings(
  viewer: Viewer,
  branchId?: string,
) {
  // A salesperson sees only their own; a supervisor their branch; the Owner
  // any branch, or all of them.
  const who: Prisma.UserWhereInput =
    viewer.role === "SALES"
      ? { id: viewer.userId }
      : viewer.role === "SUPERVISOR"
        ? { branchId: viewer.branchId ?? "__none__", role: "SALES" }
        : { role: "SALES", ...(branchId ? { branchId } : {}) };

  const since = new Date();
  since.setHours(0, 0, 0, 0);

  const sellers = await prisma.user.findMany({
    where: { ...who, isActive: true },
    select: {
      id: true,
      name: true,
      branch: { select: { id: true, name: true } },
      holdings: {
        where: { quantity: { gt: 0 } },
        select: {
          quantity: true,
          updatedAt: true,
          product: {
            select: { id: true, sku: true, name: true, category: true },
          },
        },
      },
    },
    orderBy: { name: "asc" },
  });

  const sellerIds = sellers.map((seller) => seller.id);

  // Issued today: the approved lines of today's ISSUE requests. Approved
  // quantity, not requested — a supervisor may have handed over fewer.
  const [issuedToday, soldToday] = await Promise.all([
    prisma.stockRequestItem.findMany({
      where: {
        request: {
          kind: "ISSUE",
          status: "APPROVED",
          requestedById: { in: sellerIds },
          reviewedAt: { gte: since },
        },
      },
      select: {
        approvedQuantity: true,
        productId: true,
        request: { select: { requestedById: true } },
      },
    }),
    prisma.saleItem.findMany({
      where: {
        sale: {
          status: "APPROVED",
          salespersonId: { in: sellerIds },
          saleDate: { gte: since },
        },
      },
      select: {
        quantity: true,
        productId: true,
        sale: { select: { salespersonId: true } },
      },
    }),
  ]);

  const tally = (
    rows: { key: string; productId: string; quantity: number }[],
  ) => {
    const map = new Map<string, number>();

    for (const row of rows) {
      const key = `${row.key}:${row.productId}`;
      map.set(key, (map.get(key) ?? 0) + row.quantity);
    }

    return map;
  };

  const issued = tally(
    issuedToday.map((row) => ({
      key: row.request.requestedById,
      productId: row.productId,
      quantity: row.approvedQuantity ?? 0,
    })),
  );

  const sold = tally(
    soldToday.map((row) => ({
      key: row.sale.salespersonId,
      productId: row.productId,
      quantity: row.quantity,
    })),
  );

  return sellers.map((seller) => {
    // A product sold out completely has no holding row left, so the day's
    // lines come from everything that moved, not just what is still held.
    const productIds = new Set(
      seller.holdings.map((holding) => holding.product.id),
    );

    for (const key of [...issued.keys(), ...sold.keys()]) {
      const [userId, productId] = key.split(":");
      if (userId === seller.id) productIds.add(productId);
    }

    const byProduct = new Map(
      seller.holdings.map((holding) => [holding.product.id, holding]),
    );

    return {
      id: seller.id,
      name: seller.name,
      branch: seller.branch,
      items: [...productIds]
        .map((productId) => {
          const holding = byProduct.get(productId);

          return {
            product: holding?.product ?? null,
            productId,
            issuedToday: issued.get(`${seller.id}:${productId}`) ?? 0,
            soldToday: sold.get(`${seller.id}:${productId}`) ?? 0,
            remaining: holding?.quantity ?? 0,
          };
        })
        .sort((a, b) => b.remaining - a.remaining),
      totals: {
        issuedToday: [...issued.entries()]
          .filter(([key]) => key.startsWith(`${seller.id}:`))
          .reduce((sum, [, value]) => sum + value, 0),
        soldToday: [...sold.entries()]
          .filter(([key]) => key.startsWith(`${seller.id}:`))
          .reduce((sum, [, value]) => sum + value, 0),
        remaining: seller.holdings.reduce(
          (sum, holding) => sum + holding.quantity,
          0,
        ),
      },
    };
  });
}

/** The Owner's stock, branch by branch: what is held at the main store for each. */
export async function listBranchStock(query: { branchId?: string }) {
  const rows = await prisma.branchStock.findMany({
    where: { ...(query.branchId ? { branchId: query.branchId } : {}), quantity: { gt: 0 } },
    select: {
      id: true,
      quantity: true,
      updatedAt: true,
      branch: { select: { id: true, name: true } },
      product: {
        select: {
          id: true,
          name: true,
          sku: true,
          category: true,
          price: true,
          costPrice: true,
          productCategory: { select: { id: true, name: true } },
        },
      },
    },
    orderBy: [{ branch: { name: "asc" } }, { product: { name: "asc" } }],
  });
  return rows;
}

/**
 * Sets one branch's share to its true figure. The main store's balance moves
 * by the same difference, recorded as an ADJUSTMENT, so the two stay equal.
 */
export async function setBranchStock(
  data: { branchId: string; productId: string; quantity: number },
  performedById: string,
) {
  const branch = await prisma.stockLocation.findUnique({
    where: { id: data.branchId },
    select: { id: true, name: true, isMainStock: true },
  });
  if (!branch || branch.isMainStock) throw new Error("BRANCH_REQUIRED");
  const product = await prisma.product.findUnique({ where: { id: data.productId }, select: { id: true } });
  if (!product) throw new Error("PRODUCT_NOT_FOUND");
  const storeId = await mainStoreId(prisma);

  return prisma.$transaction(async (tx) => {
    const current = await tx.branchStock.findUnique({
      where: { branchId_productId: { branchId: data.branchId, productId: data.productId } },
      select: { quantity: true },
    });
    const delta = data.quantity - (current?.quantity ?? 0);
    if (delta === 0) return { quantity: data.quantity };

    await tx.branchStock.upsert({
      where: { branchId_productId: { branchId: data.branchId, productId: data.productId } },
      create: { branchId: data.branchId, productId: data.productId, quantity: data.quantity },
      update: { quantity: data.quantity },
    });

    if (delta > 0) {
      await tx.inventoryBalance.upsert({
        where: { locationId_productId: { locationId: storeId, productId: data.productId } },
        create: { locationId: storeId, productId: data.productId, quantity: delta },
        update: { quantity: { increment: delta } },
      });
    } else {
      const { count } = await tx.inventoryBalance.updateMany({
        where: { locationId: storeId, productId: data.productId, quantity: { gte: -delta } },
        data: { quantity: { decrement: -delta } },
      });
      if (count === 0) throw new Error("NOT_ENOUGH_FOR_BRANCH");
    }

    await tx.stockMovement.create({
      data: {
        productId: data.productId,
        ...(delta > 0 ? { toLocationId: storeId } : { fromLocationId: storeId }),
        quantity: Math.abs(delta),
        type: "ADJUSTMENT",
        createdById: performedById,
        notes: `Share for ${branch.name} set to ${data.quantity}`,
      },
    });

    return { quantity: data.quantity };
  });
}

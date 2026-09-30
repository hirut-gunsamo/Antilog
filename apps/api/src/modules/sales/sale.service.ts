import { Prisma } from "database";
import { prisma } from "../../plugins/prisma.js";
import type { Viewer } from "../../middleware/auth.js";
import type {
  CreateSaleInput,
  ListSalesQuery,
} from "./sale.schema.js";

const saleDetail = {
  id: true,
  status: true,
  subtotal: true,
  totalAmount: true,
  cashReceived: true,
  paymentMethod: true,
  bankName: true,
  transferReceived: true,
  notes: true,
  saleDate: true,
  submittedAt: true,
  approvedAt: true,
  createdAt: true,

  salesperson: {
    select: { id: true, name: true, role: true },
  },
  approvedBy: {
    select: { id: true, name: true, role: true },
  },
  location: {
    select: { id: true, name: true },
  },

  items: {
    select: {
      id: true,
      quantity: true,
      unitPrice: true,
      lineTotal: true,

      product: {
        select: {
          id: true,
          sku: true,
          name: true,
          category: true,
        },
      },

      inventoryUnits: {
        select: {
          id: true,
          serialNumber: true,
          simNumber: true,
          iccid: true,
          imei: true,
          status: true,
        },
      },
    },
  },
};

const SERIALIZED = ["SIM_CARD", "PHONE"];

/**
 * A salesperson records a sale against the goods they took out this morning.
 *
 * There is no approval step. A branch serves hundreds of customers a day and
 * asking a supervisor to sign each one was the bottleneck this replaces: the
 * supervisor's control is the morning issue and the evening return, and the
 * count has to match at the end of the day either way. So the sale counts as
 * revenue at once, and the goods leave both the branch's shelf and the
 * seller's own holding.
 */
export async function createSale(
  data: CreateSaleInput,
  viewer: Viewer,
) {
  if (!viewer.branchId) {
    throw new Error("NO_BRANCH");
  }

  const productIds = data.items.map((item) => item.productId);

  const products = await prisma.product.findMany({
    where: { id: { in: productIds }, status: "ACTIVE" },
    select: { id: true, price: true, category: true, sku: true },
  });

  if (products.length !== new Set(productIds).size) {
    throw new Error("INVALID_PRODUCT");
  }

  const catalogue = new Map(products.map((p) => [p.id, p]));

  // Serials are checked before anything is written: a sale that is going to be
  // refused must not move stock first. They are checked before the holding and
  // stock checks too, because a request carrying the wrong serials is
  // malformed — the seller can fix it at the till without a supervisor.
  //
  // Keyed by the line's position in the request, not by productId: the same
  // product may legitimately appear on two lines of one sale, and a productId
  // key would let the second line's serials overwrite the first's.
  const serialsByLine = new Map<number, string[]>();

  for (const [index, item] of data.items.entries()) {
    // Non-null: every productId was found above, or INVALID_PRODUCT threw.
    const product = catalogue.get(item.productId)!;
    const serials = item.serials ?? [];

    if (!SERIALIZED.includes(product.category)) {
      if (serials.length > 0) {
        throw new Error("SERIALS_NOT_EXPECTED");
      }

      continue;
    }

    if (serials.length !== item.quantity) {
      throw new Error("SERIAL_COUNT_MISMATCH");
    }

    serialsByLine.set(index, serials);
  }

  // Repeats are looked for across the whole request, not just inside one line:
  // two lines of the same sale must not name the same handset either.
  const allSerials = [...serialsByLine.values()].flat();

  if (new Set(allSerials).size !== allSerials.length) {
    throw new Error("SERIAL_REPEATED");
  }

  // The unique index on iccid and imei is the real guard — it is what stops
  // the same handset being sold twice at two branches at the same moment. This
  // read is so that the sale is refused with a sentence the seller can act on,
  // before any stock moves.
  for (const [index, serials] of serialsByLine) {
    const product = catalogue.get(data.items[index]!.productId)!;

    const taken = await prisma.inventoryUnit.findFirst({
      where:
        product.category === "PHONE"
          ? { imei: { in: serials } }
          : { iccid: { in: serials } },
      select: { id: true },
    });

    if (taken) {
      throw new Error("SERIAL_ALREADY_SOLD");
    }
  }

  // Both checks matter and they say different things, but the seller's own
  // holding comes first: it is the one they can do something about, and the
  // branch's shelf is not the reason they cannot sell.
  await assertHoldingCovers(viewer.userId, data.items);
  await assertBranchHasStock(viewer.branchId, data.items);

  let subtotal = new Prisma.Decimal(0);

  const items = data.items.map((item) => {
    const product = catalogue.get(item.productId)!;
    const unitPrice = product.price;
    const lineTotal = unitPrice.mul(item.quantity);

    subtotal = subtotal.add(lineTotal);

    return {
      productId: item.productId,
      quantity: item.quantity,
      unitPrice,
      lineTotal,
    };
  });

  const branchId = viewer.branchId;

  return prisma.$transaction(async (tx) => {
    const sale = await tx.sale.create({
      data: {
        salespersonId: viewer.userId,
        locationId: branchId,
        status: "APPROVED",
        // Nobody approved it, so approvedById stays empty; the time is kept
        // because the reports read it.
        approvedAt: new Date(),
        subtotal,
        totalAmount: subtotal,
        // Only cash counts as money the seller holds; a transfer is already
        // in the bank.
        ...(data.paymentMethod === "TRANSFER"
          ? {
              paymentMethod: "TRANSFER" as const,
              bankName: data.bankName ?? null,
              cashReceived: new Prisma.Decimal(0),
              transferReceived: new Prisma.Decimal(data.cashReceived),
            }
          : { cashReceived: new Prisma.Decimal(data.cashReceived) }),
        notes: data.customerNote ?? null,
      },
      select: { id: true },
    });

    // The lines are written one at a time rather than nested under the sale, so
    // that each created SaleItem is known to belong to the request line at the
    // same index. A nested create returns its rows in no guaranteed order, and
    // the serials have to land on the right line.
    for (const [index, line] of items.entries()) {
      const item = await tx.saleItem.create({
        data: { saleId: sale.id, ...line },
        select: { id: true, productId: true, quantity: true },
      });

      await tx.inventoryBalance.update({
        where: {
          locationId_productId: {
            locationId: branchId,
            productId: item.productId,
          },
        },
        data: { quantity: { decrement: item.quantity } },
      });

      // The seller is answerable for fewer goods from now on. The database
      // refuses a negative holding, so a race between two tills cannot sell
      // the same packet twice.
      await tx.salespersonHolding.update({
        where: {
          userId_productId: {
            userId: viewer.userId,
            productId: item.productId,
          },
        },
        data: { quantity: { decrement: item.quantity } },
      });

      const serials = serialsByLine.get(index);

      if (serials) {
        const category = catalogue.get(item.productId)!.category;
        const field = category === "PHONE" ? "imei" : "iccid";

        // Each serial becomes the record of one unit leaving the business.
        // Stock now arrives as a plain count, so this is the first and only
        // moment the business learns which handset or SIM this was.
        for (const serial of serials) {
          await tx.inventoryUnit.create({
            data: {
              productId: item.productId,
              locationId: branchId,
              status: "SOLD",
              saleItemId: item.id,
              [field]: serial,
            },
          });
        }
      }

      await tx.stockMovement.create({
        data: {
          productId: item.productId,
          fromLocationId: branchId,
          quantity: item.quantity,
          type: "SALE",
          referenceType: "Sale",
          referenceId: sale.id,
          createdById: viewer.userId,
        },
      });
    }

    return tx.sale.findUnique({ where: { id: sale.id }, select: saleDetail });
  });
}

/** What this seller still has of each product they were issued. */
async function assertHoldingCovers(
  userId: string,
  items: { productId: string; quantity: number }[],
) {
  const wanted = new Map<string, number>();

  for (const item of items) {
    wanted.set(
      item.productId,
      (wanted.get(item.productId) ?? 0) + item.quantity,
    );
  }

  const holdings = await prisma.salespersonHolding.findMany({
    where: { userId, productId: { in: [...wanted.keys()] } },
    select: { productId: true, quantity: true },
  });

  const held = new Map(holdings.map((row) => [row.productId, row.quantity]));

  const shortages = [...wanted.entries()]
    .filter(([productId, quantity]) => (held.get(productId) ?? 0) < quantity)
    .map(([productId, quantity]) => ({
      productId,
      requested: quantity,
      available: held.get(productId) ?? 0,
    }));

  if (shortages.length > 0) {
    const error = new Error("NOT_IN_YOUR_HOLDING");
    Object.assign(error, { shortages });
    throw error;
  }
}

async function assertBranchHasStock(
  branchId: string,
  items: { productId: string; quantity: number }[],
) {
  const wanted = new Map<string, number>();

  for (const item of items) {
    wanted.set(
      item.productId,
      (wanted.get(item.productId) ?? 0) + item.quantity,
    );
  }

  const balances = await prisma.inventoryBalance.findMany({
    where: {
      locationId: branchId,
      productId: { in: [...wanted.keys()] },
    },
    select: { productId: true, quantity: true },
  });

  const available = new Map(
    balances.map((b) => [b.productId, b.quantity]),
  );

  const shortages = [...wanted.entries()]
    .filter(([productId, qty]) => (available.get(productId) ?? 0) < qty)
    .map(([productId, qty]) => ({
      productId,
      requested: qty,
      available: available.get(productId) ?? 0,
    }));

  if (shortages.length > 0) {
    const error = new Error("INSUFFICIENT_STOCK");
    Object.assign(error, { shortages });
    throw error;
  }
}

// A salesperson sees only their own sales, a supervisor their whole branch,
// the Owner everything.
export async function getSales(
  query: ListSalesQuery,
  viewer: Viewer,
) {
  let scope: Prisma.SaleWhereInput = {};

  if (viewer.role === "SALES") {
    scope = { salespersonId: viewer.userId };
  } else if (viewer.role === "SUPERVISOR") {
    scope = { locationId: viewer.branchId ?? "__none__" };
  } else if (query.branchId) {
    scope = { locationId: query.branchId };
  }

  const dateFilter =
    query.from || query.to
      ? {
          saleDate: {
            ...(query.from ? { gte: new Date(query.from) } : {}),
            ...(query.to ? { lte: new Date(query.to) } : {}),
          },
        }
      : {};

  return prisma.sale.findMany({
    where: {
      ...scope,
      ...dateFilter,
      ...(query.status ? { status: query.status } : {}),
      ...(query.salespersonId && viewer.role !== "SALES"
        ? { salespersonId: query.salespersonId }
        : {}),
    },
    select: saleDetail,
    orderBy: { saleDate: "desc" },
  });
}

export async function getSaleById(id: string, viewer: Viewer) {
  const sale = await prisma.sale.findUnique({
    where: { id },
    select: saleDetail,
  });

  if (!sale) {
    return null;
  }

  if (
    viewer.role === "SALES" &&
    sale.salesperson.id !== viewer.userId
  ) {
    return null;
  }

  if (
    viewer.role === "SUPERVISOR" &&
    sale.location.id !== viewer.branchId
  ) {
    return null;
  }

  return sale;
}

// Sending the sale to the supervisor for approval.
export async function submitSale(id: string, viewer: Viewer) {
  const sale = await prisma.sale.findUnique({
    where: { id },
    select: { id: true, status: true, salespersonId: true },
  });

  if (!sale) {
    throw new Error("SALE_NOT_FOUND");
  }

  if (sale.salespersonId !== viewer.userId) {
    throw new Error("NOT_YOUR_SALE");
  }

  if (sale.status !== "DRAFT") {
    throw new Error("SALE_NOT_DRAFT");
  }

  return prisma.sale.update({
    where: { id },
    data: { status: "SUBMITTED", submittedAt: new Date() },
    select: saleDetail,
  });
}

// Approval is the moment stock actually leaves the branch: balances drop and
// the individual SIMs and phones sold are marked SOLD.
export async function approveSale(id: string, viewer: Viewer) {
  const sale = await prisma.sale.findUnique({
    where: { id },
    include: {
      items: {
        include: {
          product: { select: { id: true, category: true } },
        },
      },
    },
  });

  if (!sale) {
    throw new Error("SALE_NOT_FOUND");
  }

  // createSale settles the stock the moment the sale is recorded: it decrements
  // the branch balance, decrements the seller's holding, and writes the SALE
  // movement. So approval must never settle it a second time. Nothing writes a
  // DRAFT sale today, but these routes are still registered and the owner may
  // want draft sales later, so the guard is on the data rather than the route:
  // if a SALE movement already exists for this sale, the goods have gone.
  const settled = await prisma.stockMovement.findFirst({
    where: {
      referenceType: "Sale",
      referenceId: sale.id,
      type: "SALE",
    },
    select: { id: true },
  });

  if (settled) {
    throw new Error("SALE_ALREADY_SETTLED");
  }

  if (sale.status !== "SUBMITTED") {
    throw new Error("SALE_NOT_SUBMITTED");
  }

  if (
    viewer.role === "SUPERVISOR" &&
    sale.locationId !== viewer.branchId
  ) {
    throw new Error("NOT_YOUR_BRANCH");
  }

  // Authoritative stock check: other sales may have been approved since.
  await assertBranchHasStock(
    sale.locationId,
    sale.items.map((i) => ({
      productId: i.productId,
      quantity: i.quantity,
    })),
  );

  return prisma.$transaction(async (tx) => {
    for (const item of sale.items) {
      await tx.inventoryBalance.update({
        where: {
          locationId_productId: {
            locationId: sale.locationId,
            productId: item.productId,
          },
        },
        data: { quantity: { decrement: item.quantity } },
      });

      // There is nothing left to retire here. A serialized unit is created,
      // already SOLD, at the moment the sale is recorded; no IN_STOCK unit rows
      // are waiting to be matched up on approval any more.

      await tx.stockMovement.create({
        data: {
          productId: item.productId,
          fromLocationId: sale.locationId,
          quantity: item.quantity,
          type: "SALE",
          referenceType: "Sale",
          referenceId: sale.id,
          createdById: viewer.userId,
        },
      });
    }

    await tx.sale.update({
      where: { id },
      data: {
        status: "APPROVED",
        approvedById: viewer.userId,
        approvedAt: new Date(),
      },
    });

    return tx.sale.findUnique({
      where: { id },
      select: saleDetail,
    });
  });
}

export async function rejectSale(
  id: string,
  rejectionReason: string,
  viewer: Viewer,
) {
  const sale = await prisma.sale.findUnique({
    where: { id },
    select: { id: true, status: true, locationId: true, notes: true },
  });

  if (!sale) {
    throw new Error("SALE_NOT_FOUND");
  }

  if (sale.status !== "SUBMITTED") {
    throw new Error("SALE_NOT_SUBMITTED");
  }

  if (
    viewer.role === "SUPERVISOR" &&
    sale.locationId !== viewer.branchId
  ) {
    throw new Error("NOT_YOUR_BRANCH");
  }

  return prisma.sale.update({
    where: { id },
    data: {
      status: "REJECTED",
      approvedById: viewer.userId,
      notes: sale.notes
        ? `${sale.notes}\nRejected: ${rejectionReason}`
        : `Rejected: ${rejectionReason}`,
    },
    select: saleDetail,
  });
}

// Only an untouched draft can be removed. Anything submitted is part of the
// record.
export async function deleteSale(id: string, viewer: Viewer) {
  const sale = await prisma.sale.findUnique({
    where: { id },
    select: { id: true, status: true, salespersonId: true },
  });

  if (!sale) {
    throw new Error("SALE_NOT_FOUND");
  }

  if (
    viewer.role !== "OWNER" &&
    sale.salespersonId !== viewer.userId
  ) {
    throw new Error("NOT_YOUR_SALE");
  }

  if (sale.status !== "DRAFT") {
    throw new Error("SALE_NOT_DRAFT");
  }

  await prisma.sale.delete({ where: { id } });

  return { id };
}

import { Prisma } from "database";
import { prisma } from "../../plugins/prisma.js";
import { withBranchPrice } from "../products/branchPrice.js";
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
  editAllowedUntil: true,
  editedAt: true,
  editRequestedAt: true,
  payFixRequestedAt: true,
  payFixMethod: true,
  payFixCash: true,
  payFixTransfer: true,
  payFixBank: true,

  salesperson: {
    select: { id: true, name: true, role: true },
  },
  approvedBy: {
    select: { id: true, name: true, role: true },
  },
  location: {
    select: { id: true, name: true },
  },

  simTransfers: {
    select: { id: true, quantity: true, price: true },
  },

  billPayments: {
    select: { id: true, billType: true, account: true, amount: true },
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

// Only phones are sold with a serial (their IMEI). SIM cards are handed to a
// salesperson as an ICCID range on their request, so a sale needs none.
const SERIALIZED = ["PHONE"];

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

  // A main store only holds and sends stock; nothing is sold there.
  const location = await prisma.stockLocation.findUnique({
    where: { id: viewer.branchId },
    select: { isMainStock: true },
  });
  if (location?.isMainStock) {
    throw new Error("MAIN_STORE_NO_SALES");
  }

  const productIds = data.items.map((item) => item.productId);

  const products = await prisma.product.findMany({
    where: { id: { in: productIds }, status: "ACTIVE" },
    select: { id: true, price: true, costPrice: true, category: true, sku: true },
  });

  if (products.length !== new Set(productIds).size) {
    throw new Error("INVALID_PRODUCT");
  }

  // Each item sells at its price for this branch, if the Owner set one.
  const priced = await withBranchPrice(viewer.branchId, products);
  const catalogue = new Map(priced.map((p) => [p.id, p]));

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
      // Sales queued on a device before this change may still carry SIM
      // ICCIDs: they are ignored rather than refused.
      if (serials.length > 0 && product.category !== "SIM_CARD") {
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
      // Kept as it stands today, for profit and loss.
      unitCost: product.costPrice,
    };
  });

  // SIM transfers at the Owner's fixed price.
  const transferPrice = await simTransferPrice();
  subtotal = subtotal.add(transferPrice.mul(data.simTransferCount));
  // Bills at what the customer paid.
  for (const bill of data.bills) subtotal = subtotal.add(new Prisma.Decimal(bill.amount));

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
        // in the bank. A mixed payment splits between the two.
        ...(data.paymentMethod === "TRANSFER"
          ? {
              paymentMethod: "TRANSFER" as const,
              bankName: data.bankName ?? null,
              cashReceived: new Prisma.Decimal(0),
              transferReceived: new Prisma.Decimal(data.cashReceived),
            }
          : data.paymentMethod === "MIXED"
            ? {
                paymentMethod: "MIXED" as const,
                bankName: data.bankName ?? null,
                cashReceived: new Prisma.Decimal(data.cashReceived),
                transferReceived: new Prisma.Decimal(data.transferReceived ?? 0),
              }
            : { cashReceived: new Prisma.Decimal(data.cashReceived) }),
        notes: data.customerNote ?? null,
      },
      select: { id: true },
    });

    await writeLines(tx, {
      saleId: sale.id,
      items,
      serialsByLine,
      catalogue,
      branchId,
      userId: viewer.userId,
    });

    if (data.simTransferCount > 0) {
      await tx.saleSimTransfer.create({
        data: { saleId: sale.id, quantity: data.simTransferCount, price: transferPrice },
      });
    }

    await writeBills(tx, sale.id, data.bills);

    return tx.sale.findUnique({ where: { id: sale.id }, select: saleDetail });
  });
}

/** A sale's bills, one row each. */
async function writeBills(
  tx: Prisma.TransactionClient,
  saleId: string,
  bills: { type: string; amount: number; account?: string }[],
) {
  if (bills.length === 0) return;
  await tx.saleBillPayment.createMany({
    data: bills.map((bill) => ({
      saleId,
      billType: bill.type,
      account: bill.account || null,
      amount: new Prisma.Decimal(bill.amount),
    })),
  });
}

type Catalogue = Map<string, { category: string }>;

/**
 * Writes a sale's lines: each SaleItem, the stock leaving the branch's shelf
 * and the seller's holding, serial units for phones, and the SALE movement.
 * Shared by recording a sale and correcting one.
 */
async function writeLines(
  tx: Prisma.TransactionClient,
  {
    saleId,
    items,
    serialsByLine,
    catalogue,
    branchId,
    userId,
  }: {
    saleId: string;
    items: { productId: string; quantity: number; unitPrice: Prisma.Decimal; lineTotal: Prisma.Decimal; unitCost: Prisma.Decimal | null }[];
    serialsByLine: Map<number, string[]>;
    catalogue: Catalogue;
    branchId: string;
    userId: string;
  },
) {
  const sale = { id: saleId };
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
          userId: userId,
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
        createdById: userId,
      },
    });
  }

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
    // Named, so the seller knows which item and how many they really hold.
    const names = await prisma.product.findMany({
      where: { id: { in: shortages.map((row) => row.productId) } },
      select: { id: true, name: true },
    });
    const nameOf = new Map(names.map((row) => [row.id, row.name]));
    const error = new Error("NOT_IN_YOUR_HOLDING");
    Object.assign(error, {
      shortages: shortages.map((row) => ({ ...row, name: nameOf.get(row.productId) ?? row.productId })),
    });
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

  // A date with no time is a whole local day: from its first moment to its
  // last, so "to=2026-10-12" includes that day's sales.
  const dayStart = (value: string) => (value.includes("T") ? new Date(value) : new Date(`${value}T00:00:00`));
  const dayEnd = (value: string) => (value.includes("T") ? new Date(value) : new Date(`${value}T23:59:59.999`));
  const dateFilter =
    query.from || query.to
      ? {
          saleDate: {
            ...(query.from ? { gte: dayStart(query.from) } : {}),
            ...(query.to ? { lte: dayEnd(query.to) } : {}),
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
    ...(query.limit ? { take: query.limit } : {}),
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

  if (sale.status === "DRAFT") {
    await prisma.sale.delete({ where: { id } });
    return { id };
  }

  // A recorded sale: on its own day, or while the Owner allows it (the
  // Owner any time). Its goods go back where they came from.
  const full = await prisma.sale.findUniqueOrThrow({
    where: { id },
    select: {
      saleDate: true,
      editAllowedUntil: true,
      locationId: true,
      salespersonId: true,
      items: { select: { id: true, productId: true, quantity: true } },
    },
  });
  if (viewer.role !== "OWNER" && !saleEditable(full)) throw new Error("EDIT_LOCKED");

  await prisma.$transaction(async (tx) => {
    for (const line of full.items) {
      await tx.inventoryBalance.update({
        where: { locationId_productId: { locationId: full.locationId, productId: line.productId } },
        data: { quantity: { increment: line.quantity } },
      });
      await tx.salespersonHolding.upsert({
        where: { userId_productId: { userId: full.salespersonId, productId: line.productId } },
        create: { userId: full.salespersonId, productId: line.productId, quantity: line.quantity },
        update: { quantity: { increment: line.quantity } },
      });
    }
    await tx.inventoryUnit.deleteMany({ where: { saleItemId: { in: full.items.map((item) => item.id) } } });
    await tx.stockMovement.deleteMany({ where: { referenceType: "Sale", referenceId: id } });
    await tx.saleItem.deleteMany({ where: { saleId: id } });
    await tx.sale.delete({ where: { id } });
  });

  return { id };
}

/** Whether a sale can still be corrected: on its own day, or later while the Owner allows it. */
export function saleEditable(sale: { saleDate: Date; editAllowedUntil: Date | null }, now = new Date()) {
  const sameDay =
    sale.saleDate.getFullYear() === now.getFullYear() &&
    sale.saleDate.getMonth() === now.getMonth() &&
    sale.saleDate.getDate() === now.getDate();
  return sameDay || (sale.editAllowedUntil != null && sale.editAllowedUntil > now);
}

/**
 * A salesperson corrects their own sale: its items, how it was paid, its
 * note. The old lines are put back first (onto the branch's shelf and the
 * seller's holding) and the corrected ones taken out, all in one step, so
 * stock can never be counted twice. Allowed on the sale's own day; after
 * that only while the Owner allows it.
 */
export async function updateSale(id: string, data: CreateSaleInput, viewer: Viewer) {
  const sale = await prisma.sale.findUnique({
    where: { id },
    select: {
      id: true,
      salespersonId: true,
      locationId: true,
      saleDate: true,
      editAllowedUntil: true,
      items: { select: { id: true, productId: true, quantity: true, unitPrice: true, unitCost: true } },
    },
  });
  if (!sale) throw new Error("SALE_NOT_FOUND");
  if (sale.salespersonId !== viewer.userId) throw new Error("NOT_YOUR_SALE");
  // A correction keeps the price an item was sold at; only an item added now
  // takes today's price.
  const soldAt = new Map(sale.items.map((item) => [item.productId, { price: item.unitPrice, cost: item.unitCost }]));
  if (!saleEditable(sale)) throw new Error("EDIT_LOCKED");

  const productIds = data.items.map((item) => item.productId);
  const products = await prisma.product.findMany({
    where: { id: { in: productIds }, status: "ACTIVE" },
    select: { id: true, price: true, costPrice: true, category: true, sku: true, name: true },
  });
  if (products.length !== new Set(productIds).size) throw new Error("INVALID_PRODUCT");
  const priced = await withBranchPrice(sale.locationId, products);
  const catalogue = new Map(priced.map((p) => [p.id, p]));

  // Phones carry one IMEI per unit, as when the sale was first recorded.
  const serialsByLine = new Map<number, string[]>();
  for (const [index, item] of data.items.entries()) {
    const product = catalogue.get(item.productId)!;
    if (!SERIALIZED.includes(product.category)) continue;
    const serials = item.serials ?? [];
    if (serials.length !== item.quantity) throw new Error("SERIAL_COUNT_MISMATCH");
    serialsByLine.set(index, serials);
  }
  const allSerials = [...serialsByLine.values()].flat();
  if (new Set(allSerials).size !== allSerials.length) throw new Error("SERIAL_REPEATED");
  if (allSerials.length > 0) {
    const taken = await prisma.inventoryUnit.findFirst({
      where: {
        OR: [{ imei: { in: allSerials } }, { iccid: { in: allSerials } }],
        // This sale's own units are about to be replaced.
        NOT: { saleItemId: { in: sale.items.map((item) => item.id) } },
      },
      select: { id: true },
    });
    if (taken) throw new Error("SERIAL_ALREADY_SOLD");
  }

  let subtotal = new Prisma.Decimal(0);
  const items = data.items.map((item) => {
    const product = catalogue.get(item.productId)!;
    const before = soldAt.get(item.productId);
    const unitPrice = before?.price ?? product.price;
    const lineTotal = unitPrice.mul(item.quantity);
    subtotal = subtotal.add(lineTotal);
    return { productId: item.productId, quantity: item.quantity, unitPrice, lineTotal, unitCost: before ? before.cost : product.costPrice };
  });

  // SIM transfers already in the sale keep their price; new ones take today's.
  const transferPrice = await simTransferPrice();
  const oldTransfers = await prisma.saleSimTransfer.findMany({ where: { saleId: sale.id }, select: { price: true } });
  const keptPrice = oldTransfers[0]?.price ?? transferPrice;
  subtotal = subtotal.add(keptPrice.mul(data.simTransferCount));
  for (const bill of data.bills) subtotal = subtotal.add(new Prisma.Decimal(bill.amount));

  return prisma.$transaction(async (tx) => {
    await tx.saleSimTransfer.deleteMany({ where: { saleId: sale.id } });
    if (data.simTransferCount > 0) {
      await tx.saleSimTransfer.create({
        data: { saleId: sale.id, quantity: data.simTransferCount, price: keptPrice },
      });
    }
    await tx.saleBillPayment.deleteMany({ where: { saleId: sale.id } });
    await writeBills(tx, sale.id, data.bills);

    // Put the old lines back where they came from.
    for (const line of sale.items) {
      await tx.inventoryBalance.update({
        where: { locationId_productId: { locationId: sale.locationId, productId: line.productId } },
        data: { quantity: { increment: line.quantity } },
      });
      await tx.salespersonHolding.upsert({
        where: { userId_productId: { userId: sale.salespersonId, productId: line.productId } },
        create: { userId: sale.salespersonId, productId: line.productId, quantity: line.quantity },
        update: { quantity: { increment: line.quantity } },
      });
    }
    await tx.inventoryUnit.deleteMany({ where: { saleItemId: { in: sale.items.map((item) => item.id) } } });
    await tx.stockMovement.deleteMany({ where: { referenceType: "Sale", referenceId: sale.id } });
    await tx.saleItem.deleteMany({ where: { saleId: sale.id } });

    // The corrected lines must fit what the seller and the branch now hold.
    const wanted = new Map<string, number>();
    for (const item of items) wanted.set(item.productId, (wanted.get(item.productId) ?? 0) + item.quantity);
    const [held, shelf] = await Promise.all([
      tx.salespersonHolding.findMany({
        where: { userId: sale.salespersonId, productId: { in: [...wanted.keys()] } },
        select: { productId: true, quantity: true },
      }),
      tx.inventoryBalance.findMany({
        where: { locationId: sale.locationId, productId: { in: [...wanted.keys()] } },
        select: { productId: true, quantity: true },
      }),
    ]);
    const heldBy = new Map(held.map((row) => [row.productId, row.quantity]));
    const shelfBy = new Map(shelf.map((row) => [row.productId, row.quantity]));
    const shortages = [...wanted.entries()]
      .filter(([productId, quantity]) => (heldBy.get(productId) ?? 0) < quantity)
      .map(([productId, quantity]) => ({
        productId,
        name: (catalogue.get(productId) as { name?: string } | undefined)?.name ?? productId,
        requested: quantity,
        available: heldBy.get(productId) ?? 0,
      }));
    if (shortages.length > 0) {
      const error = new Error("NOT_IN_YOUR_HOLDING");
      Object.assign(error, { shortages });
      throw error;
    }
    if ([...wanted.entries()].some(([productId, quantity]) => (shelfBy.get(productId) ?? 0) < quantity)) {
      throw new Error("INSUFFICIENT_STOCK");
    }

    await tx.sale.update({
      where: { id: sale.id },
      data: {
        subtotal,
        totalAmount: subtotal,
        editedAt: new Date(),
        ...(data.paymentMethod === "TRANSFER"
          ? {
              paymentMethod: "TRANSFER" as const,
              bankName: data.bankName ?? null,
              cashReceived: new Prisma.Decimal(0),
              transferReceived: new Prisma.Decimal(data.cashReceived),
            }
          : data.paymentMethod === "MIXED"
            ? {
                paymentMethod: "MIXED" as const,
                bankName: data.bankName ?? null,
                cashReceived: new Prisma.Decimal(data.cashReceived),
                transferReceived: new Prisma.Decimal(data.transferReceived ?? 0),
              }
            : {
                paymentMethod: "CASH" as const,
                bankName: null,
                cashReceived: new Prisma.Decimal(data.cashReceived),
                transferReceived: new Prisma.Decimal(0),
              }),
        notes: data.customerNote ?? null,
      },
    });

    await writeLines(tx, {
      saleId: sale.id,
      items,
      serialsByLine,
      catalogue,
      branchId: sale.locationId,
      userId: sale.salespersonId,
    });

    return tx.sale.findUnique({ where: { id: sale.id }, select: saleDetail });
  });
}

/**
 * A salesperson says how their sale was really paid (a mistyped transfer
 * amount). Nothing changes until the Owner approves it.
 */
export async function requestPaymentFix(
  id: string,
  fix: { paymentMethod: "CASH" | "TRANSFER" | "MIXED"; cashReceived: number; transferReceived: number; bankName?: string; note?: string },
  viewer: Viewer,
) {
  const sale = await prisma.sale.findUnique({ where: { id }, select: { salespersonId: true, status: true } });
  if (!sale || sale.salespersonId !== viewer.userId || sale.status !== "APPROVED") throw new Error("SALE_NOT_FOUND");
  return prisma.sale.update({
    where: { id },
    data: {
      payFixRequestedAt: new Date(),
      payFixMethod: fix.paymentMethod,
      payFixCash: new Prisma.Decimal(fix.paymentMethod === "TRANSFER" ? 0 : fix.cashReceived),
      payFixTransfer: new Prisma.Decimal(fix.paymentMethod === "CASH" ? 0 : fix.transferReceived),
      payFixBank: fix.paymentMethod === "CASH" ? null : (fix.bankName ?? null),
      payFixNote: fix.note || null,
    },
    select: saleDetail,
  });
}

/** A sale's day as YYYY-MM-DD, the way edit grants name it. */
function dayKey(d: Date) {
  return `${d.getFullYear()}-${`${d.getMonth() + 1}`.padStart(2, "0")}-${`${d.getDate()}`.padStart(2, "0")}`;
}

/** A salesperson asks the Owner to open a day's payments for 24 hours. */
export async function requestPaymentEdit(day: string, viewer: Viewer) {
  return prisma.paymentEditGrant.upsert({
    where: { userId_day: { userId: viewer.userId, day } },
    create: { userId: viewer.userId, day, requestedAt: new Date() },
    update: { requestedAt: new Date() },
    select: { day: true, requestedAt: true, until: true },
  });
}

/** Whether a day's payments are asked for, or open, for this salesperson. */
export async function paymentEditStatus(day: string, viewer: Viewer) {
  return prisma.paymentEditGrant.findUnique({
    where: { userId_day: { userId: viewer.userId, day } },
    select: { day: true, requestedAt: true, until: true },
  });
}

/** Days waiting for the Owner to open their payments. */
export async function listPaymentEditRequests() {
  return prisma.paymentEditGrant.findMany({
    where: { requestedAt: { not: null } },
    select: {
      day: true,
      requestedAt: true,
      user: { select: { id: true, name: true, branch: { select: { name: true } } } },
    },
    orderBy: { requestedAt: "desc" },
    take: 200,
  });
}

/** The Owner opens a day's payments for 24 hours, or turns it down. */
export async function decidePaymentEdit(data: { salespersonId: string; day: string; allow: boolean }) {
  return prisma.paymentEditGrant.update({
    where: { userId_day: { userId: data.salespersonId, day: data.day } },
    data: data.allow
      ? { requestedAt: null, until: new Date(Date.now() + 24 * 60 * 60 * 1000) }
      : { requestedAt: null },
    select: { day: true, until: true },
  });
}

/**
 * A salesperson corrects how one of their sales was paid: on its own day, or
 * while the Owner has the day open.
 */
export async function updateSalePayment(
  id: string,
  fix: { paymentMethod: "CASH" | "TRANSFER" | "MIXED"; cashReceived: number; transferReceived: number; bankName?: string },
  viewer: Viewer,
) {
  const sale = await prisma.sale.findUnique({
    where: { id },
    select: { salespersonId: true, status: true, saleDate: true, editAllowedUntil: true },
  });
  if (!sale || sale.salespersonId !== viewer.userId || sale.status !== "APPROVED") throw new Error("SALE_NOT_FOUND");
  const grant = await prisma.paymentEditGrant.findUnique({
    where: { userId_day: { userId: viewer.userId, day: dayKey(sale.saleDate) } },
    select: { until: true },
  });
  const open = saleEditable(sale) || (grant?.until != null && grant.until > new Date());
  if (!open) throw new Error("EDIT_LOCKED");
  return prisma.sale.update({
    where: { id },
    data: {
      paymentMethod: fix.paymentMethod,
      cashReceived: new Prisma.Decimal(fix.paymentMethod === "TRANSFER" ? 0 : fix.cashReceived),
      transferReceived: new Prisma.Decimal(fix.paymentMethod === "CASH" ? 0 : fix.transferReceived),
      bankName: fix.paymentMethod === "CASH" ? null : (fix.bankName ?? null),
      editedAt: new Date(),
    },
    select: saleDetail,
  });
}

/** Payment corrections waiting for the Owner, with the sale as it stands. */
export async function listPaymentFixes() {
  return prisma.sale.findMany({
    where: { payFixRequestedAt: { not: null } },
    select: {
      id: true,
      saleDate: true,
      totalAmount: true,
      paymentMethod: true,
      cashReceived: true,
      transferReceived: true,
      bankName: true,
      payFixRequestedAt: true,
      payFixMethod: true,
      payFixCash: true,
      payFixTransfer: true,
      payFixBank: true,
      payFixNote: true,
      salesperson: { select: { id: true, name: true } },
      location: { select: { name: true } },
    },
    orderBy: { payFixRequestedAt: "desc" },
    take: 200,
  });
}

/** The Owner applies a payment correction, or turns it down. */
export async function decidePaymentFix(id: string, allow: boolean) {
  const sale = await prisma.sale.findUnique({
    where: { id },
    select: { payFixRequestedAt: true, payFixMethod: true, payFixCash: true, payFixTransfer: true, payFixBank: true },
  });
  if (!sale || !sale.payFixRequestedAt || !sale.payFixMethod) throw new Error("SALE_NOT_FOUND");
  const clear = {
    payFixRequestedAt: null,
    payFixMethod: null,
    payFixCash: null,
    payFixTransfer: null,
    payFixBank: null,
    payFixNote: null,
  };
  return prisma.sale.update({
    where: { id },
    data: allow
      ? {
          ...clear,
          paymentMethod: sale.payFixMethod,
          cashReceived: sale.payFixCash ?? new Prisma.Decimal(0),
          transferReceived: sale.payFixTransfer ?? new Prisma.Decimal(0),
          bankName: sale.payFixBank,
          editedAt: new Date(),
        }
      : clear,
    select: saleDetail,
  });
}

/**
 * The Owner lets a salesperson correct their sales of a past day, until the
 * end of today.
 */
export async function allowSaleEdits(data: { salespersonId: string; day: string }) {
  const start = new Date(`${data.day}T00:00:00`);
  const end = new Date(`${data.day}T23:59:59.999`);
  if (Number.isNaN(start.getTime())) throw new Error("INVALID_DAY");
  const until = new Date();
  until.setHours(23, 59, 59, 999);
  const { count } = await prisma.sale.updateMany({
    where: { salespersonId: data.salespersonId, saleDate: { gte: start, lte: end } },
    data: { editAllowedUntil: until, editRequestedAt: null },
  });
  // The same day's Telebirr and National ID entries open too.
  await prisma.editGrant.upsert({
    where: { userId_day: { userId: data.salespersonId, day: data.day } },
    create: { userId: data.salespersonId, day: data.day, until },
    update: { until },
  });
  return { count, until };
}

/** Days salespeople have asked the Owner to open, still waiting. */
export async function listEditRequests() {
  const rows = await prisma.sale.findMany({
    where: {
      editRequestedAt: { not: null },
      OR: [{ editAllowedUntil: null }, { editAllowedUntil: { lt: new Date() } }],
    },
    select: {
      saleDate: true,
      editRequestedAt: true,
      salesperson: { select: { id: true, name: true, branch: { select: { name: true } } } },
    },
    orderBy: { editRequestedAt: "desc" },
    take: 500,
  });
  const days = new Map<
    string,
    { salespersonId: string; name: string; branch: string | null; day: string; sales: number; askedAt: Date }
  >();
  for (const row of rows) {
    const d = row.saleDate;
    const day = `${d.getFullYear()}-${`${d.getMonth() + 1}`.padStart(2, "0")}-${`${d.getDate()}`.padStart(2, "0")}`;
    const key = `${row.salesperson.id}|${day}`;
    const entry = days.get(key) ?? {
      salespersonId: row.salesperson.id,
      name: row.salesperson.name,
      branch: row.salesperson.branch?.name ?? null,
      day,
      sales: 0,
      askedAt: row.editRequestedAt!,
    };
    entry.sales += 1;
    days.set(key, entry);
  }
  return [...days.values()];
}

/** The Owner turns a request down. */
export async function declineEditRequest(data: { salespersonId: string; day: string }) {
  const start = new Date(`${data.day}T00:00:00`);
  const end = new Date(`${data.day}T23:59:59.999`);
  if (Number.isNaN(start.getTime())) throw new Error("INVALID_DAY");
  await prisma.sale.updateMany({
    where: { salespersonId: data.salespersonId, saleDate: { gte: start, lte: end } },
    data: { editRequestedAt: null },
  });
}

/** A salesperson asks the Owner to let them correct a whole past day. */
export async function requestDayEdit(day: string, viewer: Viewer) {
  const start = new Date(`${day}T00:00:00`);
  const end = new Date(`${day}T23:59:59.999`);
  if (Number.isNaN(start.getTime())) throw new Error("INVALID_DAY");
  const { count } = await prisma.sale.updateMany({
    where: {
      salespersonId: viewer.userId,
      saleDate: { gte: start, lte: end },
      OR: [{ editAllowedUntil: null }, { editAllowedUntil: { lt: new Date() } }],
    },
    data: { editRequestedAt: new Date() },
  });
  return { requested: count > 0 };
}

/** A salesperson asks the Owner to let them correct a past day's sale. */
export async function requestSaleEdit(id: string, viewer: Viewer) {
  const sale = await prisma.sale.findUnique({
    where: { id },
    select: { id: true, salespersonId: true, saleDate: true, editAllowedUntil: true },
  });
  if (!sale) throw new Error("SALE_NOT_FOUND");
  if (sale.salespersonId !== viewer.userId) throw new Error("NOT_YOUR_SALE");
  if (saleEditable(sale)) return { requested: false };
  await prisma.sale.update({ where: { id }, data: { editRequestedAt: new Date() } });
  return { requested: true };
}

/** The Owner's fixed price for one SIM transfer. */
async function simTransferPrice() {
  const settings = await prisma.appSetting.findFirst({ select: { simTransferPrice: true } });
  return settings?.simTransferPrice ?? new Prisma.Decimal(0);
}

/** The pseudo product a day's SIM transfers are edited under. */
export const SIM_TRANSFER_TOTAL = "SIM_TRANSFER";

/**
 * A salesperson corrects a whole day by its totals: how many of each SIM card
 * and airtime value they sold that day (and how many SIM transfers). Items of
 * one kind all sell at one price, so the change is spread over that day's
 * sales, latest first, and each sale is corrected the normal way (stock goes
 * back or out, the price it sold at is kept, the payment follows the total).
 * Phones are corrected sale by sale instead, since each is a specific unit.
 */
export async function editDayTotals(
  viewer: Viewer,
  day: string,
  totals: { productId: string; quantity: number }[],
) {
  const start = new Date(`${day}T00:00:00`);
  if (Number.isNaN(start.getTime())) throw new Error("INVALID_DAY");
  const end = new Date(start);
  end.setDate(end.getDate() + 1);

  const sales = await prisma.sale.findMany({
    where: { salespersonId: viewer.userId, status: "APPROVED", saleDate: { gte: start, lt: end } },
    orderBy: { saleDate: "desc" },
    select: {
      id: true,
      saleDate: true,
      editAllowedUntil: true,
      paymentMethod: true,
      bankName: true,
      transferReceived: true,
      notes: true,
      items: {
        select: {
          id: true,
          productId: true,
          quantity: true,
          unitPrice: true,
          product: { select: { category: true } },
          inventoryUnits: { select: { imei: true, iccid: true } },
        },
      },
      simTransfers: { select: { quantity: true, price: true } },
      billPayments: { select: { billType: true, account: true, amount: true } },
    },
  });
  if (sales.length === 0) throw new Error("SALE_NOT_FOUND");
  if (!sales.every((sale) => saleEditable(sale))) throw new Error("EDIT_LOCKED");

  // A working copy of every sale's lines and transfer count.
  const work = sales.map((sale) => ({
    sale,
    lines: sale.items.map((item) => ({
      productId: item.productId,
      quantity: item.quantity,
      unitPrice: Number(item.unitPrice),
      serialized: SERIALIZED.includes(item.product.category),
      serials: item.inventoryUnits.map((unit) => unit.imei ?? unit.iccid ?? "").filter(Boolean),
    })),
    transfers: sale.simTransfers.reduce((sum, row) => sum + row.quantity, 0),
    transferPrice: Number(sale.simTransfers[0]?.price ?? 0),
    // Bills are not corrected here; they stay as they were.
    bills: sale.billPayments.map((bill) => ({
      type: bill.billType,
      amount: Number(bill.amount),
      ...(bill.account ? { account: bill.account } : {}),
    })),
    changed: false,
  }));

  for (const target of totals) {
    if (target.productId === SIM_TRANSFER_TOTAL) {
      let diff = target.quantity - work.reduce((sum, entry) => sum + entry.transfers, 0);
      for (const entry of work) {
        if (diff === 0) break;
        if (diff < 0 && entry.transfers > 0) {
          const take = Math.min(entry.transfers, -diff);
          entry.transfers -= take;
          diff += take;
          entry.changed = true;
        }
      }
      if (diff > 0) {
        const latest = work.find((entry) => entry.transfers > 0) ?? work[0];
        latest.transfers += diff;
        latest.changed = true;
      }
      continue;
    }

    const holding = work.filter((entry) => entry.lines.some((line) => line.productId === target.productId));
    if (holding.length === 0) continue;
    if (holding.some((entry) => entry.lines.some((line) => line.productId === target.productId && line.serialized))) {
      throw new Error("SERIALS_NOT_EXPECTED");
    }
    let diff =
      target.quantity -
      holding.reduce(
        (sum, entry) =>
          sum + entry.lines.filter((line) => line.productId === target.productId).reduce((s, line) => s + line.quantity, 0),
        0,
      );
    if (diff > 0) {
      const line = holding[0].lines.find((entry) => entry.productId === target.productId)!;
      line.quantity += diff;
      holding[0].changed = true;
      continue;
    }
    for (const entry of holding) {
      if (diff === 0) break;
      for (const line of entry.lines) {
        if (diff === 0) break;
        if (line.productId !== target.productId || line.quantity === 0) continue;
        const take = Math.min(line.quantity, -diff);
        line.quantity -= take;
        diff += take;
        entry.changed = true;
      }
    }
  }

  // Sales that shrank go first, so their goods are back before any grows.
  const changed = work
    .filter((entry) => entry.changed)
    .sort((a, b) => {
      const size = (entry: (typeof work)[number]) => entry.lines.reduce((sum, line) => sum + line.quantity, 0);
      const before = (entry: (typeof work)[number]) => entry.sale.items.reduce((sum, item) => sum + item.quantity, 0);
      return size(a) - before(a) - (size(b) - before(b));
    });

  let updated = 0;
  for (const entry of changed) {
    const items = entry.lines.filter((line) => line.quantity > 0);
    if (items.length === 0 && entry.transfers === 0 && entry.bills.length === 0) {
      await deleteSale(entry.sale.id, viewer);
      updated += 1;
      continue;
    }
    const total =
      items.reduce((sum, line) => sum + line.quantity * line.unitPrice, 0) +
      entry.transfers * entry.transferPrice +
      entry.bills.reduce((sum, bill) => sum + bill.amount, 0);
    const transfer = Number(entry.sale.transferReceived);
    const method = entry.sale.paymentMethod;
    const payment =
      method === "MIXED" && transfer < total
        ? { paymentMethod: "MIXED" as const, cashReceived: total - transfer, transferReceived: transfer }
        : method === "CASH"
          ? { paymentMethod: "CASH" as const, cashReceived: total }
          : { paymentMethod: "TRANSFER" as const, cashReceived: total };
    await updateSale(
      entry.sale.id,
      {
        items: items.map((line) => ({
          productId: line.productId,
          quantity: line.quantity,
          ...(line.serialized ? { serials: line.serials } : {}),
        })),
        simTransferCount: entry.transfers,
        bills: entry.bills,
        ...payment,
        ...(entry.sale.bankName ? { bankName: entry.sale.bankName } : {}),
        ...(entry.sale.notes ? { customerNote: entry.sale.notes } : {}),
      },
      viewer,
    );
    updated += 1;
  }

  return { updated };
}

import { prisma } from "../../plugins/prisma.js";
import { sendOut, shelfStock } from "../requests/request.service.js";
import type { Viewer } from "../../middleware/auth.js";
import type { ListTransfersQuery } from "./transfer.schema.js";
import { addToBranchShare, isMainStore, sendableStock, takeFromBranchShare } from "../inventory/branchStock.js";

const transferDetail = {
  id: true,
  directSend: true,
  status: true,
  notes: true,
  shippedAt: true,
  receivedAt: true,
  createdAt: true,

  driverName: true,
  driverPhone: true,
  vehiclePlate: true,

  fromLocation: {
    select: { id: true, name: true, isMainStock: true },
  },
  toLocation: {
    select: {
      id: true,
      name: true,
      isMainStock: true,
      // A branch with a supervisor receives its own goods; the Owner only
      // receives for a branch without one (the store).
      _count: { select: { users: { where: { role: "SUPERVISOR" as const, isActive: true } } } },
    },
  },

  deliveredBy: { select: { id: true, name: true, role: true } },
  receivedBy: { select: { id: true, name: true, role: true } },

  request: {
    select: {
      id: true,
      status: true,
      notes: true,
      requestedBy: { select: { id: true, name: true } },
    },
  },

  items: {
    select: {
      id: true,
      quantity: true,
      product: {
        select: {
          id: true,
          sku: true,
          name: true,
          category: true,
        },
      },
    },
  },
};

// A branch sees transfers at either end: what it is sending and what is
// coming to it. The Owner sees everything.
export async function getTransfers(
  query: ListTransfersQuery,
  viewer: Viewer,
) {
  const branchId =
    viewer.role === "OWNER" ? query.branchId : viewer.branchId;

  const scope = branchId
    ? {
        OR: [
          { fromLocationId: branchId },
          { toLocationId: branchId },
        ],
      }
    : {};

  return prisma.stockTransfer.findMany({
    where: {
      ...scope,
      ...(query.status ? { status: query.status } : {}),
    },
    select: transferDetail,
    orderBy: { createdAt: "desc" },
  });
}

export async function getTransferById(
  id: string,
  viewer: Viewer,
) {
  const transfer = await prisma.stockTransfer.findUnique({
    where: { id },
    select: transferDetail,
  });

  if (!transfer) {
    return null;
  }

  if (
    viewer.role !== "OWNER" &&
    transfer.fromLocation.id !== viewer.branchId &&
    transfer.toLocation.id !== viewer.branchId
  ) {
    return null;
  }

  return transfer;
}

// Shipping takes the stock out of the source branch. It is deliberately not
// added to the destination yet - it is in transit and belongs to neither.
export async function shipTransfer(
  id: string,
  notes: string | undefined,
  viewer: Viewer,
) {
  const transfer = await prisma.stockTransfer.findUnique({
    where: { id },
    include: { items: true },
  });

  if (!transfer) {
    throw new Error("TRANSFER_NOT_FOUND");
  }

  if (transfer.status !== "PENDING") {
    throw new Error("TRANSFER_NOT_PENDING");
  }

  // Re-check availability: stock may have been sold since approval.
  // Goods issued to the branch's salespeople are not the branch's to send.
  const available = await sendableStock(
    transfer.fromLocationId,
    transfer.toLocationId,
    transfer.items.map((i) => i.productId),
  );

  const shortages = transfer.items
    .filter(
      (item) => (available.get(item.productId) ?? 0) < item.quantity,
    )
    .map((item) => ({
      productId: item.productId,
      requested: item.quantity,
      available: available.get(item.productId) ?? 0,
    }));

  if (shortages.length > 0) {
    const error = new Error("INSUFFICIENT_SOURCE_STOCK");
    Object.assign(error, { shortages });
    throw error;
  }

  const fromMain = await isMainStore(prisma, transfer.fromLocationId);

  return prisma.$transaction(async (tx) => {
    for (const item of transfer.items) {
      // From a main store it comes out of the receiving branch's share.
      if (fromMain) await takeFromBranchShare(tx, transfer.toLocationId, item.productId, item.quantity);

      await tx.inventoryBalance.update({
        where: {
          locationId_productId: {
            locationId: transfer.fromLocationId,
            productId: item.productId,
          },
        },
        data: { quantity: { decrement: item.quantity } },
      });

      await tx.stockMovement.create({
        data: {
          productId: item.productId,
          fromLocationId: transfer.fromLocationId,
          toLocationId: transfer.toLocationId,
          quantity: item.quantity,
          type: "TRANSFER",
          referenceType: "StockTransfer",
          referenceId: transfer.id,
          createdById: viewer.userId,
          notes: notes ?? "Shipped",
        },
      });
    }

    await tx.stockTransfer.update({
      where: { id },
      data: {
        status: "IN_TRANSIT",
        deliveredById: viewer.userId,
        shippedAt: new Date(),
        ...(notes ? { notes } : {}),
      },
    });

    return tx.stockTransfer.findUnique({
      where: { id },
      select: transferDetail,
    });
  });
}

// The supervisor confirms what physically arrived. This is the moment the
// branch's stock goes up and the original request is closed.
export async function receiveTransfer(
  id: string,
  notes: string | undefined,
  viewer: Viewer,
) {
  const transfer = await prisma.stockTransfer.findUnique({
    where: { id },
    include: { items: true },
  });

  if (!transfer) {
    throw new Error("TRANSFER_NOT_FOUND");
  }

  if (transfer.status !== "IN_TRANSIT") {
    throw new Error("TRANSFER_NOT_IN_TRANSIT");
  }

  // Only the receiving branch confirms receipt: its supervisor counts what
  // arrived. The Owner receives only for a branch with no supervisor.
  if (viewer.role === "OWNER") {
    const supervisors = await prisma.user.count({
      where: { role: "SUPERVISOR", isActive: true, branchId: transfer.toLocationId },
    });
    if (supervisors > 0) throw new Error("NOT_YOUR_TRANSFER");
  } else if (transfer.toLocationId !== viewer.branchId) {
    throw new Error("NOT_YOUR_TRANSFER");
  }

  // Stock a branch sends back to a main store goes into that branch's share.
  const toMain = await isMainStore(prisma, transfer.toLocationId);

  return prisma.$transaction(async (tx) => {
    // Stock is a count. Unit rows exist only for items already sold, and
    // those never move between branches.
    for (const item of transfer.items) {
      if (toMain) await addToBranchShare(tx, transfer.fromLocationId, item.productId, item.quantity);

      await tx.inventoryBalance.upsert({
        where: {
          locationId_productId: {
            locationId: transfer.toLocationId,
            productId: item.productId,
          },
        },
        create: {
          locationId: transfer.toLocationId,
          productId: item.productId,
          quantity: item.quantity,
        },
        update: { quantity: { increment: item.quantity } },
      });
    }

    await tx.stockTransfer.update({
      where: { id },
      data: {
        status: "RECEIVED",
        receivedById: viewer.userId,
        receivedAt: new Date(),
        ...(notes ? { notes } : {}),
      },
    });

    // Every request that came in this car is fulfilled.
    await tx.stockRequest.updateMany({
      where: {
        OR: [{ shipmentId: id }, ...(transfer.requestId ? [{ id: transfer.requestId }] : [])],
      },
      data: { status: "FULFILLED", fulfilledAt: new Date() },
    });

    return tx.stockTransfer.findUnique({
      where: { id },
      select: transferDetail,
    });
  });
}

// Cancelling returns any already-shipped stock to the source branch.
export async function cancelTransfer(
  id: string,
  reason: string | undefined,
  viewer: Viewer,
) {
  const transfer = await prisma.stockTransfer.findUnique({
    where: { id },
    include: { items: true },
  });

  if (!transfer) {
    throw new Error("TRANSFER_NOT_FOUND");
  }

  if (transfer.status === "RECEIVED") {
    throw new Error("TRANSFER_ALREADY_RECEIVED");
  }

  if (transfer.status === "CANCELLED") {
    throw new Error("TRANSFER_ALREADY_CANCELLED");
  }

  const wasShipped = transfer.status === "IN_TRANSIT";
  // Called back to a main store: it goes back into the branch's share.
  const fromMain = wasShipped && (await isMainStore(prisma, transfer.fromLocationId));

  return prisma.$transaction(async (tx) => {
    if (wasShipped) {
      for (const item of transfer.items) {
        if (fromMain) await addToBranchShare(tx, transfer.toLocationId, item.productId, item.quantity);
        await tx.inventoryBalance.update({
          where: {
            locationId_productId: {
              locationId: transfer.fromLocationId,
              productId: item.productId,
            },
          },
          data: { quantity: { increment: item.quantity } },
        });

        await tx.stockMovement.create({
          data: {
            productId: item.productId,
            toLocationId: transfer.fromLocationId,
            quantity: item.quantity,
            type: "RETURN",
            referenceType: "StockTransfer",
            referenceId: transfer.id,
            createdById: viewer.userId,
            notes: reason ?? "Transfer cancelled",
          },
        });
      }
    }

    await tx.stockTransfer.update({
      where: { id },
      data: {
        status: "CANCELLED",
        ...(reason ? { notes: reason } : {}),
      },
    });

    // The originating request goes back to approved-but-unfulfilled so the
    // Owner can re-issue it from a different branch.
    await tx.stockRequest.updateMany({
      where: {
        OR: [{ shipmentId: id }, ...(transfer.requestId ? [{ id: transfer.requestId }] : [])],
      },
      data: { status: "PENDING", reviewedAt: null, shipmentId: null },
    });

    return tx.stockTransfer.findUnique({
      where: { id },
      select: transferDetail,
    });
  });
}

/**
 * The Owner moves stock from one branch to another without a request: the
 * goods leave the source now, with the driver named, and reach the other
 * branch when its supervisor presses Received.
 */
export async function createTransfer(
  data: {
    fromLocationId: string;
    toLocationId: string;
    items: { productId: string; quantity: number }[];
    driverName: string;
    driverPhone: string;
    vehiclePlate: string;
    notes?: string;
    directSend?: boolean;
  },
  viewer: Viewer,
) {
  if (data.fromLocationId === data.toLocationId) {
    throw new Error("SAME_BRANCH");
  }

  const branches = await prisma.stockLocation.findMany({
    where: { id: { in: [data.fromLocationId, data.toLocationId] }, isActive: true },
    select: { id: true },
  });
  if (branches.length !== 2) throw new Error("BRANCH_NOT_FOUND");

  // One line per product, quantities added together.
  const merged = new Map<string, number>();
  for (const item of data.items) {
    merged.set(item.productId, (merged.get(item.productId) ?? 0) + item.quantity);
  }
  const items = [...merged].map(([productId, quantity]) => ({ productId, quantity }));

  return prisma.$transaction(async (tx) => {
    const transfer = await tx.stockTransfer.create({
      data: {
        fromLocationId: data.fromLocationId,
        toLocationId: data.toLocationId,
        directSend: data.directSend ?? false,
        status: "IN_TRANSIT",
        deliveredById: viewer.userId,
        shippedAt: new Date(),
        notes: data.notes?.trim() || null,
        driverName: data.driverName,
        driverPhone: data.driverPhone,
        vehiclePlate: data.vehiclePlate,
        items: { create: items },
      },
    });

    await sendOut(tx, transfer.id, data.fromLocationId, data.toLocationId, items, viewer.userId);

    return tx.stockTransfer.findUnique({
      where: { id: transfer.id },
      select: transferDetail,
    });
  });
}

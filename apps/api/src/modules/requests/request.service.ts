import { Prisma } from "database";

import { prisma } from "../../plugins/prisma.js";
import type { Viewer } from "../../middleware/auth.js";
import type {
  ApproveRequestInput,
  CreateRequestInput,
  ListRequestsQuery,
} from "./request.schema.js";
import { isMainStore, sendableStock, takeFromBranchShare } from "../inventory/branchStock.js";

const requestDetail = {
  id: true,
  kind: true,
  status: true,
  notes: true,
  leftOnHand: true,
  rejectionReason: true,
  submittedAt: true,
  reviewedAt: true,
  fulfilledAt: true,
  receivedAt: true,
  receivedBy: { select: { id: true, name: true } },
  createdAt: true,

  requestedBy: {
    select: {
      id: true,
      name: true,
      role: true,
      branch: { select: { id: true, name: true } },
    },
  },

  requestedTo: {
    select: { id: true, name: true, role: true, branch: { select: { id: true, name: true } } },
  },

  approvedBy: {
    select: { id: true, name: true, role: true },
  },

  items: {
    select: {
      id: true,
      quantity: true,
      approvedQuantity: true,
      receivedAt: true,
      iccidFrom: true,
      iccidTo: true,
      product: {
        select: {
          id: true,
          sku: true,
          name: true,
          category: true,
          // The Owner's category: a request is decided one category at a time.
          productCategory: { select: { id: true, name: true } },
        },
      },
    },
  },

  transfer: {
    select: {
      id: true,
      status: true,
      shippedAt: true,
      receivedAt: true,
      driverName: true,
      driverPhone: true,
      vehiclePlate: true,
      fromLocation: { select: { id: true, name: true } },
      toLocation: { select: { id: true, name: true } },
    },
  },
};

/**
 * Raises a restock request, addressed one level up.
 *
 * A supervisor asks the Owner, who ships stock in from another branch. A
 * salesperson asks their own supervisor, who is the person that actually hands
 * the stock over. The chain is the same shape at both levels, so one function
 * covers it — only who it is addressed to differs.
 */
export async function createRequest(
  data: CreateRequestInput,
  viewer: Viewer,
) {
  if (viewer.role === "OWNER") {
    throw new Error("OWNER_CANNOT_REQUEST");
  }

  if (!viewer.branchId) {
    throw new Error("NO_BRANCH");
  }

  // A salesperson's day runs on two requests: take goods out in the morning,
  // hand back what is left at night. A supervisor only ever restocks the
  // branch, so asking for anything else is a mistake worth refusing.
  const kind =
    viewer.role === "SALES" ? (data.kind ?? "ISSUE") : "RESTOCK";

  if (viewer.role === "SUPERVISOR" && data.kind && data.kind !== "RESTOCK") {
    throw new Error("KIND_NOT_ALLOWED");
  }

  if (viewer.role === "SALES" && kind === "RESTOCK") {
    throw new Error("KIND_NOT_ALLOWED");
  }

  // Nobody can hand back more than they took: the count is checked again
  // when the supervisor approves, but refusing it here says so at once.
  if (kind === "RETURN") {
    const held = await prisma.salespersonHolding.findMany({
      where: { userId: viewer.userId },
      select: { productId: true, quantity: true },
    });

    const holding = new Map(held.map((row) => [row.productId, row.quantity]));

    for (const item of data.items) {
      if (item.quantity > (holding.get(item.productId) ?? 0)) {
        throw new Error("MORE_THAN_HELD");
      }
    }

  }

  // A supervisor may ask another branch directly: the request goes to that
  // branch's supervisors, who send the goods themselves.
  const fromBranchId =
    viewer.role === "SUPERVISOR" && data.fromBranchId ? data.fromBranchId : null;
  if (fromBranchId === viewer.branchId) throw new Error("SAME_BRANCH");

  const addressee = fromBranchId
    ? await prisma.user.findFirst({
        where: { role: "SUPERVISOR", isActive: true, branchId: fromBranchId, branch: { isActive: true } },
        select: { id: true },
        orderBy: { createdAt: "asc" },
      })
    : viewer.role === "SALES"
      ? await prisma.user.findFirst({
          where: {
            role: "SUPERVISOR",
            isActive: true,
            branchId: viewer.branchId,
          },
          select: { id: true },
        })
      : await prisma.user.findFirst({
          where: { role: "OWNER", isActive: true },
          select: { id: true },
        });

  if (!addressee) {
    throw new Error(
      fromBranchId
        ? "NO_SOURCE_SUPERVISOR"
        : viewer.role === "SALES"
          ? "NO_BRANCH_SUPERVISOR"
          : "NO_ACTIVE_OWNER",
    );
  }

  const productIds = data.items.map((item) => item.productId);

  const products = await prisma.product.findMany({
    where: { id: { in: productIds }, status: "ACTIVE" },
    select: { id: true, category: true, categoryId: true },
  });

  if (products.length !== new Set(productIds).size) {
    throw new Error("INVALID_PRODUCT");
  }

  // Every request arrives whole: all its items, every category, in one list,
  // approved from one page (the Owner's Approve & send for a restock, the
  // supervisor's Approve for a salesperson's issue or return). Returned as a
  // list so callers made for split requests keep working.
  const request = await prisma.stockRequest.create({
    data: {
      kind,
      requestedById: viewer.userId,
      requestedToId: addressee.id,
      status: "PENDING",
      notes: data.notes ?? null,
      leftOnHand:
        kind === "RETURN" && data.leftOnHand != null
          ? new Prisma.Decimal(data.leftOnHand)
          : null,
      items: {
        create: data.items.map((item) => ({
          productId: item.productId,
          quantity: item.quantity,
        })),
      },
    },
    select: requestDetail,
  });

  return [request];
}

/**
 * Branches a supervisor can ask for stock: every other active branch with an
 * active supervisor to send it. Names only.
 */
export async function requestSources(viewer: Viewer) {
  return prisma.stockLocation.findMany({
    where: {
      isActive: true,
      id: { not: viewer.branchId ?? "__none__" },
      users: { some: { role: "SUPERVISOR", isActive: true } },
    },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });
}

/**
 * The requester corrects a request that nobody has decided yet: its items
 * and note. Once any item is approved or rejected it is fixed.
 */
export async function updateRequest(id: string, data: CreateRequestInput, viewer: Viewer) {
  const existing = await prisma.stockRequest.findUnique({
    where: { id },
    select: { id: true, kind: true, status: true, requestedById: true, items: { select: { approvedQuantity: true } } },
  });
  if (!existing) throw new Error("REQUEST_NOT_FOUND");
  if (existing.requestedById !== viewer.userId) throw new Error("NOT_YOUR_REQUEST");
  if (existing.status !== "PENDING" || existing.items.some((item) => item.approvedQuantity !== null)) {
    throw new Error("REQUEST_ALREADY_DECIDED");
  }

  if (existing.kind === "RETURN") {
    const held = await prisma.salespersonHolding.findMany({
      where: { userId: viewer.userId },
      select: { productId: true, quantity: true },
    });
    const holding = new Map(held.map((row) => [row.productId, row.quantity]));
    for (const item of data.items) {
      if (item.quantity > (holding.get(item.productId) ?? 0)) throw new Error("MORE_THAN_HELD");
    }
  }

  const productIds = data.items.map((item) => item.productId);
  const products = await prisma.product.findMany({
    where: { id: { in: productIds }, status: "ACTIVE" },
    select: { id: true },
  });
  if (products.length !== new Set(productIds).size) throw new Error("INVALID_PRODUCT");

  return prisma.$transaction(async (tx) => {
    await tx.stockRequestItem.deleteMany({ where: { requestId: id } });
    return tx.stockRequest.update({
      where: { id },
      data: {
        notes: data.notes ?? null,
        leftOnHand:
          existing.kind === "RETURN" && data.leftOnHand != null
            ? new Prisma.Decimal(data.leftOnHand)
            : null,
        items: { create: data.items.map((item) => ({ productId: item.productId, quantity: item.quantity })) },
      },
      select: requestDetail,
    });
  });
}

// The Owner sees every request. A supervisor sees only the requests raised
// from their own branch.
/**
 * Whether the viewer may decide a request: the person it was sent to, or for
 * a salesperson's request any supervisor of that branch (a branch can have
 * more than one).
 */
async function decides(requestId: string, viewer: Viewer) {
  const row = await prisma.stockRequest.findUnique({
    where: { id: requestId },
    select: {
      requestedToId: true,
      requestedTo: { select: { role: true, branchId: true } },
      requestedBy: { select: { role: true, branchId: true } },
    },
  });
  if (!row) return false;
  if (row.requestedToId === viewer.userId) return true;
  if (viewer.role !== "SUPERVISOR" || viewer.branchId == null) return false;
  // Another branch's supervisor asked this branch: any of its supervisors answers.
  if (
    row.requestedBy.role === "SUPERVISOR" &&
    row.requestedTo.role === "SUPERVISOR" &&
    row.requestedTo.branchId === viewer.branchId
  ) {
    return true;
  }
  return (
    row.requestedBy.role === "SALES" &&
    row.requestedBy.branchId != null &&
    row.requestedBy.branchId === viewer.branchId
  );
}

export async function getRequests(
  query: ListRequestsQuery,
  viewer: Viewer,
) {
  // A salesperson sees the requests they raised — their own morning issues and
  // evening returns — not their colleagues'. A supervisor sees the whole
  // branch, the Owner every branch.
  const scope =
    viewer.role === "OWNER"
      ? query.branchId
        ? { requestedBy: { branchId: query.branchId } }
        : {}
      : viewer.role === "SALES"
        ? { requestedById: viewer.userId }
        : {
            OR: [
              { requestedBy: { branchId: viewer.branchId } },
              // Other branches asking this one for stock.
              { requestedBy: { role: "SUPERVISOR" as const }, requestedTo: { role: "SUPERVISOR" as const, branchId: viewer.branchId } },
            ],
          };

  return prisma.stockRequest.findMany({
    where: {
      ...scope,
      ...(query.kind ? { kind: query.kind } : {}),
      ...(query.status ? { status: query.status } : {}),
    },
    select: requestDetail,
    orderBy: { createdAt: "desc" },
  });
}

export async function getRequestById(
  id: string,
  viewer: Viewer,
) {
  const request = await prisma.stockRequest.findUnique({
    where: { id },
    select: requestDetail,
  });

  if (!request) {
    return null;
  }

  // Report another branch's request as missing rather than forbidden. A
  // salesperson may only open their own.
  const askedOfThisBranch =
    request.requestedBy.role === "SUPERVISOR" &&
    request.requestedTo.role === "SUPERVISOR" &&
    request.requestedTo.branch?.id === viewer.branchId;
  if (
    viewer.role !== "OWNER" &&
    request.requestedBy.branch?.id !== viewer.branchId &&
    !askedOfThisBranch
  ) {
    return null;
  }

  if (
    viewer.role === "SALES" &&
    request.requestedBy.id !== viewer.userId
  ) {
    return null;
  }

  return request;
}

// Approving creates the shipment. Stock does not move yet: it leaves the
// source when the transfer ships, and arrives when the supervisor confirms
// receipt.
export async function approveRequest(
  id: string,
  data: ApproveRequestInput,
  viewer: Viewer,
) {
  const request = await prisma.stockRequest.findUnique({
    where: { id },
    include: {
      items: true,
      requestedBy: { select: { branchId: true, role: true } },
    },
  });

  if (!request) {
    throw new Error("REQUEST_NOT_FOUND");
  }

  if (request.status !== "PENDING") {
    throw new Error("REQUEST_NOT_PENDING");
  }

  // Only the person the request was addressed to may decide it. Without this
  // a supervisor could approve another branch's request, or one meant for the
  // Owner — the route guard alone cannot tell those apart.
  if (!(await decides(request.id, viewer))) {
    throw new Error("NOT_THE_ADDRESSEE");
  }

  // Items already decided one by one are shipped as decided.
  const decidedOneByOne = request.items.some((item) => item.approvedQuantity !== null);
  const undecided = request.items.filter((item) => item.approvedQuantity === null);

  if (decidedOneByOne && request.requestedBy.role !== "SALES" && undecided.length > 0) {
    throw new Error("DECIDE_EACH_ITEM");
  }

  // A salesperson's request is approved whole, from one page. Lines decided
  // earlier, one by one, already took effect, so only the rest are settled
  // here; the rest may all be refused when something was approved before.
  const approved =
    request.requestedBy.role === "SALES"
      ? resolveApprovedQuantities(
          undecided,
          data.items?.filter((line) => undecided.some((item) => item.id === line.itemId)),
          request.items.some((item) => (item.approvedQuantity ?? 0) > 0),
        )
      : decidedOneByOne
        ? new Map(request.items.map((item) => [item.id, item.approvedQuantity ?? 0]))
        : resolveApprovedQuantities(request.items, data.items);

  // Lines approved at 0 are declined: they are recorded on the request but
  // nothing ships for them.
  const shipping = request.items
    .filter((item) => approved.has(item.id))
    .map((item) => ({
      productId: item.productId,
      quantity: approved.get(item.id) ?? 0,
    }))
    .filter((line) => line.quantity > 0);

  // A salesperson's request is answered inside their own branch: the
  // supervisor hands the goods over or takes them back. Nothing moves between
  // locations, so there is no transfer — what changes is who is answerable.
  if (request.requestedBy.role === "SALES") {
    const branchId = request.requestedBy.branchId;

    if (!branchId) {
      throw new Error("NO_BRANCH");
    }

    if (request.kind === "ISSUE") {
      await assertBranchCanIssue(branchId, shipping);
    }

    return prisma.$transaction(async (tx) => {
      await recordApprovedQuantities(tx, approved);

      // The ICCID range of SIM cards handed over, where the supervisor gave one.
      for (const line of data.items ?? []) {
        if (!approved.has(line.itemId) || (!line.iccidFrom && !line.iccidTo)) continue;
        await tx.stockRequestItem.update({
          where: { id: line.itemId },
          data: { iccidFrom: line.iccidFrom || null, iccidTo: line.iccidTo || null },
        });
      }

      for (const line of shipping) {
        if (request.kind === "RETURN") {
          // Approving fewer than were handed back leaves the difference in
          // the salesperson's hands: they are still answerable for it.
          await receiveReturn(tx, {
            requestId: request.id,
            branchId,
            salespersonId: request.requestedById,
            productId: line.productId,
            quantity: line.quantity,
            userId: viewer.userId,
          });
          continue;
        }

        // An issue is not theirs yet: it is credited when the salesperson
        // presses Received (receiveIssue), so who took what is on record.
      }

      return tx.stockRequest.update({
        where: { id },
        data: {
          status: "APPROVED",
          approvedById: viewer.userId,
          reviewedAt: new Date(),
        },
        select: requestDetail,
      });
    });
  }

  const destinationId = request.requestedBy.branchId;

  if (!destinationId) {
    throw new Error("NO_BRANCH");
  }

  // A supervisor answering another branch sends from their own branch,
  // whatever the form said.
  if (viewer.role === "SUPERVISOR") {
    data = { ...data, sourceBranchId: viewer.branchId ?? undefined };
  }

  // Only a supervisor's request moves stock between branches, so only that
  // path needs a source named.
  if (!data.sourceBranchId) {
    throw new Error("SOURCE_REQUIRED");
  }

  // The goods travel by road, so the branch expecting them is told who is
  // bringing them before the van leaves.
  if (!data.driverName || !data.driverPhone || !data.vehiclePlate) {
    throw new Error("DRIVER_REQUIRED");
  }

  const sourceBranchId = data.sourceBranchId;

  if (destinationId === sourceBranchId) {
    throw new Error("SAME_BRANCH");
  }

  const source = await prisma.stockLocation.findUnique({
    where: { id: sourceBranchId },
    select: { id: true, isActive: true },
  });

  if (!source) {
    throw new Error("SOURCE_NOT_FOUND");
  }

  if (!source.isActive) {
    throw new Error("SOURCE_INACTIVE");
  }

  // Refuse to promise stock the source branch does not have. Checked against
  // what is being approved, so approving less is how the Owner answers a
  // request the source cannot fully cover.
  const available = await sendableStock(
    sourceBranchId,
    destinationId,
    shipping.map((line) => line.productId),
  );

  const shortages = shipping
    .filter(
      (line) => (available.get(line.productId) ?? 0) < line.quantity,
    )
    .map((line) => ({
      productId: line.productId,
      requested: line.quantity,
      available: available.get(line.productId) ?? 0,
    }));

  if (shortages.length > 0) {
    const error = new Error("INSUFFICIENT_SOURCE_STOCK");
    Object.assign(error, { shortages });
    throw error;
  }

  return prisma.$transaction(async (tx) => {
    await recordApprovedQuantities(tx, approved);

    await tx.stockRequest.update({
      where: { id },
      data: {
        status: "APPROVED",
        approvedById: viewer.userId,
        reviewedAt: new Date(),
      },
    });

    // Approving is sending: the driver leaves with the goods now. They come
    // off the source branch here and reach the requesting branch only when
    // its supervisor presses Received.
    const transfer = await tx.stockTransfer.create({
      data: {
        requestId: id,
        fromLocationId: sourceBranchId,
        toLocationId: destinationId,
        status: "IN_TRANSIT",
        deliveredById: viewer.userId,
        shippedAt: new Date(),
        notes: data.notes ?? null,

        driverName: data.driverName,
        driverPhone: data.driverPhone,
        vehiclePlate: data.vehiclePlate,

        items: { create: shipping },
      },
    });

    await sendOut(tx, transfer.id, sourceBranchId, destinationId, shipping, viewer.userId);
    await tx.stockRequest.update({ where: { id }, data: { shipmentId: transfer.id } });

    return tx.stockRequest.findUnique({
      where: { id },
      select: requestDetail,
    });
  });
}

/**
 * The Owner approves a supervisor's restock: how many of each item go, from
 * none up to what was asked. Nothing moves yet; the request waits, approved,
 * to be sent. Can be changed again until it is sent.
 */
export async function approveQuantities(
  id: string,
  items: { itemId: string; approvedQuantity: number }[],
  viewer: Viewer,
) {
  const request = await prisma.stockRequest.findUnique({
    where: { id },
    include: { items: true, requestedBy: { select: { role: true } } },
  });

  if (!request) throw new Error("REQUEST_NOT_FOUND");
  if (request.status !== "PENDING") throw new Error("REQUEST_NOT_PENDING");
  if (request.requestedToId !== viewer.userId) throw new Error("NOT_THE_ADDRESSEE");
  if (request.requestedBy.role === "SALES") throw new Error("KIND_NOT_ALLOWED");

  const given = new Map(items.map((item) => [item.itemId, item.approvedQuantity]));
  for (const itemId of given.keys()) {
    if (!request.items.some((item) => item.id === itemId)) throw new Error("ITEM_NOT_FOUND");
  }

  // A line left out goes in full.
  const decided = request.items.map((item) => {
    const quantity = given.get(item.id) ?? item.quantity;
    if (!Number.isInteger(quantity) || quantity < 0 || quantity > item.quantity) {
      throw new Error("INVALID_APPROVED_QUANTITY");
    }
    return { id: item.id, quantity };
  });
  if (!decided.some((item) => item.quantity > 0)) throw new Error("NOTHING_APPROVED");

  return prisma.$transaction(async (tx) => {
    for (const item of decided) {
      await tx.stockRequestItem.update({ where: { id: item.id }, data: { approvedQuantity: item.quantity } });
    }
    return tx.stockRequest.findUnique({ where: { id }, select: requestDetail });
  });
}

/**
 * One car for a branch: several of its restock requests (one per category),
 * every item already decided, go out together as a single shipment with one
 * driver, and the supervisor receives them all at once.
 */
export async function shipRequests(
  requestIds: string[],
  data: {
    sourceBranchId: string;
    driverName: string;
    driverPhone: string;
    vehiclePlate: string;
    notes?: string;
  },
  viewer: Viewer,
) {
  const ids = [...new Set(requestIds)];
  const requests = await prisma.stockRequest.findMany({
    where: { id: { in: ids } },
    include: { items: true, requestedBy: { select: { branchId: true, role: true } } },
  });
  if (requests.length !== ids.length || ids.length === 0) throw new Error("REQUEST_NOT_FOUND");

  for (const request of requests) {
    if (request.status !== "PENDING") throw new Error("REQUEST_NOT_PENDING");
    if (request.requestedToId !== viewer.userId) throw new Error("NOT_THE_ADDRESSEE");
    if (request.requestedBy.role === "SALES") throw new Error("KIND_NOT_ALLOWED");
    if (request.items.some((item) => item.approvedQuantity === null)) throw new Error("DECIDE_EACH_ITEM");
  }

  // One car goes to one branch.
  const destinations = new Set(requests.map((request) => request.requestedBy.branchId));
  if (destinations.size !== 1) throw new Error("ONE_BRANCH_PER_CAR");
  const destinationId = [...destinations][0];
  if (!destinationId) throw new Error("NO_BRANCH");
  if (destinationId === data.sourceBranchId) throw new Error("SAME_BRANCH");

  const source = await prisma.stockLocation.findUnique({
    where: { id: data.sourceBranchId },
    select: { id: true, isActive: true },
  });
  if (!source) throw new Error("SOURCE_NOT_FOUND");
  if (!source.isActive) throw new Error("SOURCE_INACTIVE");

  // Everything approved, added up per product: what goes in the car.
  const totals = new Map<string, number>();
  for (const request of requests) {
    for (const item of request.items) {
      const quantity = item.approvedQuantity ?? 0;
      if (quantity > 0) totals.set(item.productId, (totals.get(item.productId) ?? 0) + quantity);
    }
  }
  const shipping = [...totals.entries()].map(([productId, quantity]) => ({ productId, quantity }));
  if (shipping.length === 0) throw new Error("NOTHING_APPROVED");

  const available = await sendableStock(data.sourceBranchId, destinationId, shipping.map((line) => line.productId));
  const shortages = shipping
    .filter((line) => (available.get(line.productId) ?? 0) < line.quantity)
    .map((line) => ({ productId: line.productId, requested: line.quantity, available: available.get(line.productId) ?? 0 }));
  if (shortages.length > 0) {
    const error = new Error("INSUFFICIENT_SOURCE_STOCK");
    Object.assign(error, { shortages });
    throw error;
  }

  return prisma.$transaction(async (tx) => {
    // Claimed first, so a double tap cannot send the same requests twice.
    const { count } = await tx.stockRequest.updateMany({
      where: { id: { in: ids }, status: "PENDING" },
      data: { status: "APPROVED", approvedById: viewer.userId, reviewedAt: new Date() },
    });
    if (count !== ids.length) throw new Error("REQUEST_NOT_PENDING");

    const transfer = await tx.stockTransfer.create({
      data: {
        // The first request stands for the shipment where one is shown;
        // every request in it is linked through shipmentId.
        requestId: ids[0],
        fromLocationId: data.sourceBranchId,
        toLocationId: destinationId,
        status: "IN_TRANSIT",
        deliveredById: viewer.userId,
        shippedAt: new Date(),
        notes: data.notes ?? null,
        driverName: data.driverName,
        driverPhone: data.driverPhone,
        vehiclePlate: data.vehiclePlate,
        items: { create: shipping },
      },
    });

    await sendOut(tx, transfer.id, data.sourceBranchId, destinationId, shipping, viewer.userId);
    await tx.stockRequest.updateMany({ where: { id: { in: ids } }, data: { shipmentId: transfer.id } });

    return { transferId: transfer.id, requests: ids.length, lines: shipping.length };
  });
}

/**
 * Takes shipped goods off the source branch and records the movement. The
 * decrement only succeeds while the shelf still holds enough, so stock sold in
 * the meantime cannot drive the source below zero.
 */
export async function sendOut(
  tx: Prisma.TransactionClient,
  transferId: string,
  fromLocationId: string,
  toLocationId: string,
  lines: { productId: string; quantity: number }[],
  userId: string,
) {
  // From a main store, each line comes out of the receiving branch's share.
  const fromMain = await isMainStore(tx, fromLocationId);

  for (const line of lines) {
    if (fromMain) await takeFromBranchShare(tx, toLocationId, line.productId, line.quantity);

    // What the branch's salespeople hold stays behind: only the shelf ships.
    const held = await tx.salespersonHolding.aggregate({
      where: { productId: line.productId, user: { branchId: fromLocationId } },
      _sum: { quantity: true },
    });

    const { count } = await tx.inventoryBalance.updateMany({
      where: {
        locationId: fromLocationId,
        productId: line.productId,
        quantity: { gte: line.quantity + (held._sum.quantity ?? 0) },
      },
      data: { quantity: { decrement: line.quantity } },
    });

    if (count === 0) throw new Error("INSUFFICIENT_SOURCE_STOCK");

    await tx.stockMovement.create({
      data: {
        productId: line.productId,
        fromLocationId,
        toLocationId,
        quantity: line.quantity,
        type: "TRANSFER",
        referenceType: "StockTransfer",
        referenceId: transferId,
        createdById: userId,
        notes: "Sent",
      },
    });
  }
}

/**
 * What a branch can send away: its balance less what its salespeople hold.
 * Issued goods stay in the balance until sold, so without this a transfer
 * could take the packets a seller is standing at the counter with.
 */
export async function shelfStock(locationId: string, productIds: string[]) {
  const [balances, holdings, handingOver] = await Promise.all([
    prisma.inventoryBalance.findMany({
      where: { locationId, productId: { in: productIds } },
      select: { productId: true, quantity: true },
    }),
    prisma.salespersonHolding.groupBy({
      by: ["productId"],
      where: { productId: { in: productIds }, user: { branchId: locationId } },
      _sum: { quantity: true },
    }),
    // Approved for a salesperson but not yet received: already promised, so
    // it cannot be issued to someone else meanwhile.
    prisma.stockRequestItem.groupBy({
      by: ["productId"],
      where: {
        productId: { in: productIds },
        approvedQuantity: { gt: 0 },
        receivedAt: null,
        request: {
          kind: "ISSUE",
          status: { in: ["PENDING", "APPROVED"] },
          requestedBy: { role: "SALES", branchId: locationId },
        },
      },
      _sum: { approvedQuantity: true },
    }),
  ]);

  const held = new Map(holdings.map((row) => [row.productId, row._sum.quantity ?? 0]));
  for (const row of handingOver) {
    held.set(row.productId, (held.get(row.productId) ?? 0) + (row._sum.approvedQuantity ?? 0));
  }

  return new Map(
    balances.map((b) => [b.productId, Math.max(0, b.quantity - (held.get(b.productId) ?? 0))]),
  );
}

/**
 * Refuses to hand out goods the branch does not have to hand out.
 *
 * Issued goods stay on the branch's shelves — selling happens at the office —
 * so what limits an issue is not the balance alone but the balance less what
 * the branch's sellers are already answerable for. Without this, two
 * people could each be issued the last packet.
 */
async function assertBranchCanIssue(
  branchId: string,
  lines: { productId: string; quantity: number }[],
) {
  if (lines.length === 0) return;

  // Everything already issued counts, the requester's own share included:
  // what they hold now is added to, not replaced.
  const onShelf = await shelfStock(
    branchId,
    lines.map((line) => line.productId),
  );

  const shortages = lines
    .map((line) => ({
      productId: line.productId,
      requested: line.quantity,
      available: onShelf.get(line.productId) ?? 0,
    }))
    .filter((line) => line.available < line.requested);

  if (shortages.length > 0) {
    const error = new Error("INSUFFICIENT_BRANCH_STOCK");
    Object.assign(error, { shortages });
    throw error;
  }
}

/**
 * Works out how much of each line is approved, keyed by request item id.
 *
 * Lines the reviewer did not mention are approved in full. Every figure must
 * sit between 0 and what was asked for — approving more than was requested
 * would ship stock nobody asked for — and at least one unit must be approved,
 * since approving nothing is a rejection and should carry a reason.
 */
function resolveApprovedQuantities(
  items: { id: string; quantity: number }[],
  decisions: ApproveRequestInput["items"],
  /** Something was approved before, so these may all be refused. */
  noneIsFine = false,
) {
  const requestedById = new Map(
    items.map((item) => [item.id, item.quantity]),
  );
  const approved = new Map(requestedById);
  const seen = new Set<string>();

  for (const decision of decisions ?? []) {
    const requested = requestedById.get(decision.itemId);

    if (requested === undefined || seen.has(decision.itemId)) {
      throw new Error("UNKNOWN_REQUEST_ITEM");
    }

    if (decision.approvedQuantity > requested) {
      throw new Error("APPROVED_EXCEEDS_REQUESTED");
    }

    seen.add(decision.itemId);
    approved.set(decision.itemId, decision.approvedQuantity);
  }

  const total = [...approved.values()].reduce((sum, qty) => sum + qty, 0);

  if (total === 0 && !noneIsFine) {
    throw new Error("NOTHING_APPROVED");
  }

  return approved;
}

async function recordApprovedQuantities(
  tx: Prisma.TransactionClient,
  approved: Map<string, number>,
) {
  for (const [itemId, approvedQuantity] of approved) {
    await tx.stockRequestItem.update({
      where: { id: itemId },
      data: { approvedQuantity },
    });
  }
}

/**
 * A salesperson's return is counted back into their branch's available shelf.
 *
 * Branch balance is meant to include what sellers hold. Older data can drift
 * below that; when it does, the shortfall is topped up first so counting in a
 * return always increases what the branch can issue again.
 */
async function receiveReturn(
  tx: Prisma.TransactionClient,
  {
    requestId,
    branchId,
    salespersonId,
    productId,
    quantity,
    userId,
  }: {
    requestId: string;
    branchId: string;
    salespersonId: string;
    productId: string;
    quantity: number;
    userId: string;
  },
) {
  if (quantity <= 0) return;

  const holding = await tx.salespersonHolding.findUnique({
    where: { userId_productId: { userId: salespersonId, productId } },
    select: { quantity: true },
  });
  if ((holding?.quantity ?? 0) < quantity) throw new Error("MORE_THAN_HELD");

  const balance = await tx.inventoryBalance.findUnique({
    where: {
      locationId_productId: { locationId: branchId, productId },
    },
    select: { quantity: true },
  });
  const shortfall = Math.max(0, (holding?.quantity ?? 0) - (balance?.quantity ?? 0));
  if (shortfall > 0) {
    await tx.inventoryBalance.upsert({
      where: {
        locationId_productId: { locationId: branchId, productId },
      },
      create: { locationId: branchId, productId, quantity: shortfall },
      update: { quantity: { increment: shortfall } },
    });
  }

  await tx.salespersonHolding.update({
    where: { userId_productId: { userId: salespersonId, productId } },
    data: { quantity: { decrement: quantity } },
  });

  await tx.stockMovement.create({
    data: {
      productId,
      toLocationId: branchId,
      quantity,
      type: "RETURN",
      referenceType: "StockRequest",
      referenceId: requestId,
      createdById: userId,
      notes: "Counted back in",
    },
  });
}

/**
 * A request is decided one category at a time (SIM cards, phones, airtime):
 * every line of that category is approved in full, or all are refused.
 *
 * A salesperson's request is settled as it goes — each approved line is handed
 * over (or taken back) at once — and reads Approved or Rejected when the last
 * line is decided. A supervisor's restock ships as one transfer, so its lines
 * are only recorded here; once all are decided the Owner sends the approved
 * ones with approveRequest. If every line was refused, it reads Rejected.
 */
export async function decideRequestItems(
  id: string,
  itemIds: string[],
  approve: boolean,
  viewer: Viewer,
) {
  const request = await prisma.stockRequest.findUnique({
    where: { id },
    include: {
      items: true,
      requestedBy: { select: { branchId: true, role: true } },
    },
  });

  if (!request) throw new Error("REQUEST_NOT_FOUND");
  if (request.status !== "PENDING") throw new Error("REQUEST_NOT_PENDING");
  if (!(await decides(request.id, viewer))) throw new Error("NOT_THE_ADDRESSEE");

  const bySales = request.requestedBy.role === "SALES";

  const ids = [...new Set(itemIds)];
  const chosen = request.items.filter((row) => ids.includes(row.id));
  if (chosen.length !== ids.length || chosen.length === 0) throw new Error("ITEM_NOT_FOUND");
  if (chosen.some((row) => row.approvedQuantity !== null)) throw new Error("ITEM_ALREADY_DECIDED");

  const branchId = request.requestedBy.branchId;
  if (!branchId) throw new Error("NO_BRANCH");

  if (bySales && approve && request.kind === "ISSUE") {
    await assertBranchCanIssue(
      branchId,
      chosen.map((row) => ({ productId: row.productId, quantity: row.quantity })),
    );
  }

  return prisma.$transaction(async (tx) => {
    // Claimed first, so a double tap cannot hand the goods over twice.
    for (const item of chosen) {
      const { count } = await tx.stockRequestItem.updateMany({
        where: { id: item.id, approvedQuantity: null },
        data: { approvedQuantity: approve ? item.quantity : 0 },
      });
      if (count === 0) throw new Error("ITEM_ALREADY_DECIDED");

      if (!bySales || !approve) {
        // A restock moves nothing until its approved lines are sent; a
        // refused line moves nothing at all.
      } else if (request.kind === "RETURN") {
        await receiveReturn(tx, {
          requestId: request.id,
          branchId,
          salespersonId: request.requestedById,
          productId: item.productId,
          quantity: item.quantity,
          userId: viewer.userId,
        });
      } else {
        // An issue waits for the salesperson's Received (receiveIssue).
      }
    }

    const lines = await tx.stockRequestItem.findMany({
      where: { requestId: id },
      select: { approvedQuantity: true },
    });

    const open = lines.some((line) => line.approvedQuantity === null);
    const anyApproved = lines.some((line) => (line.approvedQuantity ?? 0) > 0);

    // A restock with something approved waits, still pending, to be sent.
    await tx.stockRequest.update({
      where: { id },
      data: open || (!bySales && anyApproved)
        ? {}
        : {
            status: anyApproved ? "APPROVED" : "REJECTED",
            approvedById: viewer.userId,
            reviewedAt: new Date(),
          },
    });
    // Its approved lines may all be received already.
    if (bySales) await settleReceipt(tx, id);
    return tx.stockRequest.findUnique({ where: { id }, select: requestDetail });
  });
}

/**
 * Once every approved line of a salesperson's issue is received and the
 * request is decided, the request itself counts as received.
 */
async function settleReceipt(tx: Prisma.TransactionClient, id: string) {
  const request = await tx.stockRequest.findUnique({
    where: { id },
    select: {
      kind: true,
      status: true,
      receivedAt: true,
      requestedById: true,
      items: { select: { approvedQuantity: true, receivedAt: true } },
    },
  });
  if (!request || request.kind !== "ISSUE" || request.receivedAt) return;
  if (request.status !== "APPROVED" && request.status !== "FULFILLED") return;
  const approved = request.items.filter((item) => (item.approvedQuantity ?? 0) > 0);
  if (approved.length === 0 || approved.some((item) => !item.receivedAt)) return;
  const last = approved.reduce((latest, item) => (item.receivedAt! > latest ? item.receivedAt! : latest), approved[0].receivedAt!);
  await tx.stockRequest.update({
    where: { id },
    data: { receivedAt: last, receivedById: request.requestedById },
  });
}

/**
 * The salesperson confirms the goods issued to them are in their hands. Only
 * now do they become answerable for them: each approved line not yet received
 * is added to what they hold. Lines are received as they are approved, so one
 * approved early can be sold while the rest of the request is undecided.
 */
export async function receiveIssue(id: string, viewer: Viewer) {
  const request = await prisma.stockRequest.findUnique({
    where: { id },
    include: { items: true },
  });

  if (!request) throw new Error("REQUEST_NOT_FOUND");
  if (request.requestedById !== viewer.userId) throw new Error("NOT_YOUR_ISSUE");
  if (request.kind !== "ISSUE") throw new Error("NOTHING_TO_RECEIVE");
  if (request.status !== "APPROVED" && request.status !== "PENDING") throw new Error("NOT_APPROVED_YET");

  const waiting = request.items.filter((item) => (item.approvedQuantity ?? 0) > 0 && !item.receivedAt);
  if (waiting.length === 0) {
    throw new Error(request.items.some((item) => item.receivedAt) ? "ALREADY_RECEIVED" : "NOT_APPROVED_YET");
  }

  return prisma.$transaction(async (tx) => {
    const now = new Date();
    for (const item of waiting) {
      // Claimed first, so a double tap cannot credit a line twice.
      const { count } = await tx.stockRequestItem.updateMany({
        where: { id: item.id, receivedAt: null },
        data: { receivedAt: now },
      });
      if (count === 0) continue;

      const quantity = item.approvedQuantity ?? 0;
      await tx.salespersonHolding.upsert({
        where: { userId_productId: { userId: request.requestedById, productId: item.productId } },
        create: { userId: request.requestedById, productId: item.productId, quantity },
        update: { quantity: { increment: quantity } },
      });
    }

    await settleReceipt(tx, id);
    return tx.stockRequest.findUnique({ where: { id }, select: requestDetail });
  });
}

/** Lines already decided one by one: the request can only be finished that way. */
async function hasDecidedItems(id: string) {
  const decided = await prisma.stockRequestItem.count({
    where: { requestId: id, approvedQuantity: { not: null } },
  });
  return decided > 0;
}

export async function rejectRequest(
  id: string,
  rejectionReason: string,
  viewer: Viewer,
) {
  const request = await prisma.stockRequest.findUnique({
    where: { id },
    select: { id: true, status: true, requestedToId: true },
  });

  if (!request) {
    throw new Error("REQUEST_NOT_FOUND");
  }

  if (request.status !== "PENDING") {
    throw new Error("REQUEST_NOT_PENDING");
  }

  if (!(await decides(request.id, viewer))) {
    throw new Error("NOT_THE_ADDRESSEE");
  }

  if (await hasDecidedItems(id)) {
    throw new Error("PARTLY_DECIDED");
  }

  return prisma.stockRequest.update({
    where: { id },
    data: {
      status: "REJECTED",
      rejectionReason,
      approvedById: viewer.userId,
      reviewedAt: new Date(),
    },
    select: requestDetail,
  });
}

// A supervisor may withdraw their own request while it is still pending.
export async function cancelRequest(id: string, viewer: Viewer) {
  const request = await prisma.stockRequest.findUnique({
    where: { id },
    select: { id: true, status: true, requestedById: true },
  });

  if (!request) {
    throw new Error("REQUEST_NOT_FOUND");
  }

  if (
    viewer.role !== "OWNER" &&
    request.requestedById !== viewer.userId
  ) {
    throw new Error("NOT_YOUR_REQUEST");
  }

  if (request.status !== "PENDING") {
    throw new Error("REQUEST_NOT_PENDING");
  }

  if (await hasDecidedItems(id)) {
    throw new Error("PARTLY_DECIDED");
  }

  return prisma.stockRequest.update({
    where: { id },
    data: { status: "CANCELLED", reviewedAt: new Date() },
    select: requestDetail,
  });
}

// The Owner may delete any request. Anyone else only their own, while it is
// still pending and nothing in it has been decided. Stock a request already
// moved stays where it is; its items go with it, a linked transfer is kept.
export async function deleteRequest(id: string, viewer: Viewer) {
  const request = await prisma.stockRequest.findUnique({
    where: { id },
    select: { id: true, status: true, requestedById: true },
  });

  if (!request) {
    throw new Error("REQUEST_NOT_FOUND");
  }

  if (viewer.role !== "OWNER") {
    if (request.requestedById !== viewer.userId) throw new Error("NOT_YOUR_REQUEST");
    if (request.status !== "PENDING") throw new Error("REQUEST_NOT_PENDING");
    if (await hasDecidedItems(id)) throw new Error("PARTLY_DECIDED");
  }

  await prisma.stockRequest.delete({ where: { id } });
}

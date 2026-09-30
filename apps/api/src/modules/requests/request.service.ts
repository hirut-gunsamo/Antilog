import type { Prisma } from "database";

import { prisma } from "../../plugins/prisma.js";
import type { Viewer } from "../../middleware/auth.js";
import type {
  ApproveRequestInput,
  CreateRequestInput,
  ListRequestsQuery,
} from "./request.schema.js";

const requestDetail = {
  id: true,
  kind: true,
  status: true,
  notes: true,
  rejectionReason: true,
  submittedAt: true,
  reviewedAt: true,
  fulfilledAt: true,
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
    select: { id: true, name: true, role: true },
  },

  approvedBy: {
    select: { id: true, name: true, role: true },
  },

  items: {
    select: {
      id: true,
      quantity: true,
      approvedQuantity: true,
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

  const addressee =
    viewer.role === "SALES"
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
      viewer.role === "SALES" ? "NO_BRANCH_SUPERVISOR" : "NO_ACTIVE_OWNER",
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

  // Each category arrives as a request of its own, so SIM cards, airtime and
  // phones are listed and decided separately. Grouped the same way the
  // approval screen groups them: the Owner's category, else the product kind.
  const categoryOf = new Map(
    products.map((product) => [product.id, product.categoryId ?? product.category]),
  );
  const groups = new Map<string, CreateRequestInput["items"]>();
  for (const item of data.items) {
    const key = categoryOf.get(item.productId)!;
    groups.set(key, [...(groups.get(key) ?? []), item]);
  }

  const requests = await prisma.$transaction(
    [...groups.values()].map((items) =>
      prisma.stockRequest.create({
        data: {
          kind,
          requestedById: viewer.userId,
          requestedToId: addressee.id,
          status: "PENDING",
          notes: data.notes ?? null,

          items: {
            create: items.map((item) => ({
              productId: item.productId,
              quantity: item.quantity,
            })),
          },
        },
        select: requestDetail,
      }),
    ),
  );

  return requests;
}

// The Owner sees every request. A supervisor sees only the requests raised
// from their own branch.
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
        : { requestedBy: { branchId: viewer.branchId } };

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
  if (
    viewer.role !== "OWNER" &&
    request.requestedBy.branch?.id !== viewer.branchId
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
  if (request.requestedToId !== viewer.userId) {
    throw new Error("NOT_THE_ADDRESSEE");
  }

  // Items already decided one by one are shipped as decided. A salesperson's
  // request finishes itself item by item, so only a restock gets here.
  const decidedOneByOne = request.items.some((item) => item.approvedQuantity !== null);

  if (decidedOneByOne) {
    if (request.requestedBy.role === "SALES") throw new Error("PARTLY_DECIDED");
    if (request.items.some((item) => item.approvedQuantity === null)) {
      throw new Error("DECIDE_EACH_ITEM");
    }
  }

  const approved = decidedOneByOne
    ? new Map(request.items.map((item) => [item.id, item.approvedQuantity ?? 0]))
    : resolveApprovedQuantities(request.items, data.items);

  // Lines approved at 0 are declined: they are recorded on the request but
  // nothing ships for them.
  const shipping = request.items
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

      for (const line of shipping) {
        if (request.kind === "RETURN") {
          // Approving fewer than were handed back leaves the difference in
          // the salesperson's hands: they are still answerable for it.
          const holding = await tx.salespersonHolding.findUnique({
            where: {
              userId_productId: {
                userId: request.requestedById,
                productId: line.productId,
              },
            },
            select: { quantity: true },
          });

          if ((holding?.quantity ?? 0) < line.quantity) {
            throw new Error("MORE_THAN_HELD");
          }

          await tx.salespersonHolding.update({
            where: {
              userId_productId: {
                userId: request.requestedById,
                productId: line.productId,
              },
            },
            data: { quantity: { decrement: line.quantity } },
          });

          continue;
        }

        await tx.salespersonHolding.upsert({
          where: {
            userId_productId: {
              userId: request.requestedById,
              productId: line.productId,
            },
          },
          create: {
            userId: request.requestedById,
            productId: line.productId,
            quantity: line.quantity,
          },
          update: { quantity: { increment: line.quantity } },
        });
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
  const available = await shelfStock(
    sourceBranchId,
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

    return tx.stockRequest.findUnique({
      where: { id },
      select: requestDetail,
    });
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
  for (const line of lines) {
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
  const [balances, holdings] = await Promise.all([
    prisma.inventoryBalance.findMany({
      where: { locationId, productId: { in: productIds } },
      select: { productId: true, quantity: true },
    }),
    prisma.salespersonHolding.groupBy({
      by: ["productId"],
      where: { productId: { in: productIds }, user: { branchId: locationId } },
      _sum: { quantity: true },
    }),
  ]);

  const held = new Map(holdings.map((row) => [row.productId, row._sum.quantity ?? 0]));

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

  if (total === 0) {
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
  if (request.requestedToId !== viewer.userId) throw new Error("NOT_THE_ADDRESSEE");

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

      const holdingKey = {
        userId_productId: { userId: request.requestedById, productId: item.productId },
      };

      if (!bySales || !approve) {
        // A restock moves nothing until its approved lines are sent; a
        // refused line moves nothing at all.
      } else if (request.kind === "RETURN") {
        const holding = await tx.salespersonHolding.findUnique({
          where: holdingKey,
          select: { quantity: true },
        });
        if ((holding?.quantity ?? 0) < item.quantity) throw new Error("MORE_THAN_HELD");

        await tx.salespersonHolding.update({
          where: holdingKey,
          data: { quantity: { decrement: item.quantity } },
        });
      } else {
        await tx.salespersonHolding.upsert({
          where: holdingKey,
          create: {
            userId: request.requestedById,
            productId: item.productId,
            quantity: item.quantity,
          },
          update: { quantity: { increment: item.quantity } },
        });
      }
    }

    const lines = await tx.stockRequestItem.findMany({
      where: { requestId: id },
      select: { approvedQuantity: true },
    });

    const open = lines.some((line) => line.approvedQuantity === null);
    const anyApproved = lines.some((line) => (line.approvedQuantity ?? 0) > 0);

    // A restock with something approved waits, still pending, to be sent.
    return tx.stockRequest.update({
      where: { id },
      data: open || (!bySales && anyApproved)
        ? {}
        : {
            status: anyApproved ? "APPROVED" : "REJECTED",
            approvedById: viewer.userId,
            reviewedAt: new Date(),
          },
      select: requestDetail,
    });
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

  if (request.requestedToId !== viewer.userId) {
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

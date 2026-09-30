import { Prisma } from "database";

import { prisma } from "../../plugins/prisma.js";
import type { Viewer } from "../../middleware/auth.js";
import type {
  ListLossQuery,
  RejectLossInput,
  ReportLossInput,
} from "./stockLoss.schema.js";

const INCLUDE = {
  product: {
    select: { id: true, sku: true, name: true, category: true, price: true },
  },
  location: { select: { id: true, name: true } },
  reportedBy: {
    select: {
      id: true,
      name: true,
      role: true,
      branch: { select: { id: true, name: true } },
    },
  },
  reviewedBy: { select: { id: true, name: true, role: true } },
  units: {
    select: {
      id: true,
      iccid: true,
      imei: true,
      simNumber: true,
      serialNumber: true,
    },
  },
} satisfies Prisma.StockLossReportInclude;

/**
 * Records a write-off and takes the stock out of the sellable pool.
 *
 * The deduction happens now, not on approval: a broken SIM must not be sold
 * while a supervisor gets round to reviewing it. The report stays PENDING, and
 * rejecting it puts everything back.
 */
export async function reportLoss(data: ReportLossInput, viewer: Viewer) {
  // The Owner has no branch of their own, so they must say which one they are
  // reporting against. Everyone else can only report their own.
  const locationId =
    viewer.role === "OWNER" ? data.locationId : viewer.branchId;

  if (!locationId) {
    throw new Error("NO_BRANCH");
  }

  if (viewer.role !== "OWNER" && data.locationId && data.locationId !== locationId) {
    throw new Error("FORBIDDEN_BRANCH");
  }

  const [product, location] = await Promise.all([
    prisma.product.findUnique({ where: { id: data.productId } }),
    prisma.stockLocation.findUnique({ where: { id: locationId } }),
  ]);

  if (!product || !location) {
    throw new Error("NOT_FOUND");
  }

  if (!location.isActive) {
    throw new Error("LOCATION_INACTIVE");
  }

  // Stock is a count for every category now — SIM, phone, or voucher, a
  // write-off is always a quantity. There are no unit rows left pre-sale
  // to name individually.
  const quantity = data.quantity;

  const balance = await prisma.inventoryBalance.findUnique({
    where: {
      locationId_productId: { locationId, productId: data.productId },
    },
  });

  if (!balance || balance.quantity < quantity) {
    throw new Error("INSUFFICIENT_STOCK");
  }

  return prisma.$transaction(async (tx) => {
    const report = await tx.stockLossReport.create({
      data: {
        kind: data.kind,
        productId: data.productId,
        locationId,
        quantity,
        reason: data.reason,
        reportedById: viewer.userId,
      },
    });

    await tx.inventoryBalance.update({
      where: { id: balance.id },
      data: { quantity: { decrement: quantity } },
    });

    // Recorded as an ADJUSTMENT leaving the branch, with the report as its
    // reference so the history explains itself.
    await tx.stockMovement.create({
      data: {
        productId: data.productId,
        fromLocationId: locationId,
        quantity,
        type: "ADJUSTMENT",
        referenceType: "StockLossReport",
        referenceId: report.id,
        createdById: viewer.userId,
        notes: `${data.kind === "DAMAGED" ? "Damaged" : "Lost"}: ${data.reason}`,
      },
    });

    return tx.stockLossReport.findUniqueOrThrow({
      where: { id: report.id },
      include: INCLUDE,
    });
  });
}

/**
 * Scoped exactly like every other list in the system: the Owner sees every
 * branch, a supervisor their own, and a salesperson only what they reported
 * themselves.
 */
function scopeFor(query: ListLossQuery, viewer: Viewer) {
  const where: Prisma.StockLossReportWhereInput = {};

  if (viewer.role === "OWNER") {
    if (query.locationId) where.locationId = query.locationId;
  } else if (viewer.role === "SALES") {
    where.reportedById = viewer.userId;
  } else {
    where.locationId = viewer.branchId ?? "__none__";
  }

  if (query.status) where.status = query.status;
  if (query.kind) where.kind = query.kind;

  return where;
}

export async function getLossReports(query: ListLossQuery, viewer: Viewer) {
  return prisma.stockLossReport.findMany({
    where: scopeFor(query, viewer),
    include: INCLUDE,
    orderBy: { createdAt: "desc" },
    take: 500,
  });
}

async function loadForReview(id: string, viewer: Viewer) {
  const report = await prisma.stockLossReport.findUnique({
    where: { id },
    include: { units: { select: { id: true } } },
  });

  // A report at another branch is reported as missing rather than forbidden,
  // so the response does not confirm that it exists.
  if (
    !report ||
    (viewer.role !== "OWNER" && report.locationId !== viewer.branchId)
  ) {
    throw new Error("NOT_FOUND");
  }

  if (report.status !== "PENDING") {
    throw new Error("ALREADY_REVIEWED");
  }

  // Shrinkage is the easiest stock to steal, so the person who reported it
  // never signs it off — not even a supervisor reporting their own branch.
  if (report.reportedById === viewer.userId) {
    throw new Error("SELF_REVIEW");
  }

  return report;
}

/**
 * Confirms the write-off. The stock left when the report was raised, so this
 * only records who agreed to it and when.
 */
export async function approveLoss(id: string, viewer: Viewer) {
  await loadForReview(id, viewer);

  return prisma.stockLossReport.update({
    where: { id },
    data: {
      status: "APPROVED",
      reviewedById: viewer.userId,
      reviewedAt: new Date(),
    },
    include: INCLUDE,
  });
}

/** Puts the stock back, exactly the units that were taken. */
export async function rejectLoss(
  id: string,
  data: RejectLossInput,
  viewer: Viewer,
) {
  const report = await loadForReview(id, viewer);

  return prisma.$transaction(async (tx) => {
    // Stock is a count. Unit rows exist only for items already sold, so
    // rejecting a write-off has no unit rows to restore — only the balance.
    await tx.inventoryBalance.update({
      where: {
        locationId_productId: {
          locationId: report.locationId,
          productId: report.productId,
        },
      },
      data: { quantity: { increment: report.quantity } },
    });

    // The reversal is its own movement rather than a deletion, so the history
    // shows that stock left and came back.
    await tx.stockMovement.create({
      data: {
        productId: report.productId,
        toLocationId: report.locationId,
        quantity: report.quantity,
        type: "ADJUSTMENT",
        referenceType: "StockLossReport",
        referenceId: report.id,
        createdById: viewer.userId,
        notes: `Write-off rejected: ${data.reason}`,
      },
    });

    return tx.stockLossReport.update({
      where: { id },
      data: {
        status: "REJECTED",
        rejectionReason: data.reason,
        reviewedById: viewer.userId,
        reviewedAt: new Date(),
      },
      include: INCLUDE,
    });
  });
}

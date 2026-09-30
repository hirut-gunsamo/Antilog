import { randomUUID } from "node:crypto";
import { mkdir, writeFile, unlink } from "node:fs/promises";
import path from "node:path";
import { Prisma } from "database";
import { prisma } from "../../plugins/prisma.js";
import type { Viewer } from "../../middleware/auth.js";

// Receipt images live on local disk. The database stores only a relative URL,
// so swapping in object storage later means changing this file and nothing
// else.
export const UPLOAD_ROOT = path.resolve(
  process.cwd(),
  "uploads",
  "receipts",
);

const ALLOWED_TYPES = new Map([
  ["image/jpeg", ".jpg"],
  ["image/png", ".png"],
  ["image/webp", ".webp"],
  ["application/pdf", ".pdf"],
]);

export const MAX_FILE_BYTES = 10 * 1024 * 1024;

const receiptDetail = {
  id: true,
  bankName: true,
  referenceNumber: true,
  fileUrl: true,
  amount: true,
  daySales: true,
  yadere: true,
  receiptDate: true,
  status: true,
  location: { select: { id: true, name: true } },
  notes: true,
  createdAt: true,

  uploadedBy: {
    select: {
      id: true,
      name: true,
      role: true,
      branch: { select: { id: true, name: true } },
    },
  },
  verifiedBy: { select: { id: true, name: true, role: true } },

  cashReport: {
    select: {
      id: true,
      status: true,
      periodStart: true,
      periodEnd: true,
    },
  },
};

export async function storeReceiptFile(
  filename: string,
  mimetype: string,
  bytes: Buffer,
) {
  const extension = ALLOWED_TYPES.get(mimetype);

  if (!extension) {
    throw new Error("UNSUPPORTED_FILE_TYPE");
  }

  if (bytes.length === 0) {
    throw new Error("EMPTY_FILE");
  }

  if (bytes.length > MAX_FILE_BYTES) {
    throw new Error("FILE_TOO_LARGE");
  }

  await mkdir(UPLOAD_ROOT, { recursive: true });

  // Never trust the client's filename for the path on disk.
  const storedName = `${randomUUID()}${extension}`;

  await writeFile(path.join(UPLOAD_ROOT, storedName), bytes);

  return {
    storedName,
    fileUrl: `/api/receipts/file/${storedName}`,
    originalName: filename,
  };
}

/** Local midnight to local midnight, the way the reports count a day. */
function dayRange(day: string) {
  const start = new Date(`${day.slice(0, 10)}T00:00:00`);
  if (Number.isNaN(start.getTime())) throw new Error("INVALID_DATE");

  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  return { start, end };
}

/**
 * A branch's day in money: what was left over from the days before, what it
 * sold, what has been credited to the Owner so far, and what is left over
 * now ("yadere"). Yadere carries forward: it is every sale up to the end of
 * the day less every credit up to the end of the day.
 */
export async function getDaySummary(locationId: string, day: string) {
  const { start, end } = dayRange(day);

  const sales = (range: Prisma.DateTimeFilter) =>
    prisma.sale
      .aggregate({
        where: { locationId, status: "APPROVED", saleDate: range },
        _sum: { totalAmount: true },
      })
      .then((r) => r._sum.totalAmount ?? new Prisma.Decimal(0));

  // A rejected credit never reached the account.
  const credits = (range: Prisma.DateTimeFilter) =>
    prisma.bankReceipt
      .aggregate({
        where: {
          locationId,
          status: { not: "REJECTED" },
          receiptDate: range,
        },
        _sum: { amount: true },
      })
      .then((r) => r._sum.amount ?? new Prisma.Decimal(0));

  const [salesBefore, creditsBefore, daySales, credited] = await Promise.all([
    sales({ lt: start }),
    credits({ lt: start }),
    sales({ gte: start, lt: end }),
    credits({ gte: start, lt: end }),
  ]);

  const carriedOver = salesBefore.minus(creditsBefore);

  return {
    carriedOver,
    daySales,
    credited,
    yadere: carriedOver.plus(daySales).minus(credited),
  };
}

/** The branch a viewer records money for: their own, or the Owner's pick. */
export function receiptBranch(viewer: Viewer, requested?: string) {
  const branchId = viewer.role === "OWNER" ? requested : viewer.branchId;

  if (!branchId) {
    throw new Error("BRANCH_REQUIRED");
  }

  return branchId;
}

export async function createReceipt(
  data: {
    fileUrl?: string;
    amount: number;
    locationId: string;
    receiptDate: string;
    bankName?: string;
    referenceNumber?: string;
    cashReportId?: string;
    notes?: string;
  },
  viewer: Viewer,
) {
  // Stored at local midnight so it falls inside the day it was credited for.
  const receiptDate = dayRange(data.receiptDate).start;

  if (data.cashReportId) {
    const report = await prisma.cashReport.findUnique({
      where: { id: data.cashReportId },
      select: { id: true, salespersonId: true },
    });

    if (!report) {
      throw new Error("REPORT_NOT_FOUND");
    }

    // A salesperson may only attach receipts to their own reconciliation.
    if (
      viewer.role === "SALES" &&
      report.salespersonId !== viewer.userId
    ) {
      throw new Error("NOT_YOUR_REPORT");
    }
  }

  const amount = new Prisma.Decimal(data.amount);
  const day = await getDaySummary(data.locationId, data.receiptDate);

  return prisma.bankReceipt.create({
    data: {
      uploadedById: viewer.userId,
      cashReportId: data.cashReportId ?? null,
      bankName: data.bankName || null,
      referenceNumber: data.referenceNumber || null,
      fileUrl: data.fileUrl ?? null,
      amount,
      locationId: data.locationId,
      daySales: day.daySales,
      yadere: day.yadere.minus(amount),
      receiptDate,
      status: "PENDING",
      notes: data.notes ?? null,
    },
    select: receiptDetail,
  });
}

export async function getReceipts(
  query: { status?: string; branchId?: string },
  viewer: Viewer,
) {
  let scope: Prisma.BankReceiptWhereInput = {};

  if (viewer.role === "SALES") {
    scope = { uploadedById: viewer.userId };
  } else if (viewer.role === "SUPERVISOR") {
    scope = { locationId: viewer.branchId ?? "__none__" };
  } else if (query.branchId) {
    scope = { locationId: query.branchId };
  }

  return prisma.bankReceipt.findMany({
    where: {
      ...scope,
      ...(query.status
        ? {
            status: query.status as Prisma.EnumReceiptStatusFilter["equals"],
          }
        : {}),
    },
    select: receiptDetail,
    orderBy: { receiptDate: "desc" },
  });
}

export async function getReceiptById(id: string, viewer: Viewer) {
  const receipt = await prisma.bankReceipt.findUnique({
    where: { id },
    select: receiptDetail,
  });

  if (!receipt) {
    return null;
  }

  if (
    viewer.role === "SALES" &&
    receipt.uploadedBy.id !== viewer.userId
  ) {
    return null;
  }

  if (
    viewer.role === "SUPERVISOR" &&
    receipt.location?.id !== viewer.branchId
  ) {
    return null;
  }

  return receipt;
}

export async function setReceiptStatus(
  id: string,
  status: "VERIFIED" | "REJECTED",
  notes: string | undefined,
  viewer: Viewer,
) {
  const receipt = await prisma.bankReceipt.findUnique({
    where: { id },
    select: {
      id: true,
      status: true,
      locationId: true,
    },
  });

  if (!receipt) {
    throw new Error("RECEIPT_NOT_FOUND");
  }

  if (receipt.status !== "PENDING") {
    throw new Error("RECEIPT_ALREADY_REVIEWED");
  }

  if (
    viewer.role === "SUPERVISOR" &&
    receipt.locationId !== viewer.branchId
  ) {
    throw new Error("NOT_YOUR_BRANCH");
  }

  return prisma.bankReceipt.update({
    where: { id },
    data: {
      status,
      verifiedById: viewer.userId,
      ...(notes ? { notes } : {}),
    },
    select: receiptDetail,
  });
}

// Removing a receipt takes the image with it, so nothing is left orphaned
// on disk.
export async function deleteReceipt(id: string, viewer: Viewer) {
  const receipt = await prisma.bankReceipt.findUnique({
    where: { id },
    select: {
      id: true,
      status: true,
      fileUrl: true,
      uploadedById: true,
    },
  });

  if (!receipt) {
    throw new Error("RECEIPT_NOT_FOUND");
  }

  if (
    viewer.role !== "OWNER" &&
    receipt.uploadedById !== viewer.userId
  ) {
    throw new Error("NOT_YOUR_RECEIPT");
  }

  if (receipt.status === "VERIFIED") {
    throw new Error("RECEIPT_VERIFIED");
  }

  await prisma.bankReceipt.delete({ where: { id } });

  const storedName = receipt.fileUrl?.split("/").pop();

  if (storedName) {
    await unlink(path.join(UPLOAD_ROOT, storedName)).catch(() => {
      // The database row is already gone; a missing file is not an error.
    });
  }

  return { id };
}

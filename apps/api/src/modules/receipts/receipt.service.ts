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
  editAllowedUntil: true,
  editRequestedAt: true,
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
 * A branch's yadere for one sales day, worked out the way the daily report
 * does: the cash every salesperson still had after their own deposits,
 * deductions and expenses (or the yadere they declared), less the
 * supervisor's expenses. `credited` is what the supervisor already banked
 * of it, and `yadere` what is still left to bank.
 */
export async function getDaySummary(locationId: string, day: string) {
  const { start, end } = dayRange(day);
  const dayKey = day.slice(0, 10);

  const [sellers, declared, slips, spent] = await Promise.all([
    prisma.user.findMany({ where: { branchId: locationId, role: "SALES" }, select: { id: true } }),
    prisma.salesYadere.aggregate({
      where: { day: { gte: start, lt: end }, salesperson: { branchId: locationId } },
      _sum: { amount: true },
      _count: { _all: true },
    }),
    prisma.bankReceipt.aggregate({
      where: {
        locationId,
        status: { not: "REJECTED" },
        receiptDate: { gte: start, lt: end },
        uploadedBy: { role: { not: "SALES" } },
      },
      _sum: { amount: true },
    }),
    prisma.expense.aggregate({
      where: { locationId, expenseDate: { gte: start, lt: end }, spentBy: { role: { not: "SALES" } } },
      _sum: { amount: true },
    }),
  ]);

  const handed = (await Promise.all(sellers.map((seller) => sellerCashDay(seller.id, dayKey)))).reduce(
    (total, row) => total + row.cash - row.banked,
    0,
  );
  // Never below 0: salespeople banking more than the day's cash leaves the
  // branch nothing to hold, not a debt.
  const base = Math.max(
    0,
    (declared._count._all > 0 ? Number(declared._sum.amount ?? 0) : handed) - Number(spent._sum.amount ?? 0),
  );
  const credited = Number(slips._sum.amount ?? 0);
  const money = (value: number) => new Prisma.Decimal(Math.round(value * 100) / 100);

  return {
    salesYadere: money(base),
    credited: money(credited),
    yadere: money(base - credited),
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
      daySales: day.salesYadere,
      yadere: day.yadere.minus(amount),
      receiptDate,
      status: "PENDING",
      notes: data.notes ?? null,
    },
    select: receiptDetail,
  });
}

/**
 * A salesperson's own cash for one day, the way the daily report counts it:
 * what customers paid in cash (sales, National ID, Telebirr) less their
 * deductions and expenses, and what they banked from it that day.
 */
export async function sellerCashDay(userId: string, day: string) {
  const { start, end } = dayRange(day);
  const sum = (value: Prisma.Decimal | null | undefined) => Number(value ?? 0);
  const [sales, nid, telebirr, deductions, expenses, banked] = await Promise.all([
    prisma.sale.aggregate({
      where: { salespersonId: userId, status: "APPROVED", saleDate: { gte: start, lt: end } },
      _sum: { totalAmount: true, transferReceived: true },
    }),
    prisma.nationalIdOrder.aggregate({
      where: { recordedById: userId, createdAt: { gte: start, lt: end } },
      _sum: { price: true, transferAmount: true },
    }),
    prisma.telebirrTransaction.aggregate({
      where: { recordedById: userId, createdAt: { gte: start, lt: end } },
      _sum: { amount: true, transferAmount: true },
    }),
    prisma.deduction.aggregate({ where: { userId, day }, _sum: { total: true } }),
    prisma.expense.aggregate({
      where: { spentById: userId, expenseDate: { gte: start, lt: end } },
      _sum: { amount: true },
    }),
    prisma.bankReceipt.aggregate({
      where: { uploadedById: userId, status: { not: "REJECTED" }, receiptDate: { gte: start, lt: end } },
      _sum: { amount: true },
    }),
  ]);
  const cash =
    sum(sales._sum.totalAmount) - sum(sales._sum.transferReceived) +
    sum(nid._sum.price) - sum(nid._sum.transferAmount) +
    sum(telebirr._sum.amount) - sum(telebirr._sum.transferAmount) -
    sum(deductions._sum.total) -
    sum(expenses._sum.amount);
  return { cash, banked: sum(banked._sum.amount) };
}

/** A local YYYY-MM-DD for a stored receipt day. */
function receiptDay(date: Date) {
  return `${date.getFullYear()}-${`${date.getMonth() + 1}`.padStart(2, "0")}-${`${date.getDate()}`.padStart(2, "0")}`;
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

  const rows = await prisma.bankReceipt.findMany({
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

  // A salesperson banks their own day's cash: what is left is worked out
  // from their own sales that day, not the branch's yadere, so a full deposit
  // leaves 0.
  const days = new Map<string, Promise<{ cash: number; banked: number }>>();
  const branchDays = new Map<string, ReturnType<typeof getDaySummary>>();
  return Promise.all(
    rows.map(async (row) => {
      if (row.uploadedBy.role !== "SALES") {
        if (!row.location) return row;
        const key = `branch|${row.location.id}|${receiptDay(row.receiptDate)}`;
        if (!branchDays.has(key)) branchDays.set(key, getDaySummary(row.location.id, receiptDay(row.receiptDate)));
        const summary = await branchDays.get(key)!;
        return {
          ...row,
          daySales: summary.salesYadere,
          yadere: Prisma.Decimal.max(new Prisma.Decimal(0), summary.yadere),
        };
      }
      const key = `${row.uploadedBy.id}|${receiptDay(row.receiptDate)}`;
      if (!days.has(key)) days.set(key, sellerCashDay(row.uploadedBy.id, receiptDay(row.receiptDate)));
      const { cash, banked } = await days.get(key)!;
      return {
        ...row,
        daySales: new Prisma.Decimal(Math.round(cash * 100) / 100),
        // Never below 0: banking it all leaves nothing still held.
        yadere: new Prisma.Decimal(Math.max(0, Math.round((cash - banked) * 100) / 100)),
      };
    }),
  );
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
      editAllowedUntil: true,
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

  // A verified receipt goes only while the Owner has allowed changes to it.
  const reopened = receipt.editAllowedUntil != null && receipt.editAllowedUntil > new Date();
  if (receipt.status === "VERIFIED" && viewer.role !== "OWNER" && !reopened) {
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

/**
 * The uploader corrects a slip the supervisor has not verified yet: amount,
 * bank, reference, day, note. A verified or rejected slip is fixed.
 */
export async function updateReceipt(
  id: string,
  data: { amount?: number; bankName?: string | null; referenceNumber?: string | null; receiptDate?: string; notes?: string | null },
  viewer: Viewer,
) {
  const receipt = await prisma.bankReceipt.findUnique({
    where: { id },
    select: {
      id: true,
      status: true,
      uploadedById: true,
      locationId: true,
      amount: true,
      receiptDate: true,
      editAllowedUntil: true,
    },
  });
  if (!receipt) throw new Error("RECEIPT_NOT_FOUND");
  if (viewer.role !== "OWNER" && receipt.uploadedById !== viewer.userId) throw new Error("NOT_YOUR_RECEIPT");
  // Salespeople and supervisors change a receipt only while the Owner has
  // allowed it (24 hours from the Owner's yes), checked or not.
  const reopened = receipt.editAllowedUntil != null && receipt.editAllowedUntil > new Date();
  if (viewer.role !== "OWNER" && !reopened) throw new Error("RECEIPT_VERIFIED");

  const amount = data.amount !== undefined ? new Prisma.Decimal(data.amount) : receipt.amount;
  const day = data.receiptDate ?? `${receipt.receiptDate.getFullYear()}-${`${receipt.receiptDate.getMonth() + 1}`.padStart(2, "0")}-${`${receipt.receiptDate.getDate()}`.padStart(2, "0")}`;
  const summary = receipt.locationId ? await getDaySummary(receipt.locationId, day) : null;
  // The day's figures already count this slip at its old amount on its old
  // day; put that back before taking the new amount off.
  const sameDay = summary && dayRange(day).start.getTime() === receipt.receiptDate.getTime();
  const yadere = summary ? summary.yadere.plus(sameDay ? receipt.amount : 0).minus(amount) : undefined;

  return prisma.bankReceipt.update({
    where: { id },
    data: {
      amount,
      // A salesperson's corrected slip goes back to their supervisor to be
      // checked again (verified or rejected).
      ...(viewer.role === "SALES" && receipt.status !== "PENDING"
        ? { status: "PENDING" as const, verifiedById: null }
        : {}),
      ...(data.bankName !== undefined ? { bankName: data.bankName || null } : {}),
      ...(data.referenceNumber !== undefined ? { referenceNumber: data.referenceNumber || null } : {}),
      ...(data.notes !== undefined ? { notes: data.notes || null } : {}),
      ...(data.receiptDate ? { receiptDate: dayRange(data.receiptDate).start } : {}),
      ...(summary ? { daySales: summary.salesYadere, yadere } : {}),
    },
    select: receiptDetail,
  });
}

/** The uploader asks the Owner to reopen a checked receipt. */
export async function requestReceiptEdit(id: string, viewer: Viewer) {
  const receipt = await prisma.bankReceipt.findUnique({
    where: { id },
    select: { uploadedById: true, status: true, editAllowedUntil: true },
  });
  if (!receipt) throw new Error("RECEIPT_NOT_FOUND");
  if (receipt.uploadedById !== viewer.userId) throw new Error("NOT_YOUR_RECEIPT");
  await prisma.bankReceipt.update({ where: { id }, data: { editRequestedAt: new Date() } });
  return { requested: true };
}

/** The Owner reopens a receipt for 24 hours, or turns the request down. */
export async function decideReceiptEdit(id: string, allow: boolean) {
  const { count } = await prisma.bankReceipt.updateMany({
    where: { id },
    data: allow
      ? { editAllowedUntil: new Date(Date.now() + 24 * 60 * 60 * 1000), editRequestedAt: null }
      : { editRequestedAt: null },
  });
  if (count === 0) throw new Error("RECEIPT_NOT_FOUND");
}

/** Receipts whose uploader asked to correct them, still waiting. */
export async function listReceiptEditRequests() {
  return prisma.bankReceipt.findMany({
    where: {
      editRequestedAt: { not: null },
      OR: [{ editAllowedUntil: null }, { editAllowedUntil: { lt: new Date() } }],
    },
    select: {
      id: true,
      amount: true,
      receiptDate: true,
      bankName: true,
      editRequestedAt: true,
      uploadedBy: { select: { id: true, name: true, role: true } },
      location: { select: { name: true } },
    },
    orderBy: { editRequestedAt: "desc" },
    take: 200,
  });
}

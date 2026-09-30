import { Prisma } from "database";
import { prisma } from "../../plugins/prisma.js";
import type { Viewer } from "../../middleware/auth.js";
import type {
  CreateCashReportInput,
  ListCashReportsQuery,
} from "./cashReport.schema.js";

const reportDetail = {
  id: true,
  status: true,
  periodStart: true,
  periodEnd: true,
  expectedCash: true,
  actualCash: true,
  variance: true,
  notes: true,
  rejectionReason: true,
  submittedAt: true,
  approvedAt: true,
  sentToOwnerAt: true,
  createdAt: true,

  salesperson: {
    select: {
      id: true,
      name: true,
      branch: { select: { id: true, name: true } },
    },
  },
  approvedBy: { select: { id: true, name: true, role: true } },

  sales: {
    select: {
      id: true,
      saleDate: true,
      totalAmount: true,
      cashReceived: true,
      status: true,
    },
  },

  receipts: {
    select: {
      id: true,
      bankName: true,
      referenceNumber: true,
      amount: true,
      receiptDate: true,
      status: true,
      fileUrl: true,
    },
  },
};

// Expected cash is never supplied by the client: it is the sum of the
// salesperson's approved sales in the period that are not already reconciled
// in another report.
export async function createCashReport(
  data: CreateCashReportInput,
  viewer: Viewer,
) {
  if (viewer.role !== "SALES") {
    throw new Error("ONLY_SALES_MAY_REPORT");
  }

  const periodStart = new Date(data.periodStart);
  const periodEnd = new Date(data.periodEnd);

  if (Number.isNaN(periodStart.getTime()) || Number.isNaN(periodEnd.getTime())) {
    throw new Error("INVALID_PERIOD");
  }

  // A date with no time means the whole day, so a report for "today" must
  // include sales made later than midnight.
  if (!data.periodEnd.includes("T")) {
    periodEnd.setHours(23, 59, 59, 999);
  }

  if (periodStart > periodEnd) {
    throw new Error("INVALID_PERIOD");
  }

  const sales = await prisma.sale.findMany({
    where: {
      salespersonId: viewer.userId,
      status: "APPROVED",
      cashReportId: null,
      saleDate: { gte: periodStart, lte: periodEnd },
    },
    select: { id: true, cashReceived: true },
  });

  if (sales.length === 0) {
    throw new Error("NO_SALES_IN_PERIOD");
  }

  // Expected = what the approved sales say they collected.
  const expectedCash = sales.reduce(
    (sum, sale) => sum.add(sale.cashReceived),
    new Prisma.Decimal(0),
  );

  // Banked = the receipts they uploaded and a supervisor verified. Only
  // verified deposits count; an unverified upload is a claim, not money.
  const receipts = await prisma.bankReceipt.findMany({
    where: {
      uploadedById: viewer.userId,
      status: "VERIFIED",
      cashReportId: null,
      receiptDate: { gte: periodStart, lte: periodEnd },
    },
    select: { id: true, amount: true },
  });

  const actualCash = receipts.reduce(
    (sum, receipt) => sum.add(receipt.amount),
    new Prisma.Decimal(0),
  );

  // Negative variance is money still in the salesperson's hand.
  const variance = actualCash.sub(expectedCash);

  return prisma.$transaction(async (tx) => {
    const report = await tx.cashReport.create({
      data: {
        salespersonId: viewer.userId,
        periodStart,
        periodEnd,
        expectedCash,
        actualCash,
        variance,
        status: "DRAFT",
        notes: data.notes ?? null,
      },
      select: { id: true },
    });

    // Claim the sales and receipts so neither is reconciled twice.
    await tx.sale.updateMany({
      where: { id: { in: sales.map((s) => s.id) } },
      data: { cashReportId: report.id },
    });

    if (receipts.length > 0) {
      await tx.bankReceipt.updateMany({
        where: { id: { in: receipts.map((r) => r.id) } },
        data: { cashReportId: report.id },
      });
    }

    return tx.cashReport.findUnique({
      where: { id: report.id },
      select: reportDetail,
    });
  });
}

export async function getCashReports(
  query: ListCashReportsQuery,
  viewer: Viewer,
) {
  let scope: Prisma.CashReportWhereInput = {};

  if (viewer.role === "SALES") {
    scope = { salespersonId: viewer.userId };
  } else if (viewer.role === "SUPERVISOR") {
    scope = {
      salesperson: { branchId: viewer.branchId ?? "__none__" },
    };
  } else {
    // The Owner is shown reports that have reached them, unless they ask
    // for a specific status.
    scope = query.branchId
      ? { salesperson: { branchId: query.branchId } }
      : {};
  }

  return prisma.cashReport.findMany({
    where: {
      ...scope,
      ...(query.status ? { status: query.status } : {}),
      ...(query.salespersonId && viewer.role !== "SALES"
        ? { salespersonId: query.salespersonId }
        : {}),
    },
    select: reportDetail,
    orderBy: { periodEnd: "desc" },
  });
}

export async function getCashReportById(
  id: string,
  viewer: Viewer,
) {
  const report = await prisma.cashReport.findUnique({
    where: { id },
    select: reportDetail,
  });

  if (!report) {
    return null;
  }

  if (
    viewer.role === "SALES" &&
    report.salesperson.id !== viewer.userId
  ) {
    return null;
  }

  if (
    viewer.role === "SUPERVISOR" &&
    report.salesperson.branch?.id !== viewer.branchId
  ) {
    return null;
  }

  return report;
}

async function loadForTransition(id: string) {
  const report = await prisma.cashReport.findUnique({
    where: { id },
    select: {
      id: true,
      status: true,
      salespersonId: true,
      salesperson: { select: { branchId: true } },
    },
  });

  if (!report) {
    throw new Error("REPORT_NOT_FOUND");
  }

  return report;
}

export async function submitCashReport(
  id: string,
  viewer: Viewer,
) {
  const report = await loadForTransition(id);

  if (report.salespersonId !== viewer.userId) {
    throw new Error("NOT_YOUR_REPORT");
  }

  if (report.status !== "DRAFT") {
    throw new Error("REPORT_NOT_DRAFT");
  }

  return prisma.cashReport.update({
    where: { id },
    data: { status: "SUBMITTED", submittedAt: new Date() },
    select: reportDetail,
  });
}

export async function approveCashReport(
  id: string,
  viewer: Viewer,
) {
  const report = await loadForTransition(id);

  if (report.status !== "SUBMITTED") {
    throw new Error("REPORT_NOT_SUBMITTED");
  }

  if (
    viewer.role === "SUPERVISOR" &&
    report.salesperson.branchId !== viewer.branchId
  ) {
    throw new Error("NOT_YOUR_BRANCH");
  }

  return prisma.cashReport.update({
    where: { id },
    data: {
      status: "APPROVED",
      approvedById: viewer.userId,
      approvedAt: new Date(),
    },
    select: reportDetail,
  });
}

export async function rejectCashReport(
  id: string,
  rejectionReason: string,
  viewer: Viewer,
) {
  const report = await loadForTransition(id);

  if (report.status !== "SUBMITTED") {
    throw new Error("REPORT_NOT_SUBMITTED");
  }

  if (
    viewer.role === "SUPERVISOR" &&
    report.salesperson.branchId !== viewer.branchId
  ) {
    throw new Error("NOT_YOUR_BRANCH");
  }

  return prisma.cashReport.update({
    where: { id },
    data: {
      status: "REJECTED",
      rejectionReason,
      approvedById: viewer.userId,
    },
    select: reportDetail,
  });
}

// The supervisor forwards an approved reconciliation to the Owner.
export async function sendCashReportToOwner(
  id: string,
  viewer: Viewer,
) {
  const report = await loadForTransition(id);

  if (report.status !== "APPROVED") {
    throw new Error("REPORT_NOT_APPROVED");
  }

  if (
    viewer.role === "SUPERVISOR" &&
    report.salesperson.branchId !== viewer.branchId
  ) {
    throw new Error("NOT_YOUR_BRANCH");
  }

  return prisma.cashReport.update({
    where: { id },
    data: {
      status: "SENT_TO_OWNER",
      sentToOwnerAt: new Date(),
    },
    select: reportDetail,
  });
}

import { Prisma } from "database";

import { prisma } from "../../plugins/prisma.js";
import type { Viewer } from "../../middleware/auth.js";
import { getSettings } from "../settings/settings.service.js";
import type {
  CreateRecordInput,
  ListRecordsQuery,
  ReceiveBlanksInput,
  SummaryQuery,
  UpdateRecordInput,
} from "./nationalId.schema.js";

const INCLUDE = {
  location: { select: { id: true, name: true } },
  recordedBy: {
    select: {
      id: true,
      name: true,
      role: true,
      branch: { select: { id: true, name: true } },
    },
  },
} satisfies Prisma.NationalIdRecordInclude;

/**
 * A YYYY-MM-DD string as a UTC midnight Date.
 *
 * The column is a DATE, so the day must not shift with the server's timezone:
 * work done on the 17th has to stay on the 17th wherever the API runs.
 */
function toDay(value: string) {
  return new Date(`${value}T00:00:00.000Z`);
}

function isoDay(date: Date) {
  return date.toISOString().slice(0, 10);
}

/** Start of the window a range name means, in UTC days. */
function rangeStart(range: SummaryQuery["range"], today: Date) {
  const start = new Date(today);

  if (range === "today") return start;

  if (range === "week") {
    // Monday-based, which is how a branch's week is counted here.
    const weekday = (start.getUTCDay() + 6) % 7;
    start.setUTCDate(start.getUTCDate() - weekday);
    return start;
  }

  if (range === "month") {
    start.setUTCDate(1);
    return start;
  }

  start.setUTCMonth(0, 1);
  return start;
}

/** Everyone sees their own branch; the Owner sees whichever they ask for. */
function branchScope(viewer: Viewer, locationId?: string) {
  if (viewer.role === "OWNER") {
    return locationId ? { locationId } : {};
  }

  return { locationId: viewer.branchId ?? "__none__" };
}

/**
 * Who a list belongs to. The branch view is the supervisor's; a salesperson
 * sees the records they entered themselves, the same way they see their own
 * sales and their own requests.
 */
function recordScope(viewer: Viewer, locationId?: string) {
  return viewer.role === "SALES"
    ? { recordedById: viewer.userId }
    : branchScope(viewer, locationId);
}

export async function createRecord(data: CreateRecordInput, viewer: Viewer) {
  const locationId =
    viewer.role === "OWNER" ? data.locationId : viewer.branchId;

  if (!locationId) {
    throw new Error("NO_BRANCH");
  }

  if (
    viewer.role !== "OWNER" &&
    data.locationId &&
    data.locationId !== locationId
  ) {
    throw new Error("FORBIDDEN_BRANCH");
  }

  if (data.originalCount + data.copyCount < 1) {
    throw new Error("NOTHING_RECORDED");
  }

  // A salesperson records their own work. A supervisor or the Owner may record
  // on behalf of someone at that branch, which is how a day gets entered for
  // an employee who is off.
  let recordedById = viewer.userId;

  if (data.recordedById && data.recordedById !== viewer.userId) {
    if (viewer.role === "SALES") {
      throw new Error("FORBIDDEN_EMPLOYEE");
    }

    const employee = await prisma.user.findUnique({
      where: { id: data.recordedById },
      select: { id: true, branchId: true, isActive: true },
    });

    if (!employee || !employee.isActive || employee.branchId !== locationId) {
      throw new Error("EMPLOYEE_NOT_AT_BRANCH");
    }

    recordedById = employee.id;
  }

  const location = await prisma.stockLocation.findUnique({
    where: { id: locationId },
    select: { id: true, isActive: true },
  });

  if (!location) throw new Error("NOT_FOUND");
  if (!location.isActive) throw new Error("LOCATION_INACTIVE");

  await assertEnoughBlanks(locationId, data.originalCount, data.copyCount);

  const settings = await getSettings();

  const originalRate = new Prisma.Decimal(settings.nationalIdOriginalRate);
  const copyRate = new Prisma.Decimal(settings.nationalIdCopyRate);

  const revenue = originalRate
    .mul(data.originalCount)
    .add(copyRate.mul(data.copyCount));

  try {
    return await prisma.nationalIdRecord.create({
      data: {
        date: toDay(data.date),
        locationId,
        recordedById,
        originalCount: data.originalCount,
        copyCount: data.copyCount,
        originalRate,
        copyRate,
        revenue,
        ...(data.notes ? { notes: data.notes } : {}),
      },
      include: INCLUDE,
    });
  } catch (caught) {
    // One row per employee per branch per day: a second entry is an edit.
    if (
      caught instanceof Prisma.PrismaClientKnownRequestError &&
      caught.code === "P2002"
    ) {
      throw new Error("DUPLICATE_DAY");
    }

    throw caught;
  }
}

export async function getRecords(query: ListRecordsQuery, viewer: Viewer) {
  const where: Prisma.NationalIdRecordWhereInput = {
    ...recordScope(viewer, query.locationId),
    ...(query.recordedById ? { recordedById: query.recordedById } : {}),
    ...(query.from || query.to
      ? {
          date: {
            ...(query.from ? { gte: toDay(query.from) } : {}),
            ...(query.to ? { lte: toDay(query.to) } : {}),
          },
        }
      : {}),
  };

  return prisma.nationalIdRecord.findMany({
    where,
    include: INCLUDE,
    orderBy: [{ date: "desc" }, { createdAt: "desc" }],
    take: 1000,
  });
}

async function loadOwn(id: string, viewer: Viewer) {
  const record = await prisma.nationalIdRecord.findUnique({
    where: { id },
    select: { id: true, locationId: true, recordedById: true },
  });

  // Another branch's record is reported missing rather than forbidden, so the
  // response never confirms that it exists.
  if (
    !record ||
    (viewer.role !== "OWNER" && record.locationId !== viewer.branchId)
  ) {
    throw new Error("NOT_FOUND");
  }

  // Sales may only correct their own day; supervisors correct their branch.
  if (viewer.role === "SALES" && record.recordedById !== viewer.userId) {
    throw new Error("NOT_YOURS");
  }

  return record;
}

export async function updateRecord(
  id: string,
  data: UpdateRecordInput,
  viewer: Viewer,
) {
  await loadOwn(id, viewer);

  const current = await prisma.nationalIdRecord.findUniqueOrThrow({
    where: { id },
  });

  const originalCount = data.originalCount ?? current.originalCount;
  const copyCount = data.copyCount ?? current.copyCount;

  if (originalCount + copyCount < 1) {
    throw new Error("NOTHING_RECORDED");
  }

  // Checked against the branch's blanks with this row's own counts left out,
  // so raising a count is measured against what the rest of the month used.
  await assertEnoughBlanks(
    current.locationId,
    originalCount,
    copyCount,
    current.id,
  );

  // Recalculated from the rates stored on the row, not from today's settings:
  // correcting a count must not also silently reprice the day.
  const revenue = current.originalRate
    .mul(originalCount)
    .add(current.copyRate.mul(copyCount));

  return prisma.nationalIdRecord.update({
    where: { id },
    data: {
      originalCount,
      copyCount,
      revenue,
      ...(data.notes !== undefined ? { notes: data.notes } : {}),
    },
    include: INCLUDE,
  });
}

export async function deleteRecord(id: string, viewer: Viewer) {
  await loadOwn(id, viewer);

  await prisma.nationalIdRecord.delete({ where: { id } });

  return { id };
}

/**
 * The figures the dashboard shows: totals for the chosen window, the three
 * standing periods, and a per-branch breakdown.
 */
export async function getSummary(query: SummaryQuery, viewer: Viewer) {
  const today = toDay(isoDay(new Date()));
  const scope = branchScope(viewer, query.locationId);

  const from =
    query.range === "custom" && query.from
      ? toDay(query.from)
      : rangeStart(query.range, today);

  const to =
    query.range === "custom" && query.to ? toDay(query.to) : today;

  async function totalsFor(gte: Date, lte: Date) {
    const result = await prisma.nationalIdRecord.aggregate({
      where: { ...scope, date: { gte, lte } },
      _sum: { originalCount: true, copyCount: true, revenue: true },
    });

    const original = result._sum.originalCount ?? 0;
    const copy = result._sum.copyCount ?? 0;

    return {
      original,
      copy,
      total: original + copy,
      revenue: Number(result._sum.revenue ?? 0),
    };
  }

  const [range, todayTotals, weekTotals, monthTotals, byBranchRaw] =
    await Promise.all([
      totalsFor(from, to),
      totalsFor(today, today),
      totalsFor(rangeStart("week", today), today),
      totalsFor(rangeStart("month", today), today),
      prisma.nationalIdRecord.groupBy({
        by: ["locationId"],
        where: { ...scope, date: { gte: from, lte: to } },
        _sum: { originalCount: true, copyCount: true, revenue: true },
      }),
    ]);

  // Branch names are joined here rather than in the group-by, which Prisma
  // cannot do, and only for the branches that actually appear.
  const branches = await prisma.stockLocation.findMany({
    where: { id: { in: byBranchRaw.map((row) => row.locationId) } },
    select: { id: true, name: true },
  });

  const nameOf = new Map(branches.map((b) => [b.id, b.name]));

  const byBranch = byBranchRaw
    .map((row) => {
      const original = row._sum.originalCount ?? 0;
      const copy = row._sum.copyCount ?? 0;

      return {
        locationId: row.locationId,
        name: nameOf.get(row.locationId) ?? "—",
        original,
        copy,
        total: original + copy,
        revenue: Number(row._sum.revenue ?? 0),
      };
    })
    .sort((a, b) => b.total - a.total);

  // One point per day for the trend chart, zero-filled so gaps are visible as
  // gaps rather than the line jumping over them.
  const daily = await prisma.nationalIdRecord.groupBy({
    by: ["date"],
    where: { ...scope, date: { gte: from, lte: to } },
    _sum: { originalCount: true, copyCount: true },
    orderBy: { date: "asc" },
  });

  const byDay = new Map(
    daily.map((row) => [
      isoDay(row.date),
      {
        original: row._sum.originalCount ?? 0,
        copy: row._sum.copyCount ?? 0,
      },
    ]),
  );

  const trend: { date: string; original: number; copy: number }[] = [];
  const cursor = new Date(from);

  // Capped so a wide custom range cannot build an unbounded array.
  while (cursor <= to && trend.length < 400) {
    const key = isoDay(cursor);
    const found = byDay.get(key);

    trend.push({
      date: key,
      original: found?.original ?? 0,
      copy: found?.copy ?? 0,
    });

    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }

  return {
    from: isoDay(from),
    to: isoDay(to),
    range: query.range,
    totals: range,
    today: todayTotals,
    week: weekTotals,
    month: monthTotals,
    byBranch,
    trend,
  };
}

/* ---------------------------------------------------------------------------
   Blank ID card stock

   Never stored as a balance. What a branch has left is (received − printed),
   worked out on demand, so correcting or deleting a day's print work fixes the
   remaining figure with it.
   --------------------------------------------------------------------------- */

export type BlankBalance = {
  locationId: string;
  name: string;
  originalReceived: number;
  copyReceived: number;
  originalPrinted: number;
  copyPrinted: number;
  originalRemaining: number;
  copyRemaining: number;
  /** False until the branch has logged its first arrival. */
  tracked: boolean;
};

/** Remaining blanks per branch, for every branch the viewer may see. */
export async function getBlankBalances(
  viewer: Viewer,
  locationId?: string,
): Promise<BlankBalance[]> {
  const scope = branchScope(viewer, locationId);

  const [received, printed, branches] = await Promise.all([
    prisma.nationalIdStockEntry.groupBy({
      by: ["locationId"],
      where: scope,
      _sum: { originalAdded: true, copyAdded: true },
    }),
    prisma.nationalIdRecord.groupBy({
      by: ["locationId"],
      where: scope,
      _sum: { originalCount: true, copyCount: true },
    }),
    // The branch table keys on `id`, not `locationId`, so the scope has to be
    // translated rather than spread.
    prisma.stockLocation.findMany({
      where: {
        isActive: true,
        ...(scope.locationId ? { id: scope.locationId } : {}),
      },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
  ]);

  const receivedBy = new Map(received.map((row) => [row.locationId, row._sum]));
  const printedBy = new Map(printed.map((row) => [row.locationId, row._sum]));

  return branches.map((branch) => {
    const got = receivedBy.get(branch.id);
    const used = printedBy.get(branch.id);

    const originalReceived = got?.originalAdded ?? 0;
    const copyReceived = got?.copyAdded ?? 0;
    const originalPrinted = used?.originalCount ?? 0;
    const copyPrinted = used?.copyCount ?? 0;

    return {
      locationId: branch.id,
      name: branch.name,
      originalReceived,
      copyReceived,
      originalPrinted,
      copyPrinted,
      originalRemaining: originalReceived - originalPrinted,
      copyRemaining: copyReceived - copyPrinted,
      tracked: receivedBy.has(branch.id),
    };
  });
}

export async function receiveBlanks(
  data: ReceiveBlanksInput,
  viewer: Viewer,
) {
  const locationId =
    viewer.role === "OWNER" ? data.locationId : viewer.branchId;

  if (!locationId) throw new Error("NO_BRANCH");

  if (
    viewer.role !== "OWNER" &&
    data.locationId &&
    data.locationId !== locationId
  ) {
    throw new Error("FORBIDDEN_BRANCH");
  }

  const location = await prisma.stockLocation.findUnique({
    where: { id: locationId },
    select: { id: true, isActive: true },
  });

  if (!location) throw new Error("NOT_FOUND");
  if (!location.isActive) throw new Error("LOCATION_INACTIVE");

  return prisma.nationalIdStockEntry.create({
    data: {
      locationId,
      originalAdded: data.originalAdded,
      copyAdded: data.copyAdded,
      receivedById: viewer.userId,
      ...(data.note ? { note: data.note } : {}),
    },
    include: {
      location: { select: { id: true, name: true } },
      receivedBy: { select: { id: true, name: true, role: true } },
    },
  });
}

/** The arrivals log, newest first. */
export async function getBlankEntries(viewer: Viewer, locationId?: string) {
  return prisma.nationalIdStockEntry.findMany({
    where: branchScope(viewer, locationId),
    include: {
      location: { select: { id: true, name: true } },
      receivedBy: { select: { id: true, name: true, role: true } },
    },
    orderBy: { createdAt: "desc" },
    take: 200,
  });
}

/**
 * Refuses a print run a branch does not have the blanks for.
 *
 * Only enforced once a branch has logged its first arrival. A branch that has
 * not started tracking blanks can still record its print work — the check
 * turns itself on when there is something to check against.
 */
async function assertEnoughBlanks(
  locationId: string,
  originalCount: number,
  copyCount: number,
  ignoreRecordId?: string,
) {
  const received = await prisma.nationalIdStockEntry.aggregate({
    where: { locationId },
    _sum: { originalAdded: true, copyAdded: true },
    _count: true,
  });

  if (received._count === 0) return;

  const printed = await prisma.nationalIdRecord.aggregate({
    where: {
      locationId,
      ...(ignoreRecordId ? { id: { not: ignoreRecordId } } : {}),
    },
    _sum: { originalCount: true, copyCount: true },
  });

  const originalLeft =
    (received._sum.originalAdded ?? 0) - (printed._sum.originalCount ?? 0);
  const copyLeft =
    (received._sum.copyAdded ?? 0) - (printed._sum.copyCount ?? 0);

  if (originalCount > originalLeft) throw new Error("NOT_ENOUGH_ORIGINAL");
  if (copyCount > copyLeft) throw new Error("NOT_ENOUGH_COPY");
}

export { assertEnoughBlanks };

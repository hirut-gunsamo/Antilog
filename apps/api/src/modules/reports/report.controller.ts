import type {
  FastifyReply,
  FastifyRequest,
} from "fastify";

import { loadViewer } from "../../middleware/auth.js";

import {
  salesReportQuerySchema,
  cashPositionQuerySchema,
  inventoryReportQuerySchema,
} from "./report.schema.js";

import {
  getSalesReport,
  getCashPosition,
  getInventoryReport,
  getStockChange,
  getRecentActivity,
  getTopProducts,
  getLowStock,
  getRecentSales,
  getBranchActivity,
  salesReportCsv,
  cashPositionCsv,
  inventoryReportCsv,
} from "./report.service.js";

async function withViewer(
  request: FastifyRequest,
  reply: FastifyReply,
) {
  const viewer = await loadViewer(request);

  if (!viewer) {
    reply.status(403).send({
      message: "User account is inactive",
    });

    return null;
  }

  return viewer;
}

// Sends the report as a downloadable CSV file rather than JSON.
function sendCsv(
  reply: FastifyReply,
  filename: string,
  body: string,
) {
  return reply
    .header("Content-Type", "text/csv; charset=utf-8")
    .header(
      "Content-Disposition",
      `attachment; filename="${filename}"`,
    )
    .send(body);
}

function stamp() {
  return new Date().toISOString().slice(0, 10);
}

export async function salesReportController(
  request: FastifyRequest<{
    Querystring: Record<string, string>;
  }>,
  reply: FastifyReply,
) {
  const result = salesReportQuerySchema.safeParse(request.query);

  if (!result.success) {
    return reply.status(400).send({
      message: "Invalid report options",
      errors: result.error.flatten(),
    });
  }

  const viewer = await withViewer(request, reply);
  if (!viewer) return reply;

  const report = await getSalesReport(result.data, viewer);

  if (result.data.format === "csv") {
    return sendCsv(
      reply,
      `sales-${result.data.period}-${stamp()}.csv`,
      salesReportCsv(report),
    );
  }

  return reply.send({ report });
}

export async function cashPositionController(
  request: FastifyRequest<{
    Querystring: Record<string, string>;
  }>,
  reply: FastifyReply,
) {
  const result = cashPositionQuerySchema.safeParse(request.query);

  if (!result.success) {
    return reply.status(400).send({
      message: "Invalid report options",
      errors: result.error.flatten(),
    });
  }

  const viewer = await withViewer(request, reply);
  if (!viewer) return reply;

  const report = await getCashPosition(result.data, viewer);

  if (result.data.format === "csv") {
    return sendCsv(
      reply,
      `cash-position-${stamp()}.csv`,
      cashPositionCsv(report),
    );
  }

  return reply.send({ report });
}

export async function inventoryReportController(
  request: FastifyRequest<{
    Querystring: Record<string, string>;
  }>,
  reply: FastifyReply,
) {
  const result = inventoryReportQuerySchema.safeParse(
    request.query,
  );

  if (!result.success) {
    return reply.status(400).send({
      message: "Invalid report options",
      errors: result.error.flatten(),
    });
  }

  const viewer = await withViewer(request, reply);
  if (!viewer) return reply;

  const report = await getInventoryReport(result.data, viewer);

  if (result.data.format === "csv") {
    return sendCsv(
      reply,
      `stock-remaining-${stamp()}.csv`,
      inventoryReportCsv(report),
    );
  }

  return reply.send({ report });
}

// One call that fills a dashboard: today, this week, this month, this year,
// plus stock and outstanding cash.
export async function dashboardController(
  request: FastifyRequest,
  reply: FastifyReply,
) {
  const viewer = await withViewer(request, reply);
  if (!viewer) return reply;

  const now = new Date();

  const startOfDay = new Date(now);
  startOfDay.setHours(0, 0, 0, 0);

  const startOfWeek = new Date(startOfDay);
  startOfWeek.setDate(
    startOfDay.getDate() - ((startOfDay.getDay() + 6) % 7),
  );

  const startOfMonth = new Date(
    now.getFullYear(),
    now.getMonth(),
    1,
  );

  const startOfYear = new Date(now.getFullYear(), 0, 1);

  // The tiles compare against the equivalent stretch of last month.
  const startOfLastMonth = new Date(
    now.getFullYear(),
    now.getMonth() - 1,
    1,
  );
  const endOfLastMonth = new Date(now.getFullYear(), now.getMonth(), 0);
  endOfLastMonth.setHours(23, 59, 59, 999);

  // "Last 7 days" on the sales chart means seven day-buckets ending today.
  const startOfSevenDays = new Date(startOfDay);
  startOfSevenDays.setDate(startOfDay.getDate() - 6);

  const iso = (d: Date) => d.toISOString();

  const [
    today,
    week,
    month,
    year,
    stock,
    cash,
    lastMonth,
    sevenDays,
    stockChange,
    activity,
    topToday,
    lowStock,
    recentSales,
    branchActivity,
    topMonth,
    branchActivityToday,
    branchActivityLast7,
    branchActivityYear,
  ] = await Promise.all([
      getSalesReport(
        { period: "daily", from: iso(startOfDay), format: "json" },
        viewer,
      ),
      getSalesReport(
        { period: "daily", from: iso(startOfWeek), format: "json" },
        viewer,
      ),
      getSalesReport(
        {
          period: "daily",
          from: iso(startOfMonth),
          format: "json",
        },
        viewer,
      ),
      getSalesReport(
        {
          period: "monthly",
          from: iso(startOfYear),
          format: "json",
        },
        viewer,
      ),
      getInventoryReport({ format: "json" }, viewer),
      getCashPosition({ format: "json" }, viewer),
      getSalesReport(
        {
          period: "monthly",
          from: iso(startOfLastMonth),
          to: iso(endOfLastMonth),
          format: "json",
        },
        viewer,
      ),
      getSalesReport(
        {
          period: "daily",
          from: iso(startOfSevenDays),
          format: "json",
        },
        viewer,
      ),
      getStockChange(viewer),
      getRecentActivity(viewer),
      getTopProducts(viewer, startOfDay),
      getLowStock(viewer),
      getRecentSales(viewer),
      getBranchActivity(viewer, startOfMonth),
      // Best sellers fall back to a wider window when today is still quiet,
      // so the table is not empty first thing in the morning.
      getTopProducts(viewer, startOfMonth),
      // The branch table's range selector switches between these without a
      // refetch, the same way the sales chart does.
      getBranchActivity(viewer, startOfDay),
      getBranchActivity(viewer, startOfSevenDays),
      getBranchActivity(viewer, startOfYear),
    ]);

  // Percentage change against the same measure last month.
  const delta = (current: number, previous: number) => {
    if (previous === 0) return current > 0 ? 100 : 0;
    return Math.round(((current - previous) / previous) * 1000) / 10;
  };

  // Seven day-buckets ending today, including the days with no sales, so the
  // chart always shows a full week rather than only the days that traded.
  const days: { key: string; label: string; revenue: number }[] = [];

  for (let offset = 6; offset >= 0; offset -= 1) {
    const day = new Date(startOfDay);
    day.setDate(startOfDay.getDate() - offset);

    const key = `${day.getFullYear()}-${`${day.getMonth() + 1}`.padStart(2, "0")}-${`${day.getDate()}`.padStart(2, "0")}`;
    const bucket = sevenDays.buckets.find((b) => b.key === key);

    days.push({
      key,
      label: day.toLocaleDateString("en-US", { weekday: "short" }),
      revenue: bucket?.revenue ?? 0,
    });
  }

  return reply.send({
    dashboard: {
      today: today.summary,
      thisWeek: week.summary,
      thisMonth: month.summary,
      thisYear: year.summary,
      lastMonth: lastMonth.summary,
      monthlyTrend: year.buckets,
      branchPerformance: month.byBranch,

      // Everything the stat tiles and the weekly chart need, pre-computed.
      tiles: {
        simCards: {
          value: stockChange.byCategory.SIM_CARD.onHand,
          changePct: stockChange.byCategory.SIM_CARD.changePct,
        },
        phones: {
          value: stockChange.byCategory.PHONE.onHand,
          changePct: stockChange.byCategory.PHONE.changePct,
        },
        vouchers: {
          value: stockChange.byCategory.AIRTIME_VOUCHER.onHand,
          changePct: stockChange.byCategory.AIRTIME_VOUCHER.changePct,
        },
        cashReceived: {
          value: month.summary.cashReceived,
          changePct: delta(
            month.summary.cashReceived,
            lastMonth.summary.cashReceived,
          ),
        },
      },

      last7Days: {
        buckets: days,
        totalSales: sevenDays.summary.revenue,
        itemsSold: Object.values(sevenDays.summary.byCategory).reduce(
          (sum, entry) => sum + entry.quantity,
          0,
        ),
        transactions: sevenDays.summary.transactions,
      },

      inventoryByCategory: {
        SIM_CARD: stockChange.byCategory.SIM_CARD.onHand,
        PHONE: stockChange.byCategory.PHONE.onHand,
        AIRTIME_VOUCHER: stockChange.byCategory.AIRTIME_VOUCHER.onHand,
        total: stockChange.totalUnits,
      },

      recentActivity: activity,

      // Best sellers today, falling back to the month while today is quiet.
      topProducts: topToday.length > 0 ? topToday : topMonth,
      topProductsWindow: topToday.length > 0 ? "today" : "month",

      lowStock,
      recentSales,

      // Per-branch trading. "customers" counts completed purchases; the
      // system stores no customer identities.
      //
      // branchActivity stays month-to-date for the callers that already read
      // it; branchActivityByRange carries all four windows for the branch
      // table's range selector.
      branchActivity,
      branchActivityByRange: {
        today: branchActivityToday,
        last7: branchActivityLast7,
        month: branchActivity,
        year: branchActivityYear,
      },
      stock: {
        totals: stock.totals,
        branches: stock.branches.map((b) => ({
          id: b.id,
          name: b.name,
          totalUnits: b.totalUnits,
          stockValue: b.stockValue,
          byCategory: b.byCategory,
        })),
      },
      cashPosition: cash,
    },
  });
}

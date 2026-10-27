import { prisma } from "../../plugins/prisma.js";
import type { Viewer } from "../../middleware/auth.js";
import { getSettings } from "../settings/settings.service.js";
import { getLowStock } from "../reports/report.service.js";

/**
 * What needs this person's attention right now.
 *
 * Derived from live data rather than stored as events. A notification here is
 * a piece of current state — "three requests are waiting on you" — so acting
 * on the thing makes the notification disappear by itself. There is no read
 * flag to keep in step and no way for the badge to lie.
 *
 * Everything is scoped exactly as the matching page is: the Owner counts every
 * branch, a supervisor their own, a salesperson their own work.
 */

export type NotificationKind =
  | "REQUESTS_TO_DECIDE"
  | "MY_STOCK_LOW"
  | "ITEMS_TO_ISSUE"
  | "RETURNS_TO_CONFIRM"
  | "SALES_TO_APPROVE"
  | "REPORTS_TO_APPROVE"
  | "RECEIPTS_TO_VERIFY"
  | "LOSSES_TO_REVIEW"
  | "MY_DRAFTS"
  | "MY_REJECTED"
  | "MY_REQUEST_APPROVED"
  | "DELIVERIES_TO_RECEIVE"
  | "ISSUES_TO_RECEIVE"
  | "TRANSFERS_DONE"
  | "EXPENSES_ADDED"
  | "NID_TO_FORWARD"
  | "NID_TO_PRINT"
  | "NID_RETURNED"
  | "MY_REQUEST_REJECTED"
  | "LOW_STOCK"
  | "LOW_BLANKS"
  | "EDITS_TO_ALLOW";

export type Notification = {
  kind: NotificationKind;
  count: number;
  /** "action" needs a decision from this person; "warn" is a heads-up. */
  tone: "action" | "warn";
  href: string;
  /** A few names for context, where naming them helps. */
  sample: string[];
  /**
   * When the newest item of this kind reached this person, and who sent it.
   * The client pops up a notice when this moves forward, which catches a new
   * arrival even if another was dealt with in the same poll and the count
   * stayed the same.
   */
  latest?: { at: string; by: string };
};

function latestOf(row: { at: Date | null; by: { name: string } } | null) {
  return row?.at ? { at: row.at.toISOString(), by: row.by.name } : undefined;
}

/** Below this a branch is close to running out of blank ID cards. */
const LOW_BLANKS = 50;

/** How long a decided request keeps showing if the Requests page is never opened. */
const DECIDED_SHOWN_FOR_MS = 3 * 24 * 60 * 60 * 1000;

export async function getNotifications(
  viewer: Viewer,
  // When this person last opened the Requests page. Decisions from before it
  // have been seen, so they stop showing.
  options: {
    requestsSeenAt?: Date;
    transfersSeenAt?: Date;
    expensesSeenAt?: Date;
    nidSeenAt?: Date;
  } = {},
) {
  const settings = await getSettings();
  const out: Notification[] = [];

  const isOwner = viewer.role === "OWNER";
  const branchId = viewer.branchId ?? "__none__";

  // Requests addressed to this person, at either level of the chain.
  //
  // Split by kind, because they are three different jobs at three different
  // times: hand goods out in the morning, take them back at night, restock
  // the branch. One combined count would hide which is waiting.
  if (settings.notifyRequests && viewer.role !== "SALES") {
    const requests = await prisma.stockRequest.findMany({
      // Every supervisor of the branch sees its salespeople's requests.
      where:
        viewer.role === "SUPERVISOR"
          ? {
              status: "PENDING",
              OR: [
                { requestedToId: viewer.userId },
                { requestedBy: { role: "SALES", branchId: viewer.branchId ?? "__none__" } },
                // Another branch asking this one for stock.
                {
                  requestedBy: { role: "SUPERVISOR" },
                  requestedTo: { role: "SUPERVISOR", branchId: viewer.branchId ?? "__none__" },
                },
              ],
            }
          : { status: "PENDING", requestedToId: viewer.userId },
      select: {
        id: true,
        kind: true,
        submittedAt: true,
        requestedBy: { select: { name: true } },
      },
      // Newest first, so the sample and `latest` name the newest sender.
      orderBy: { submittedAt: "desc" },
      take: 60,
    });

    const byKind = {
      ISSUE: "ITEMS_TO_ISSUE",
      RETURN: "RETURNS_TO_CONFIRM",
      RESTOCK: "REQUESTS_TO_DECIDE",
    } as const;

    for (const [kind, notificationKind] of Object.entries(byKind)) {
      const waiting = requests.filter((r) => r.kind === kind);

      if (waiting.length === 0) continue;

      out.push({
        kind: notificationKind,
        count: waiting.length,
        tone: "action",
        // Opens the newest one's items straight away; the rest are listed.
        href: `/approvals?request=${waiting[0].id}`,
        sample: waiting.slice(0, 3).map((r) => r.requestedBy.name),
        latest: latestOf({
          at: waiting[0].submittedAt,
          by: waiting[0].requestedBy,
        }),
      });
    }
  }

  // Salespeople asking to correct a past day's sale wait on the Owner.
  if (isOwner) {
    const asked = await prisma.sale.findMany({
      where: {
        editRequestedAt: { not: null },
        OR: [{ editAllowedUntil: null }, { editAllowedUntil: { lt: new Date() } }],
      },
      select: { editRequestedAt: true, salesperson: { select: { name: true } } },
      orderBy: { editRequestedAt: "desc" },
      take: 60,
    });
    // Receipts their uploader asked to correct wait on the Owner too.
    const receiptsAsked = await prisma.bankReceipt.findMany({
      where: {
        editRequestedAt: { not: null },
        OR: [{ editAllowedUntil: null }, { editAllowedUntil: { lt: new Date() } }],
      },
      select: { editRequestedAt: true, uploadedBy: { select: { name: true } } },
      orderBy: { editRequestedAt: "desc" },
      take: 60,
    });
    // And payment corrections of a sale.
    const payFixes = await prisma.sale.findMany({
      where: { payFixRequestedAt: { not: null } },
      select: { payFixRequestedAt: true, salesperson: { select: { name: true } } },
      orderBy: { payFixRequestedAt: "desc" },
      take: 60,
    });
    // And days whose payments a salesperson asked to correct.
    const payEdits = await prisma.paymentEditGrant.findMany({
      where: { requestedAt: { not: null } },
      select: { requestedAt: true, user: { select: { name: true } } },
      orderBy: { requestedAt: "desc" },
      take: 60,
    });
    const waiting = [
      ...payEdits.map((row) => ({ at: row.requestedAt!, by: row.user })),
      ...asked.map((row) => ({ at: row.editRequestedAt!, by: row.salesperson })),
      ...payFixes.map((row) => ({ at: row.payFixRequestedAt!, by: row.salesperson })),
      ...receiptsAsked.map((row) => ({ at: row.editRequestedAt!, by: row.uploadedBy })),
    ].sort((a, b) => b.at.getTime() - a.at.getTime());
    if (waiting.length > 0) {
      out.push({
        kind: "EDITS_TO_ALLOW",
        count: asked.length + receiptsAsked.length + payFixes.length + payEdits.length,
        tone: "action",
        href: "/reports",
        sample: [...new Set(waiting.map((row) => row.by.name))].slice(0, 3),
        latest: latestOf({ at: waiting[0].at, by: waiting[0].by }),
      });
    }
  }

  if (settings.notifyApprovals && viewer.role !== "SALES") {
    const scope = isOwner ? {} : { locationId: branchId };

    const saleWhere = { status: "SUBMITTED" as const, ...scope };
    const reportWhere = {
      status: isOwner ? ("SENT_TO_OWNER" as const) : ("SUBMITTED" as const),
      ...(isOwner ? {} : { salesperson: { branchId } }),
    };
    const receiptWhere = {
      status: "PENDING" as const,
      ...(isOwner ? {} : { uploadedBy: { branchId } }),
    };
    const lossWhere = { status: "PENDING" as const, ...scope };

    // A report reaches the Owner when the supervisor forwards it, not when
    // the salesperson first submits it.
    const reportAt = isOwner ? "sentToOwnerAt" : "submittedAt";

    const [sales, reports, receipts, losses, newest] = await Promise.all([
      prisma.sale.count({ where: saleWhere }),
      prisma.cashReport.count({ where: reportWhere }),
      prisma.bankReceipt.count({ where: receiptWhere }),
      prisma.stockLossReport.count({ where: lossWhere }),
      Promise.all([
        prisma.sale.findFirst({
          where: saleWhere,
          // Postgres sorts NULLs first when descending; an old row missing
          // its timestamp must not hide the newest one.
          orderBy: { submittedAt: { sort: "desc", nulls: "last" } },
          select: { submittedAt: true, salesperson: { select: { name: true } } },
        }),
        prisma.cashReport.findFirst({
          where: reportWhere,
          orderBy: { [reportAt]: { sort: "desc", nulls: "last" } },
          select: {
            submittedAt: true,
            sentToOwnerAt: true,
            salesperson: { select: { name: true } },
          },
        }),
        prisma.bankReceipt.findFirst({
          where: receiptWhere,
          orderBy: { createdAt: "desc" },
          select: { createdAt: true, uploadedBy: { select: { name: true } } },
        }),
        prisma.stockLossReport.findFirst({
          where: lossWhere,
          orderBy: { createdAt: "desc" },
          select: { createdAt: true, reportedBy: { select: { name: true } } },
        }),
      ]),
    ]);

    const [newSale, newReport, newReceipt, newLoss] = newest;

    if (sales > 0) {
      out.push({
        kind: "SALES_TO_APPROVE",
        count: sales,
        tone: "action",
        href: "/sales",
        sample: [],
        latest: latestOf(
          newSale && { at: newSale.submittedAt, by: newSale.salesperson },
        ),
      });
    }

    if (reports > 0) {
      out.push({
        kind: "REPORTS_TO_APPROVE",
        count: reports,
        tone: "action",
        href: "/approvals",
        sample: [],
        latest: latestOf(
          newReport && {
            at: newReport[reportAt],
            by: newReport.salesperson,
          },
        ),
      });
    }

    if (receipts > 0) {
      out.push({
        kind: "RECEIPTS_TO_VERIFY",
        count: receipts,
        tone: "action",
        href: "/receipts",
        sample: [],
        latest: latestOf(
          newReceipt && { at: newReceipt.createdAt, by: newReceipt.uploadedBy },
        ),
      });
    }

    if (losses > 0) {
      out.push({
        kind: "LOSSES_TO_REVIEW",
        count: losses,
        tone: "action",
        href: "/damage-loss",
        sample: [],
        latest: latestOf(
          newLoss && { at: newLoss.createdAt, by: newLoss.reportedBy },
        ),
      });
    }
  }

  // A salesperson's own unfinished work.
  if (settings.notifySales && viewer.role === "SALES") {
    const [drafts, rejected] = await Promise.all([
      prisma.sale.count({
        where: { status: "DRAFT", salespersonId: viewer.userId },
      }),
      prisma.sale.count({
        where: { status: "REJECTED", salespersonId: viewer.userId },
      }),
    ]);

    if (drafts > 0) {
      out.push({
        kind: "MY_DRAFTS",
        count: drafts,
        tone: "action",
        href: "/sales",
        sample: [],
      });
    }

    if (rejected > 0) {
      out.push({
        kind: "MY_REJECTED",
        count: rejected,
        tone: "warn",
        href: "/sales",
        sample: [],
      });
    }
  }

  // Goods on the road to this supervisor's branch: they press Received once
  // the driver has unloaded, which is when the stock is counted in.
  if (viewer.role === "SUPERVISOR" && viewer.branchId) {
    const incoming = await prisma.stockTransfer.findMany({
      where: { status: "IN_TRANSIT", toLocationId: viewer.branchId },
      select: {
        directSend: true,
        shippedAt: true,
        driverName: true,
        fromLocation: { select: { name: true } },
        deliveredBy: { select: { name: true } },
      },
      orderBy: { shippedAt: "desc" },
    });

    if (incoming.length > 0) {
      out.push({
        kind: "DELIVERIES_TO_RECEIVE",
        count: incoming.length,
        tone: "action",
        // The Owner's own sends are received on their own page.
        href: incoming[0].directSend ? "/send" : "/transfers",
        sample: incoming
          .slice(0, 3)
          .map((row) => row.fromLocation.name + (row.driverName ? ` · ${row.driverName}` : "")),
        latest: incoming[0].shippedAt
          ? { at: incoming[0].shippedAt.toISOString(), by: incoming[0].deliveredBy?.name ?? "" }
          : undefined,
      });
    }
  }

  // A transfer finished: the goods arrived and were counted in. The Owner
  // hears about every one; a supervisor about those their branch sent.
  // Shown until Transfers is opened, or for three days.
  if (viewer.role === "OWNER" || (viewer.role === "SUPERVISOR" && viewer.branchId)) {
    const floor = new Date(Date.now() - DECIDED_SHOWN_FOR_MS);
    const since =
      options.transfersSeenAt && options.transfersSeenAt > floor
        ? options.transfersSeenAt
        : floor;

    const done = await prisma.stockTransfer.findMany({
      where: {
        status: "RECEIVED",
        receivedAt: { gt: since },
        ...(viewer.role === "SUPERVISOR" ? { fromLocationId: viewer.branchId! } : {}),
      },
      select: {
        receivedAt: true,
        fromLocation: { select: { name: true } },
        toLocation: { select: { name: true } },
        receivedBy: { select: { name: true } },
      },
      orderBy: { receivedAt: "desc" },
    });

    if (done.length > 0) {
      out.push({
        kind: "TRANSFERS_DONE",
        count: done.length,
        tone: "warn",
        href: "/transfers",
        sample: done.slice(0, 3).map((row) => `${row.fromLocation.name} → ${row.toLocation.name}`),
        latest: done[0].receivedAt
          ? { at: done[0].receivedAt.toISOString(), by: done[0].receivedBy?.name ?? "" }
          : undefined,
      });
    }
  }

  // National ID requests moving along: the supervisor sends them on, the
  // Owner prints or copies them, and the branch hears when they come back.
  if (viewer.role === "SUPERVISOR" && viewer.branchId) {
    const waiting = await prisma.nationalIdRequest.findMany({
      where: { status: "WITH_SUPERVISOR", locationId: viewer.branchId },
      select: { createdAt: true, total: true, kind: true, requestedBy: { select: { name: true } } },
      orderBy: { createdAt: "desc" },
    });
    if (waiting.length > 0) {
      out.push({
        kind: "NID_TO_FORWARD",
        count: waiting.length,
        tone: "action",
        href: waiting[0].kind === "COPY" ? "/national-id/copy" : "/national-id/original",
        sample: waiting.slice(0, 3).map((row) => `${row.requestedBy.name} · ${row.total}`),
        latest: { at: waiting[0].createdAt.toISOString(), by: waiting[0].requestedBy.name },
      });
    }
  }

  if (viewer.role === "OWNER") {
    const waiting = await prisma.nationalIdRequest.findMany({
      where: { status: "WITH_OWNER" },
      select: { forwardedAt: true, total: true, kind: true, location: { select: { name: true } }, forwardedBy: { select: { name: true } } },
      orderBy: { forwardedAt: "desc" },
    });
    if (waiting.length > 0) {
      out.push({
        kind: "NID_TO_PRINT",
        count: waiting.length,
        tone: "action",
        href: waiting[0].kind === "COPY" ? "/national-id/copy" : "/national-id/original",
        sample: waiting.slice(0, 3).map((row) => `${row.location.name} · ${row.total}`),
        latest: waiting[0].forwardedAt
          ? { at: waiting[0].forwardedAt.toISOString(), by: waiting[0].forwardedBy?.name ?? "" }
          : undefined,
      });
    }
  }

  if ((viewer.role === "SALES" || viewer.role === "SUPERVISOR") && viewer.branchId) {
    const floor = new Date(Date.now() - DECIDED_SHOWN_FOR_MS);
    const since = options.nidSeenAt && options.nidSeenAt > floor ? options.nidSeenAt : floor;
    const back = await prisma.nationalIdRequest.findMany({
      where: {
        // Still news to the salesperson after their supervisor marks it received.
        status: viewer.role === "SALES" ? { in: ["RETURNED", "RECEIVED"] } : "RETURNED",
        returnedAt: { gt: since },
        ...(viewer.role === "SALES" ? { requestedById: viewer.userId } : { locationId: viewer.branchId }),
      },
      select: { returnedAt: true, kind: true, doneCount: true, leftoverCount: true, returnedBy: { select: { name: true } } },
      orderBy: { returnedAt: "desc" },
    });
    if (back.length > 0) {
      out.push({
        kind: "NID_RETURNED",
        count: back.length,
        tone: "warn",
        href: back[0].kind === "COPY" ? "/national-id/copy" : "/national-id/original",
        sample: back.slice(0, 3).map((row) => `${row.doneCount ?? 0} done · ${row.leftoverCount ?? 0} left`),
        latest: back[0].returnedAt
          ? { at: back[0].returnedAt.toISOString(), by: back[0].returnedBy?.name ?? "" }
          : undefined,
      });
    }
  }

  // Expenses the branches recorded since the Owner last opened Expenses.
  if (viewer.role === "OWNER") {
    const floor = new Date(Date.now() - DECIDED_SHOWN_FOR_MS);
    const since =
      options.expensesSeenAt && options.expensesSeenAt > floor ? options.expensesSeenAt : floor;

    const added = await prisma.expense.findMany({
      where: { createdAt: { gt: since } },
      select: {
        createdAt: true,
        amount: true,
        reason: true,
        location: { select: { name: true } },
        recordedBy: { select: { name: true } },
      },
      orderBy: { createdAt: "desc" },
    });

    if (added.length > 0) {
      out.push({
        kind: "EXPENSES_ADDED",
        count: added.length,
        tone: "warn",
        href: "/expenses",
        sample: added.slice(0, 3).map((row) => `${row.location.name} · ${row.reason} · ${Number(row.amount)}`),
        latest: { at: added[0].createdAt.toISOString(), by: added[0].recordedBy.name },
      });
    }
  }

  // Goods the supervisor has handed a salesperson, waiting for them to press
  // Received. Stays until they do, like a delivery to a branch.
  if (viewer.role === "SALES") {
    const toReceive = await prisma.stockRequest.findMany({
      where: {
        requestedById: viewer.userId,
        kind: "ISSUE",
        status: { in: ["PENDING", "APPROVED"] },
        items: { some: { approvedQuantity: { gt: 0 }, receivedAt: null } },
      },
      select: { reviewedAt: true, approvedBy: { select: { name: true } } },
      orderBy: { reviewedAt: "desc" },
    });
    if (toReceive.length > 0) {
      out.push({
        kind: "ISSUES_TO_RECEIVE",
        count: toReceive.length,
        tone: "action",
        href: "/requests",
        sample: [],
        latest: toReceive[0].reviewedAt
          ? { at: toReceive[0].reviewedAt.toISOString(), by: toReceive[0].approvedBy?.name ?? "" }
          : undefined,
      });
    }
  }

  // A salesperson hearing back about their own morning issue or evening
  // return. Shown until they open the Requests page, or for three days.
  if (viewer.role === "SALES") {
    const floor = new Date(Date.now() - DECIDED_SHOWN_FOR_MS);
    const since =
      options.requestsSeenAt && options.requestsSeenAt > floor
        ? options.requestsSeenAt
        : floor;

    const decided = await prisma.stockRequest.findMany({
      where: {
        requestedById: viewer.userId,
        status: { in: ["APPROVED", "FULFILLED", "REJECTED"] },
        reviewedAt: { gt: since },
      },
      select: {
        status: true,
        reviewedAt: true,
        rejectionReason: true,
        approvedBy: { select: { name: true } },
      },
      orderBy: { reviewedAt: "desc" },
    });

    const approved = decided.filter((row) => row.status !== "REJECTED");
    const rejected = decided.filter((row) => row.status === "REJECTED");
    const latest = (row: (typeof decided)[number] | undefined) =>
      row?.reviewedAt
        ? { at: row.reviewedAt.toISOString(), by: row.approvedBy?.name ?? "" }
        : undefined;

    if (approved.length > 0) {
      out.push({
        kind: "MY_REQUEST_APPROVED",
        count: approved.length,
        tone: "action",
        href: "/requests",
        sample: [],
        latest: latest(approved[0]),
      });
    }

    if (rejected.length > 0) {
      out.push({
        kind: "MY_REQUEST_REJECTED",
        count: rejected.length,
        tone: "action",
        href: "/requests",
        // The reason is the useful part: it says what to do next.
        sample: rejected
          .map((row) => row.rejectionReason ?? "")
          .filter(Boolean)
          .slice(0, 2),
        latest: latest(rejected[0]),
      });
    }
  }

  // What the salesperson is carrying, which is what decides whether the next
  // customer is served. The branch's own shelves are the supervisor's problem
  // and are warned about separately below.
  if (settings.notifyLowStock && viewer.role === "SALES") {
    const level: Record<string, number> = {
      SIM_CARD: settings.lowHoldingSim,
      PHONE: settings.lowHoldingPhone,
      AIRTIME_VOUCHER: settings.lowHoldingVoucher,
    };

    const since = new Date();
    since.setHours(0, 0, 0, 0);

    // Only goods they took out today: yesterday's empty rows are not news.
    const issuedToday = await prisma.stockRequestItem.findMany({
      where: {
        request: {
          kind: "ISSUE",
          status: "APPROVED",
          requestedById: viewer.userId,
          reviewedAt: { gte: since },
        },
      },
      select: { productId: true },
    });

    const taken = new Set(issuedToday.map((item) => item.productId));

    const holdings = taken.size
      ? await prisma.salespersonHolding.findMany({
          where: { userId: viewer.userId, productId: { in: [...taken] } },
          select: {
            quantity: true,
            product: { select: { name: true, category: true } },
          },
        })
      : [];

    const running = holdings
      .filter(
        (holding) =>
          holding.quantity <= (level[holding.product.category] ?? 0),
      )
      .sort((a, b) => a.quantity - b.quantity);

    if (running.length > 0) {
      out.push({
        kind: "MY_STOCK_LOW",
        count: running.length,
        tone: "warn",
        href: "/holdings",
        // Named with the number left, so the person can see at a glance
        // which one to ask for.
        sample: running
          .slice(0, 3)
          .map((holding) => `${holding.product.name} (${holding.quantity})`),
      });
    }
  }

  if (settings.notifyLowStock && viewer.role !== "SALES") {
    // Same rule and the same scoping the dashboard uses, so the two can never
    // disagree about what counts as low.
    const low = await getLowStock(viewer, 20);

    if (low.length > 0) {
      out.push({
        kind: "LOW_STOCK",
        count: low.length,
        tone: "warn",
        href: "/inventory",
        // The Owner sees the same product low at several branches, so the
        // branch is what tells those rows apart.
        sample: low
          .slice(0, 3)
          .map((row) => (isOwner ? `${row.name} · ${row.branch}` : row.name)),
      });
    }

    // Blank ID cards, for branches that have started tracking them.
    const scope = isOwner ? {} : { locationId: branchId };

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
      prisma.stockLocation.findMany({
        where: { isActive: true, ...(isOwner ? {} : { id: branchId }) },
        select: { id: true, name: true },
      }),
    ]);

    const printedBy = new Map(printed.map((r) => [r.locationId, r._sum]));
    const nameOf = new Map(branches.map((b) => [b.id, b.name]));

    const running = received
      .map((row) => {
        const used = printedBy.get(row.locationId);

        return {
          name: nameOf.get(row.locationId) ?? "—",
          original: (row._sum.originalAdded ?? 0) - (used?.originalCount ?? 0),
          copy: (row._sum.copyAdded ?? 0) - (used?.copyCount ?? 0),
        };
      })
      .filter((row) => row.original <= LOW_BLANKS || row.copy <= LOW_BLANKS);

    if (running.length > 0) {
      out.push({
        kind: "LOW_BLANKS",
        count: running.length,
        tone: "warn",
        href: "/national-id",
        sample: running.slice(0, 3).map((row) => row.name),
      });
    }
  }

  return {
    notifications: out,
    // Things needing a decision drive the badge; warnings are shown but do
    // not nag, so a permanently low shelf does not sit on a red dot forever.
    actionCount: out
      .filter((item) => item.tone === "action")
      .reduce((sum, item) => sum + item.count, 0),
    total: out.reduce((sum, item) => sum + item.count, 0),
  };
}

import webpush from "web-push";

import { env } from "../../config/env.js";
import type { Viewer } from "../../middleware/auth.js";
import { prisma } from "../../plugins/prisma.js";
import {
  getNotifications,
  type NotificationKind,
} from "../notifications/notification.service.js";

/**
 * Phone notifications for the Owner and supervisors, delivered with the app
 * closed.
 *
 * Nothing in the rest of the API calls this. The bell's to-do list is already
 * derived from live data, so once a minute each subscribed user's list is
 * worked out again and a push goes out when it has grown or something newer
 * has arrived. Every module that creates work is covered without being
 * touched.
 */

export const PUSH_ROLES = new Set(["OWNER", "SUPERVISOR"]);

const configured = Boolean(env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY);

if (configured) {
  webpush.setVapidDetails(
    env.VAPID_SUBJECT,
    env.VAPID_PUBLIC_KEY!,
    env.VAPID_PRIVATE_KEY!,
  );
}

export function publicKey() {
  return configured ? env.VAPID_PUBLIC_KEY! : null;
}

// The same sentences the bell shows, in both of the app's languages.
const TEXT: Record<"en" | "am", Partial<Record<NotificationKind, string>>> = {
  en: {
    REQUESTS_TO_DECIDE: "{n} stock requests to decide",
    ITEMS_TO_ISSUE: "{n} sellers waiting for items",
    RETURNS_TO_CONFIRM: "{n} returns to count in",
    SALES_TO_APPROVE: "{n} sales to approve",
    REPORTS_TO_APPROVE: "{n} cash reports to approve",
    RECEIPTS_TO_VERIFY: "{n} receipts to verify",
    LOSSES_TO_REVIEW: "{n} loss reports to review",
    DELIVERIES_TO_RECEIVE: "{n} deliveries on the way — press Received when they arrive",
    NID_TO_FORWARD: "{n} National ID requests to send to the Owner",
    NID_TO_PRINT: "{n} National ID requests to print or copy",
  },
  am: {
    REQUESTS_TO_DECIDE: "{n} የክምችት ጥያቄዎች ውሳኔ ይጠብቃሉ",
    ITEMS_TO_ISSUE: "{n} ሻጮች ዕቃ እየጠበቁ ነው",
    RETURNS_TO_CONFIRM: "{n} የሚመለሱ ዕቃዎች ቆጠራ ይጠብቃሉ",
    SALES_TO_APPROVE: "{n} ሽያጮች ይሁንታ ይጠብቃሉ",
    REPORTS_TO_APPROVE: "{n} የገንዘብ ሪፖርቶች ይሁንታ ይጠብቃሉ",
    RECEIPTS_TO_VERIFY: "{n} ደረሰኞች ማረጋገጫ ይጠብቃሉ",
    LOSSES_TO_REVIEW: "{n} የጉዳት ሪፖርቶች ግምገማ ይጠብቃሉ",
    DELIVERIES_TO_RECEIVE: "{n} ዕቃዎች በመንገድ ላይ ናቸው — ሲደርሱ ተቀብያለሁ ይጫኑ",
    NID_TO_FORWARD: "{n} የብሔራዊ መታወቂያ ጥያቄዎች ወደ ባለቤቱ ለመላክ",
    NID_TO_PRINT: "{n} የብሔራዊ መታወቂያ ጥያቄዎች ለማተም ወይም ለመቅዳት",
  },
};

const FROM = { en: "From {by}", am: "ከ{by}" };
const TURNED_ON = {
  en: "Notifications are on. New work will show here.",
  am: "ማሳወቂያዎች በርተዋል። አዲስ ሥራ እዚህ ይታያል።",
};

function langOf(value: string): "en" | "am" {
  return value === "am" ? "am" : "en";
}

type Payload = { title: string; body: string; url: string; count: number };

/** What is waiting on this person now, and when the newest of it arrived. */
async function snapshot(viewer: Viewer) {
  const { notifications, actionCount } = await getNotifications(viewer);
  const actions = notifications.filter((item) => item.tone === "action");

  // The item that arrived last is the one worth naming in the message.
  const newest = actions
    .filter((item) => item.latest)
    .sort((a, b) => b.latest!.at.localeCompare(a.latest!.at))[0];

  return {
    actions,
    actionCount,
    newest,
    newestAt: newest?.latest ? new Date(newest.latest.at) : null,
  };
}

async function send(
  subscription: { id: string; endpoint: string; p256dh: string; auth: string },
  payload: Payload,
) {
  try {
    await webpush.sendNotification(
      {
        endpoint: subscription.endpoint,
        keys: { p256dh: subscription.p256dh, auth: subscription.auth },
      },
      JSON.stringify(payload),
      { TTL: 60 * 60 * 12 },
    );
  } catch (error) {
    // 404/410: the phone uninstalled the app or turned notifications off.
    const status = (error as { statusCode?: number }).statusCode;

    if (status === 404 || status === 410) {
      await prisma.pushSubscription
        .delete({ where: { id: subscription.id } })
        .catch(() => {});
    }
  }
}

/**
 * Saves this phone for this user. The current to-do list is recorded as
 * already seen, so turning notifications on does not replay old work; a
 * confirmation is pushed instead, which proves the whole path works.
 */
export async function subscribe(
  viewer: Viewer,
  data: { endpoint: string; p256dh: string; auth: string; lang: string },
) {
  const now = await snapshot(viewer);
  const lang = langOf(data.lang);

  // A shared phone moves to whoever turned it on last.
  const subscription = await prisma.pushSubscription.upsert({
    where: { endpoint: data.endpoint },
    create: {
      userId: viewer.userId,
      endpoint: data.endpoint,
      p256dh: data.p256dh,
      auth: data.auth,
      lang,
      lastCount: now.actionCount,
      lastLatestAt: now.newestAt,
    },
    update: {
      userId: viewer.userId,
      p256dh: data.p256dh,
      auth: data.auth,
      lang,
      lastCount: now.actionCount,
      lastLatestAt: now.newestAt,
    },
  });

  await send(subscription, {
    title: "AntiLog",
    body: TURNED_ON[lang],
    url: "/dashboard",
    count: now.actionCount,
  });
}

export async function unsubscribe(endpoint: string) {
  await prisma.pushSubscription.deleteMany({ where: { endpoint } });
}

let running = false;

/** One pass over every subscribed user. Called every minute. */
export async function checkAndPush() {
  if (!configured || running) return;
  running = true;

  try {
    const subscriptions = await prisma.pushSubscription.findMany({
      include: {
        user: { select: { id: true, role: true, branchId: true, isActive: true } },
      },
    });

    const byUser = new Map<string, typeof subscriptions>();
    for (const row of subscriptions) {
      byUser.set(row.userId, [...(byUser.get(row.userId) ?? []), row]);
    }

    for (const rows of byUser.values()) {
      const user = rows[0].user;

      // A deactivated user or a demoted role stops hearing about the branch.
      if (!user.isActive || !PUSH_ROLES.has(user.role)) {
        await prisma.pushSubscription.deleteMany({
          where: { id: { in: rows.map((row) => row.id) } },
        });
        continue;
      }

      const now = await snapshot({
        userId: user.id,
        role: user.role,
        branchId: user.branchId,
      });

      for (const row of rows) {
        const grew = now.actionCount > row.lastCount;
        const newer =
          now.newestAt != null &&
          (row.lastLatestAt == null || now.newestAt > row.lastLatestAt);

        if (now.actionCount > 0 && (grew || newer)) {
          const lang = langOf(row.lang);
          const lead = now.newest ?? now.actions[0];
          const line = (TEXT[lang][lead.kind] ?? "{n}").replace(
            "{n}",
            String(lead.count),
          );

          await send(row, {
            title: "AntiLog",
            body: lead.latest
              ? `${line} · ${FROM[lang].replace("{by}", lead.latest.by)}`
              : line,
            url: lead.href,
            count: now.actionCount,
          });
        }

        // Always recorded, so a count that went down and comes back up
        // is heard about again.
        if (
          row.lastCount !== now.actionCount ||
          row.lastLatestAt?.getTime() !== now.newestAt?.getTime()
        ) {
          await prisma.pushSubscription.update({
            where: { id: row.id },
            data: { lastCount: now.actionCount, lastLatestAt: now.newestAt },
          });
        }
      }
    }
  } finally {
    running = false;
  }
}

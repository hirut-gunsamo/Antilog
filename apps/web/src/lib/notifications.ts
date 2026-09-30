import { useEffect, useRef, useState } from 'react'

import { api } from './api'
import type { Notification, NotificationKind, Notifications } from './types'

/** A new request reaches a supervisor within about half a minute. */
const POLL_MS = 30_000

/** When this device last opened the Requests page. */
const SEEN_KEY = 'sim.requestsSeen'
/** When this device last opened the Transfers page. */
const TRANSFERS_SEEN_KEY = 'sim.transfersSeen'
/** When this device last opened the Expenses page. */
const EXPENSES_SEEN_KEY = 'sim.expensesSeen'
/** When this device last opened Original ID or Copy ID. */
const NID_SEEN_KEY = 'sim.nidSeen'

function readKey(key: string) {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

/**
 * What is waiting on the signed-in user, kept fresh.
 *
 * Notifications are derived from live data on the server, so acting on
 * something clears it. Refetching whenever the page changes means the badge
 * drops as soon as the person comes back from approving, without waiting for
 * the next poll.
 */
export function useNotifications(pathname: string) {
  const [data, setData] = useState<Notifications | null>(null)

  useEffect(() => {
    const controller = new AbortController()

    // Opening Requests counts as having seen every decision on it, so a
    // salesperson's "approved" or "rejected" notice clears once they look.
    const seenPage =
      pathname === '/requests'
        ? SEEN_KEY
        : pathname === '/transfers'
          ? TRANSFERS_SEEN_KEY
          : pathname === '/expenses'
            ? EXPENSES_SEEN_KEY
            : pathname.startsWith('/national-id/')
              ? NID_SEEN_KEY
              : null
    if (seenPage) {
      try {
        localStorage.setItem(seenPage, new Date().toISOString())
      } catch {
        // Without storage the notice simply lasts its three days.
      }
    }

    function load() {
      const params = new URLSearchParams()
      const seen = readKey(SEEN_KEY)
      const transfersSeen = readKey(TRANSFERS_SEEN_KEY)
      if (seen) params.set('requestsSeen', seen)
      if (transfersSeen) params.set('transfersSeen', transfersSeen)
      const expensesSeen = readKey(EXPENSES_SEEN_KEY)
      if (expensesSeen) params.set('expensesSeen', expensesSeen)
      const nidSeen = readKey(NID_SEEN_KEY)
      if (nidSeen) params.set('nidSeen', nidSeen)

      const query = params.size ? `?${params}` : ''

      api<Notifications>(`/api/notifications${query}`, { signal: controller.signal })
        .then(setData)
        // A failed poll keeps the last good answer rather than blanking the
        // bell; the next one will try again.
        .catch(() => {})
    }

    load()

    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') load()
    }, POLL_MS)

    window.addEventListener('focus', load)

    return () => {
      controller.abort()
      window.clearInterval(timer)
      window.removeEventListener('focus', load)
    }
  }, [pathname])

  return data
}

/** A notification known to carry who sent its newest item. */
export type Arrival = Notification & { latest: { at: string; by: string } }

/** The decisions worth interrupting a supervisor for. */
const ALERT_KINDS = new Set<NotificationKind>([
  'REQUESTS_TO_DECIDE',
  'ITEMS_TO_ISSUE',
  'RETURNS_TO_CONFIRM',
  'SALES_TO_APPROVE',
  'REPORTS_TO_APPROVE',
  'RECEIPTS_TO_VERIFY',
  'LOSSES_TO_REVIEW',
])

/**
 * Calls `onArrival` for each kind whose newest item arrived since the last
 * poll.
 *
 * Tracks the newest arrival time rather than the count, so a new request is
 * still noticed when another was approved in the same minute and the count
 * did not change. The first answer after sign-in only sets the baseline:
 * what was already waiting is on the badge, not worth a pop-up each.
 */
export function useArrivalAlerts(
  data: Notifications | null,
  enabled: boolean,
  onArrival: (item: Arrival) => void,
) {
  const seen = useRef<Map<NotificationKind, string> | null>(null)

  useEffect(() => {
    if (!data || !enabled) return

    const first = seen.current === null
    const map = seen.current ?? new Map<NotificationKind, string>()

    for (const item of data.notifications) {
      if (!ALERT_KINDS.has(item.kind) || !item.latest) continue

      const before = map.get(item.kind)

      // ISO timestamps compare correctly as strings.
      if (before && item.latest.at <= before) continue

      map.set(item.kind, item.latest.at)

      if (!first) onArrival({ ...item, latest: item.latest })
    }

    seen.current = map
  }, [data, enabled, onArrival])
}

import type { Activity } from './types'

/** Corrections and write-offs compete for one slot, as one kind of news. */
function group(item: Activity) {
  return item.kind === 'ADJUSTMENT' || item.kind === 'LOSS'
    ? 'CORRECTION'
    : item.kind
}

/**
 * Picks `limit` rows so that every kind with recent news gets a line before
 * any kind gets a second one, then shows them newest first.
 *
 * Without this, one busy morning of stock corrections pushes every sale off a
 * four-line card. Groups take turns in order of their newest item, so the
 * freshest kind still leads.
 */
export function mixActivities(items: Activity[], limit: number) {
  const groups = new Map<string, Activity[]>()

  for (const item of [...items].sort((a, b) => b.at.localeCompare(a.at))) {
    const key = group(item)
    groups.set(key, [...(groups.get(key) ?? []), item])
  }

  const queues = [...groups.values()]
  const picked: Activity[] = []

  while (picked.length < limit && queues.some((queue) => queue.length > 0)) {
    for (const queue of queues) {
      const next = queue.shift()
      if (next) picked.push(next)
      if (picked.length === limit) break
    }
  }

  return picked.sort((a, b) => b.at.localeCompare(a.at))
}

import { useEffect, useState } from 'react'

// Per-browser display preferences. There is no settings table on the server,
// so these live in localStorage and belong to this browser only — the Settings
// page says so rather than implying they follow the account.
//
// A custom event carries changes to every mounted component, so choosing a new
// value on Settings takes effect on the tables immediately rather than on the
// next reload.

const KEY = 'sim.prefs'
const CHANGED = 'sim.prefs.changed'

export type Prefs = {
  /** Rows per page in every paginated table. */
  pageSize: number
}

export const PAGE_SIZES = [10, 20, 50, 100] as const

export const DEFAULT_PREFS: Prefs = {
  pageSize: 10,
}

export function readPrefs(): Prefs {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return DEFAULT_PREFS

    const parsed = JSON.parse(raw) as Partial<Prefs>
    const pageSize = Number(parsed.pageSize)

    return {
      pageSize: (PAGE_SIZES as readonly number[]).includes(pageSize)
        ? pageSize
        : DEFAULT_PREFS.pageSize,
    }
  } catch {
    // Private windows, blocked site data and malformed JSON all land here.
    return DEFAULT_PREFS
  }
}

export function writePrefs(next: Prefs) {
  try {
    localStorage.setItem(KEY, JSON.stringify(next))
  } catch {
    // Not fatal: the choice simply will not survive a reload.
  }

  window.dispatchEvent(new CustomEvent(CHANGED))
}

/** Re-renders when the preference changes, wherever it was changed. */
export function usePrefs(): Prefs {
  const [prefs, setPrefs] = useState<Prefs>(() => readPrefs())

  useEffect(() => {
    function sync() {
      setPrefs(readPrefs())
    }

    window.addEventListener(CHANGED, sync)
    // Another tab writing the same key fires `storage`, not our event.
    window.addEventListener('storage', sync)

    return () => {
      window.removeEventListener(CHANGED, sync)
      window.removeEventListener('storage', sync)
    }
  }, [])

  return prefs
}

/** Shorthand for the paginated tables. */
export function usePageSize() {
  return usePrefs().pageSize
}

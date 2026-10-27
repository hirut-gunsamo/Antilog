import { useEffect, useState } from 'react'

/**
 * A filter the person picked (a date, a range) kept in this browser, so it is
 * still chosen after a reload or a visit to another page.
 */
export function useSavedState(key: string, initial: string | (() => string)) {
  const storageKey = `antilog:${key}`
  const [value, setValue] = useState<string>(() => {
    try {
      const saved = localStorage.getItem(storageKey)
      if (saved !== null) return saved
    } catch {
      // Storage blocked: fall back to the default.
    }
    return typeof initial === 'function' ? initial() : initial
  })

  useEffect(() => {
    try {
      localStorage.setItem(storageKey, value)
    } catch {
      // Storage blocked: the choice lasts until the page closes.
    }
  }, [storageKey, value])

  return [value, setValue] as const
}

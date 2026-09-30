import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'

import { api } from '../lib/api'
import { setCurrency } from '../lib/format'
import { DEFAULT_SETTINGS, SettingsContext } from '../lib/settings'
import type { AppSettings } from '../lib/types'

/**
 * Loads the organisation's settings once and shares them.
 *
 * Reading requires a session, so this is mounted only inside the protected
 * shell. Until the fetch lands the defaults are used — the same values the
 * server's own column defaults carry, so nothing jumps when it arrives.
 */
export function SettingsProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const controller = new AbortController()

    api<{ settings: AppSettings }>('/api/settings', {
      signal: controller.signal,
    })
      .then((payload) => {
        setSettings(payload.settings)
        // currency() reads a module variable, so this has to be pushed rather
        // than passed down.
        setCurrency(payload.settings.currency)
        setLoading(false)
      })
      .catch(() => {
        // The defaults stand; a failed settings read must not block the app.
        setLoading(false)
      })

    return () => controller.abort()
  }, [])

  // The browser tab is the one place the system name has to be written by hand.
  useEffect(() => {
    document.title = settings.systemName
  }, [settings.systemName])

  const update = useCallback((next: AppSettings) => {
    setSettings(next)
    setCurrency(next.currency)
  }, [])

  const value = useMemo(
    () => ({ settings, setSettings: update, loading }),
    [settings, update, loading],
  )

  return (
    <SettingsContext.Provider value={value}>
      {children}
    </SettingsContext.Provider>
  )
}

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'

import { api, ApiError, setToken, getToken } from '../lib/api'
import type { CurrentUser } from '../lib/types'
import { AuthContext } from './context'

// The last profile the server confirmed, kept so the installed app can open
// with no connection. It is only ever shown, never trusted: the server checks
// the token on every request, so a stale copy cannot widen anyone's access.
const PROFILE_KEY = 'sim.profile'

function saveProfile(user: CurrentUser | null) {
  try {
    if (user) localStorage.setItem(PROFILE_KEY, JSON.stringify(user))
    else localStorage.removeItem(PROFILE_KEY)
  } catch {
    // Without storage the app simply cannot open offline.
  }
}

function savedProfile(): CurrentUser | null {
  try {
    const raw = localStorage.getItem(PROFILE_KEY)
    return raw ? (JSON.parse(raw) as CurrentUser) : null
  } catch {
    return null
  }
}

/**
 * Reads the profile the current token belongs to.
 *
 * The profile is always re-read from the server rather than decoded from the
 * token: a user moved between branches, or deactivated, must not keep stale
 * access until their token expires.
 *
 * Only the server saying no signs the person out. Not reaching the server
 * (offline, or the API down) keeps the token and falls back to the saved
 * profile; otherwise opening the app offline would sign people out and strand
 * the sales they queued while offline.
 */
async function fetchMe(): Promise<CurrentUser | null> {
  try {
    const { user } = await api<{ user: CurrentUser }>('/api/users/me')
    saveProfile(user)
    return user
  } catch (caught) {
    // 401/403: token rejected or account disabled; 404: account removed.
    if (caught instanceof ApiError && [401, 403, 404].includes(caught.status)) {
      setToken(null)
      saveProfile(null)
      return null
    }

    return savedProfile()
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<CurrentUser | null>(null)

  // Seeded from the token rather than defaulting to true, so a signed-out
  // visitor renders the login screen on the first paint instead of a spinner
  // that resolves to nothing.
  const [loading, setLoading] = useState(() => getToken() != null)

  const refresh = useCallback(async () => {
    if (!getToken()) {
      setUser(null)
      setLoading(false)
      return
    }

    setUser(await fetchMe())
    setLoading(false)
  }, [])

  useEffect(() => {
    // With no token the seeded state is already right, so there is nothing to
    // read and nothing to set.
    if (!getToken()) return

    let cancelled = false

    void fetchMe().then((me) => {
      if (cancelled) return

      setUser(me)
      setLoading(false)
    })

    return () => {
      cancelled = true
    }
  }, [])

  const login = useCallback(
    async (email: string, password: string) => {
      const { token } = await api<{ token: string }>('/api/auth/login', {
        method: 'POST',
        body: { email, password },
      })

      setToken(token)
      await refresh()
    },
    [refresh],
  )

  const logout = useCallback(() => {
    setToken(null)
    saveProfile(null)
    setUser(null)
  }, [])

  const value = useMemo(
    () => ({ user, loading, login, logout, refresh }),
    [user, loading, login, logout, refresh],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

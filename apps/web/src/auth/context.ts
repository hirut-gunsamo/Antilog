import { createContext, useContext } from 'react'

import type { CurrentUser } from '../lib/types'

export type AuthState = {
  user: CurrentUser | null
  loading: boolean
  login: (email: string, password: string) => Promise<void>
  logout: () => void
  refresh: () => Promise<void>
}

// The context and its hook live apart from the provider component so that the
// file holding the component exports nothing but components, which is what
// Fast Refresh needs to swap it without remounting the tree.
export const AuthContext = createContext<AuthState | null>(null)

export function useAuth() {
  const context = useContext(AuthContext)

  if (!context) {
    throw new Error('useAuth must be used inside AuthProvider')
  }

  return context
}

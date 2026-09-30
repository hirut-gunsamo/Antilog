// Theme choice, kept in one place because three things have to agree: the
// inline script in index.html that runs before paint, this module, and the
// [data-theme] rules in index.css.
//
// "system" means no stamp at all, which lets the prefers-color-scheme media
// query in index.css decide. "light" and "dark" stamp the root element and
// win over it in either direction.

const KEY = 'sim.theme'

export const THEMES = ['light', 'dark', 'system'] as const

export type Theme = (typeof THEMES)[number]

function isTheme(value: unknown): value is Theme {
  return typeof value === 'string' && (THEMES as readonly string[]).includes(value)
}

export function readTheme(): Theme {
  try {
    const stored = localStorage.getItem(KEY)
    return isTheme(stored) ? stored : 'system'
  } catch {
    // Private windows and blocked site data both throw here.
    return 'system'
  }
}

export function applyTheme(theme: Theme) {
  const root = document.documentElement

  if (theme === 'system') delete root.dataset.theme
  else root.dataset.theme = theme

  try {
    if (theme === 'system') localStorage.removeItem(KEY)
    else localStorage.setItem(KEY, theme)
  } catch {
    // Not fatal: the choice simply will not survive a reload.
  }
}

/** What the page is actually showing, once "system" is resolved. */
export function resolveTheme(theme: Theme): 'light' | 'dark' {
  if (theme !== 'system') return theme

  try {
    return window.matchMedia('(prefers-color-scheme: dark)').matches
      ? 'dark'
      : 'light'
  } catch {
    return 'light'
  }
}

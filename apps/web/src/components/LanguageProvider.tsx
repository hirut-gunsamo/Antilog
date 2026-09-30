import { useCallback, useMemo, useState, type ReactNode } from 'react'

import {
  LanguageContext,
  readLang,
  storeLang,
  translate,
  type Lang,
} from '../lib/i18n'

/**
 * Holds the chosen language and hands every component the lookup.
 *
 * The inline script in index.html has already set <html lang> before paint, so
 * reading here only recovers the same choice rather than deciding it again.
 */
export function LanguageProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(() => readLang())

  const setLang = useCallback((next: Lang) => {
    setLangState(next)
    storeLang(next)
  }, [])

  const value = useMemo(
    () => ({
      lang,
      setLang,
      t: (key: Parameters<typeof translate>[1], vars?: Parameters<typeof translate>[2]) =>
        translate(lang, key, vars),
    }),
    [lang, setLang],
  )

  return (
    <LanguageContext.Provider value={value}>
      {children}
    </LanguageContext.Provider>
  )
}

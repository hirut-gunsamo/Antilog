import { useEffect, useRef, useState } from 'react'

import { LANGS, LANG_LABEL, useLang, type Lang } from '../lib/i18n'
import styles from './ThemeToggle.module.css'

// The two-letter code is the affordance: short enough for the header, and
// unambiguous next to the theme icon.
const SHORT: Record<Lang, string> = { en: 'EN', am: 'አማ' }

export function LanguageToggle() {
  const { lang, setLang, t } = useLang()
  const [open, setOpen] = useState(false)

  const wrapRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!open) return

    function onDown(event: MouseEvent) {
      if (!wrapRef.current?.contains(event.target as Node)) setOpen(false)
    }

    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') setOpen(false)
    }

    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)

    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  return (
    <div className={styles.wrap} ref={wrapRef}>
      <button
        className={`${styles.button} ${styles.langButton}`}
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`${t('lang.label')}: ${LANG_LABEL[lang]}. ${t('lang.change')}`}
        title={`${t('lang.label')}: ${LANG_LABEL[lang]}`}
      >
        {SHORT[lang]}
      </button>

      {open ? (
        <div className={styles.menu} role="menu">
          {LANGS.map((option) => (
            <button
              key={option}
              type="button"
              role="menuitemradio"
              aria-checked={lang === option}
              className={lang === option ? styles.on : undefined}
              onClick={() => {
                setLang(option)
                setOpen(false)
              }}
            >
              <span className={styles.langCode}>{SHORT[option]}</span>
              {LANG_LABEL[option]}
              {lang === option ? (
                <span className={styles.tick} aria-hidden="true">
                  ✓
                </span>
              ) : null}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  )
}

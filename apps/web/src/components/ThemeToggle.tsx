import { useEffect, useRef, useState } from 'react'

import { icons } from './icons'
import { useT, type TranslationKey } from '../lib/i18n'
import { applyTheme, readTheme, resolveTheme, type Theme } from '../lib/theme'
import styles from './ThemeToggle.module.css'

const OPTIONS: {
  value: Theme
  labelKey: TranslationKey
  icon: keyof typeof icons
}[] = [
  { value: 'light', labelKey: 'theme.light', icon: 'sun' },
  { value: 'dark', labelKey: 'theme.dark', icon: 'moon' },
  { value: 'system', labelKey: 'theme.system', icon: 'monitor' },
]

function Icon({ name, size = 17 }: { name: keyof typeof icons; size?: number }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {icons[name].map((d, index) => (
        <path key={index} d={d} />
      ))}
    </svg>
  )
}

export function ThemeToggle() {
  const t = useT()
  // The inline script in index.html has already stamped the root, so reading
  // here just recovers the same choice rather than deciding it again.
  const [theme, setTheme] = useState<Theme>(() => readTheme())
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

  // On "system", follow the OS if it changes while the page is open.
  useEffect(() => {
    if (theme !== 'system') return

    let media: MediaQueryList

    try {
      media = window.matchMedia('(prefers-color-scheme: dark)')
    } catch {
      return
    }

    function onChange() {
      applyTheme('system')
    }

    media.addEventListener('change', onChange)
    return () => media.removeEventListener('change', onChange)
  }, [theme])

  function choose(next: Theme) {
    setTheme(next)
    applyTheme(next)
    setOpen(false)
  }

  const showing = resolveTheme(theme)
  const current = OPTIONS.find((option) => option.value === theme)

  return (
    <div className={styles.wrap} ref={wrapRef}>
      <button
        className={styles.button}
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`${t('theme.label')}: ${
          current ? t(current.labelKey) : t('theme.system')
        }. ${t('theme.change')}`}
        title={`${t('theme.label')}: ${
          current ? t(current.labelKey) : t('theme.system')
        }`}
      >
        <Icon name={showing === 'dark' ? 'moon' : 'sun'} />
      </button>

      {open ? (
        <div className={styles.menu} role="menu">
          {OPTIONS.map((option) => (
            <button
              key={option.value}
              type="button"
              role="menuitemradio"
              aria-checked={theme === option.value}
              className={theme === option.value ? styles.on : undefined}
              onClick={() => choose(option.value)}
            >
              <Icon name={option.icon} size={15} />
              {t(option.labelKey)}
              {theme === option.value ? (
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

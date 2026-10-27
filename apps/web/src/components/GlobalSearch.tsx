import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'

import { useT } from '../lib/i18n'
import { icons } from './icons'
import toggle from './ThemeToggle.module.css'
import styles from './GlobalSearch.module.css'

export type SearchPage = { to: string; label: string; note?: string }

function SearchIcon({ size = 17 }: { size?: number }) {
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
      {icons.search.map((d, index) => (
        <path key={index} d={d} />
      ))}
    </svg>
  )
}

/**
 * The header's search: one box that narrows the tables on this page and
 * offers the pages whose names match, to jump to. The term stays applied
 * after the panel closes (a dot on the button says so) and clears on
 * navigation.
 */
export function GlobalSearch({
  query,
  onQuery,
  pages,
  counts,
}: {
  query: string
  onQuery: (value: string) => void
  pages: SearchPage[]
  counts: { shown: number; total: number }
}) {
  const t = useT()
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  // "/" or Ctrl/Cmd+K opens it from anywhere that is not already a field.
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null
      const typing =
        target?.isContentEditable ||
        ['INPUT', 'TEXTAREA', 'SELECT'].includes(target?.tagName ?? '')
      if ((event.key === 'k' && (event.metaKey || event.ctrlKey)) || (event.key === '/' && !typing)) {
        // Both headers carry one; only the visible one answers.
        if (!wrapRef.current?.offsetParent) return
        event.preventDefault()
        setOpen(true)
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [])

  useEffect(() => {
    if (!open) return
    inputRef.current?.focus()

    function onPointerDown(event: Event) {
      if (!wrapRef.current?.contains(event.target as Node)) setOpen(false)
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('touchstart', onPointerDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('touchstart', onPointerDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const term = query.trim().toLowerCase()
  const matches =
    term === ''
      ? []
      : pages
          .filter((page) => `${page.label} ${page.note ?? ''}`.toLowerCase().includes(term))
          .slice(0, 6)

  function go(to: string) {
    setOpen(false)
    navigate(to)
  }

  return (
    <div className={`${toggle.wrap} ${styles.wrap}`} ref={wrapRef}>
      <button
        type="button"
        className={toggle.button}
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-label={t('search.open')}
        title={t('search.open')}
      >
        <SearchIcon />
      </button>
      {term !== '' && !open ? <span className={toggle.dot} aria-hidden="true" /> : null}

      {open ? (
        <div className={styles.panel} role="dialog" aria-label={t('search.open')}>
          <label className={styles.field}>
            <SearchIcon size={16} />
            <input
              ref={inputRef}
              type="search"
              value={query}
              onChange={(event) => onQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && matches.length > 0 && counts.shown === 0) {
                  go(matches[0].to)
                }
              }}
              placeholder={t('search.placeholder')}
              aria-label={t('search.placeholder')}
            />
            {query !== '' ? (
              <button
                type="button"
                className={styles.clear}
                onClick={() => {
                  onQuery('')
                  inputRef.current?.focus()
                }}
                aria-label={t('search.clear')}
                title={t('search.clear')}
              >
                ✕
              </button>
            ) : null}
          </label>

          {term !== '' ? (
            <p className={styles.status}>
              {counts.total === 0
                ? t('search.noTable')
                : counts.shown === 0
                  ? t('search.noRows')
                  : t('search.rows', { shown: String(counts.shown), total: String(counts.total) })}
            </p>
          ) : null}

          {matches.length > 0 ? (
            <div className={styles.pages}>
              <span className={styles.heading}>{t('search.pages')}</span>
              {matches.map((page) => (
                <button key={page.to} type="button" className={styles.page} onClick={() => go(page.to)}>
                  <strong>{page.label}</strong>
                  {page.note ? <span>{page.note}</span> : null}
                </button>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}

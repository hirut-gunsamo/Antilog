import { useEffect, useRef, useState, type ReactNode } from 'react'

import styles from './DownloadButton.module.css'
import { useT } from '../lib/i18n'

/**
 * A download that asks first. The file name is shown before anything is
 * written, so a mis-click is discarded rather than left in Downloads.
 */
export function DownloadButton({
  filename,
  note,
  onConfirm,
  children,
  className,
  disabled,
  title,
}: {
  /** Exactly the name the file will be saved under. */
  filename: string
  /** One short line of context, e.g. "28 rows". */
  note?: string
  onConfirm: () => void | Promise<void>
  /** Trigger contents — an icon, or an icon and a label. */
  children: ReactNode
  /** Class for the trigger, so it matches whatever toolbar it sits in. */
  className?: string
  disabled?: boolean
  title?: string
}) {
  const [open, setOpen] = useState(false)
  const t = useT()
  const [busy, setBusy] = useState(false)

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

  async function save() {
    setBusy(true)

    try {
      await onConfirm()
      setOpen(false)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className={styles.wrap} ref={wrapRef}>
      <button
        className={className}
        type="button"
        onClick={() => setOpen((value) => !value)}
        disabled={disabled}
        aria-haspopup="dialog"
        aria-expanded={open}
        title={title}
      >
        {children}
      </button>

      {open ? (
        <div className={styles.pop} role="dialog" aria-label={t('dl.confirm')}>
          <p className={styles.ask}>{t('dl.ask')}</p>

          <p className={styles.file}>
            <span className={styles.name}>{filename}</span>
            <span className={styles.meta}>
              CSV{note ? ` · ${note}` : ''}
            </span>
          </p>

          <div className={styles.actions}>
            <button
              type="button"
              className={styles.discard}
              onClick={() => setOpen(false)}
              disabled={busy}
            >
              {t('dl.discard')}
            </button>
            <button
              type="button"
              className={styles.save}
              onClick={save}
              disabled={busy}
            >
              {busy ? t('common.saving') : t('dl.save')}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  )
}

import { useEffect, useState, type FormEvent } from 'react'

import styles from '../inventory/Panel.module.css'
import { useT } from '../../lib/i18n'

/**
 * Collects the reason every reject endpoint requires. Shared by stock
 * requests, cash reports and receipts, and by the Sales page — a rejection is
 * the same decision wherever it is made, and it is always explained.
 */
export function RejectDialog({
  title,
  reference,
  what,
  onClose,
  onConfirm,
}: {
  title: string
  /** The human reference, shown so the wrong row cannot be rejected blindly. */
  reference: string
  /** One line describing what rejecting does. */
  what: string
  onClose: () => void
  onConfirm: (reason: string) => Promise<void> | void
}) {
  const [reason, setReason] = useState('')
  const t = useT()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose()
    }

    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    if (busy) return

    setBusy(true)
    setError(null)

    // A reason helps the other side, but is not required: every reject
    // endpoint needs some text, so a blank one is recorded as such.
    try {
      await onConfirm(reason.trim() || t('dlg.noReasonGiven'))
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : 'Could not reject it.',
      )
      setBusy(false)
    }
  }

  return (
    <div className={styles.scrim} onClick={onClose}>
      <aside
        className={styles.panel}
        role="alertdialog"
        aria-modal="true"
        aria-label={title}
        onClick={(event) => event.stopPropagation()}
      >
        <header className={styles.head}>
          <div>
            <h2>{title}</h2>
            <p className="tabular">{reference}</p>
          </div>
          <button type="button" onClick={onClose} aria-label={t('common.close')}>
            ✕
          </button>
        </header>

        <form className={styles.body} onSubmit={handleSubmit}>
          <p className={styles.warn}>{what}</p>

          <label className={styles.field}>
            <span>
              {t('dlg.reason')}<em>{t('prod.optional')}</em>
            </span>
            <textarea
              rows={4}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              maxLength={500}
              placeholder={t("dlg.reasonPlaceholder")}
              autoFocus
            />
          </label>

          {error ? <p className={styles.error}>{error}</p> : null}

          <div className={styles.actions}>
            <button type="button" className={styles.cancel} onClick={onClose}>
              {t('common.cancel')}
            </button>
            <button
              type="submit"
              className={styles.danger}
              disabled={busy}
            >
              {busy ? t('dlg.rejecting') : t('appr.reject')}
            </button>
          </div>
        </form>
      </aside>
    </div>
  )
}

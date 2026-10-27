import { useEffect, useState, type FormEvent } from 'react'

import { api } from '../../lib/api'
import { useT } from '../../lib/i18n'
import { count } from '../../lib/format'
import type { InventoryBalance } from '../../lib/types'
import styles from './Panel.module.css'

export function DeleteRowDialog({
  balance,
  onClose,
  onDone,
}: {
  balance: InventoryBalance
  onClose: () => void
  onDone: (message: string) => void
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

  // The API refuses to delete a row that still holds stock, so say so here
  // rather than letting the request fail.
  const holdsStock = balance.quantity !== 0

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    if (holdsStock || reason.trim() === '' || busy) return

    setBusy(true)
    setError(null)

    try {
      await api(`/api/inventory/balance/${balance.id}`, {
        method: 'DELETE',
        body: { reason: reason.trim() },
      })

      onDone(
        t('done.rowRemoved', {
          product: balance.product.name,
          branch: balance.location.name,
        }),
      )
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : 'Could not remove the row.',
      )
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className={styles.scrim} onClick={onClose}>
      <aside
        className={styles.panel}
        role="alertdialog"
        aria-modal="true"
        aria-label={t('a11y.removeName', { name: balance.product.name })}
        onClick={(event) => event.stopPropagation()}
      >
        <header className={styles.head}>
          <div>
            <h2>{t('dlg.removeRow')}</h2>
            <p className="tabular">
              {balance.location.name}
            </p>
          </div>
          <button type="button" onClick={onClose} aria-label={t('common.close')}>
            ✕
          </button>
        </header>

        <form className={styles.body} onSubmit={handleSubmit}>
          <p className={styles.warn}>
{t('dlg.removeRowWhat', { product: balance.product.name, branch: balance.location.name })}
          </p>

          {holdsStock ? (
            <p className={styles.blocked}>
{t('dlg.stillHolds', { n: count(balance.quantity) })}
            </p>
          ) : (
            <label className={styles.field}>
              <span>
                {t('dlg.reason')}<em>{t('common.required')}</em>
              </span>
              <input
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                maxLength={500}
                placeholder={t('dlg.phDeleteReason')}
                autoFocus
              />
            </label>
          )}

          {error ? <p className={styles.error}>{error}</p> : null}

          <div className={styles.actions}>
            <button type="button" className={styles.cancel} onClick={onClose}>
              {t('common.cancel')}
            </button>
            <button
              type="submit"
              className={styles.danger}
              disabled={holdsStock || reason.trim() === '' || busy}
            >
              {busy ? t('dlg.removing') : t('dlg.removeRow')}
            </button>
          </div>
        </form>
      </aside>
    </div>
  )
}

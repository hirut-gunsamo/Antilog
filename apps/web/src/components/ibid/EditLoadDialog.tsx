import { useEffect, useState, type FormEvent } from 'react'

import { api } from '../../lib/api'
import { currency } from '../../lib/format'
import { useT } from '../../lib/i18n'
import styles from '../inventory/Panel.module.css'

/**
 * Corrects a balance load, EVD or Telebirr: its amount and note. The branch
 * stays; to move a load, delete it and load the right branch.
 */
export function EditLoadDialog({
  path,
  load,
  onClose,
  onDone,
}: {
  /** "/api/ibid/loads" or "/api/telebirr/loads". */
  path: string
  load: { id: string; amount: string; note: string | null; branch?: { name: string } | null }
  onClose: () => void
  onDone: (amount: number) => void
}) {
  const t = useT()
  const [amount, setAmount] = useState(String(Number(load.amount)))
  const [note, setNote] = useState(load.note ?? '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  const value = Number(amount)
  const valid = amount.trim() !== '' && Number.isFinite(value) && value > 0

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    if (!valid || busy) return
    setBusy(true)
    setError(null)
    try {
      await api(`${path}/${load.id}`, { method: 'PATCH', body: { amount: value, note: note.trim() || null } })
      onDone(value)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not save it.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className={styles.scrim} onClick={onClose}>
      <aside
        className={styles.panel}
        role="dialog"
        aria-modal="true"
        aria-label={t('load.editTitle')}
        onClick={(event) => event.stopPropagation()}
      >
        <header className={styles.head}>
          <div>
            <h2>{t('load.editTitle')}</h2>
            <p>
              {load.branch?.name ? `${load.branch.name} · ` : ''}
              {t('load.was', { amount: currency(Number(load.amount)) })}
            </p>
          </div>
          <button type="button" onClick={onClose} aria-label={t('common.close')}>
            ✕
          </button>
        </header>

        <form className={styles.body} onSubmit={handleSubmit}>
          <label className={styles.field}>
            <span>
              {t('ibid.amountBirr')}<em>{t('common.required')}</em>
            </span>
            <input
              type="number"
              inputMode="decimal"
              min="0.01"
              step="0.01"
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
              autoFocus
              required
            />
            <small className={styles.hint}>{t('load.editNote')}</small>
          </label>

          <label className={styles.field}>
            <span>
              {t('dlg.note')}<em>{t('prod.optional')}</em>
            </span>
            <input value={note} onChange={(event) => setNote(event.target.value)} maxLength={300} />
          </label>

          {error ? <p className={styles.error}>{error}</p> : null}

          <div className={styles.actions}>
            <button type="button" className={styles.cancel} onClick={onClose}>
              {t('common.cancel')}
            </button>
            <button type="submit" className={styles.submit} disabled={!valid || busy}>
              {busy ? t('prod.saving') : t('common.save')}
            </button>
          </div>
        </form>
      </aside>
    </div>
  )
}

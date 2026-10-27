import { useEffect, useState, type FormEvent } from 'react'

import { api } from '../../lib/api'
import { currency } from '../../lib/format'
import { useT } from '../../lib/i18n'
import styles from '../inventory/Panel.module.css'

export function YadereDialog({
  onClose,
  onDone,
}: {
  onClose: () => void
  onDone: (message: string) => void
}) {
  const t = useT()
  const [amount, setAmount] = useState('0')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const controller = new AbortController()
    api<{ yadere: { amount: string } | null }>('/api/cash-collections/yadere/today', {
      signal: controller.signal,
    })
      .then((payload) => {
        if (payload.yadere?.amount != null) setAmount(String(Number(payload.yadere.amount)))
      })
      .catch(() => undefined)
    return () => controller.abort()
  }, [])

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  const value = Number(amount)
  const valid = amount.trim() !== '' && !Number.isNaN(value) && value >= 0

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    if (!valid || busy) return
    setBusy(true)
    setError(null)
    try {
      await api('/api/cash-collections/yadere', {
        method: 'POST',
        body: { amount: value },
      })
      onDone(`${t('rcpt.yadere')} ${currency(value)}`)
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
        aria-label={t('rcpt.yadere')}
        onClick={(event) => event.stopPropagation()}
      >
        <header className={styles.head}>
          <div>
            <h2>{t('rcpt.yadere')}</h2>
          </div>
          <button type="button" onClick={onClose} aria-label={t('common.close')}>
            ✕
          </button>
        </header>
        <form className={styles.body} onSubmit={handleSubmit}>
          <label className={styles.field}>
            <span>{t('rcpt.yadere')}</span>
            <input
              type="number"
              min="0"
              step="0.01"
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
              required
              autoFocus
            />
          </label>
          {error ? <p className={styles.error}>{error}</p> : null}
          <div className={styles.actions}>
            <button type="button" className={styles.cancel} onClick={onClose}>
              {t('common.cancel')}
            </button>
            <button type="submit" className={styles.submit} disabled={!valid || busy}>
              {busy ? t('common.saving') : t('common.save')}
            </button>
          </div>
        </form>
      </aside>
    </div>
  )
}

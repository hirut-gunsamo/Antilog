import { useEffect, useState, type FormEvent } from 'react'

import { api } from '../../lib/api'
import { currency } from '../../lib/format'
import { useT } from '../../lib/i18n'
import type { TeamCashRow } from '../../lib/types'
import styles from '../inventory/Panel.module.css'

/**
 * The supervisor records cash taken from one of their sellers.
 *
 * It opens with the full amount the person is holding, because that is what a
 * collection usually is; a part payment is a matter of changing the number.
 * Nothing about the bank is asked here — that is the receipt upload, and
 * whatever is not banked by tonight is the yadere the supervisor carries.
 */
export function CollectCashDialog({
  seller,
  onClose,
  onDone,
}: {
  seller: TeamCashRow
  onClose: () => void
  onDone: (message: string) => void
}) {
  const t = useT()

  const [amount, setAmount] = useState(String(seller.inHand))
  const [note, setNote] = useState('')
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
  const tooMuch = value > seller.inHand
  const valid = amount.trim() !== '' && value > 0 && !tooMuch

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    if (!valid || busy) return

    setBusy(true)
    setError(null)

    try {
      await api('/api/cash-collections', {
        method: 'POST',
        body: {
          salespersonId: seller.id,
          amount: value,
          ...(note.trim() ? { notes: note.trim() } : {}),
        },
      })

      onDone(
        t('cash.collected', {
          amount: currency(value),
          name: seller.name,
        }),
      )
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : 'Could not record it.',
      )
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
        aria-label={t('cash.collectFrom', { name: seller.name })}
        onClick={(event) => event.stopPropagation()}
      >
        <header className={styles.head}>
          <div>
            <h2>{t('cash.collectFrom', { name: seller.name })}</h2>
            <p>{t('cash.collectNote')}</p>
          </div>
          <button type="button" onClick={onClose} aria-label={t('common.close')}>
            ✕
          </button>
        </header>

        <form className={styles.body} onSubmit={handleSubmit}>
          <div className={styles.saleTotal}>
            <span>{t('cash.theyHold')}</span>
            <strong className="tabular">{currency(seller.inHand)}</strong>
          </div>

          <label className={styles.field}>
            <span>{t('cash.amount')}</span>
            <input
              type="number"
              inputMode="decimal"
              min="0"
              step="0.01"
              max={seller.inHand}
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
              required
            />
          </label>

          {tooMuch ? (
            <p className={styles.lineWarn}>
              {t('cash.tooMuch', { amount: currency(seller.inHand) })}
            </p>
          ) : null}

          {value !== seller.inHand ? (
            <button
              type="button"
              className={styles.addLine}
              onClick={() => setAmount(String(seller.inHand))}
            >
              {t('cash.all')}
            </button>
          ) : null}

          <label className={styles.field}>
            <span>{t('dlg.note')}</span>
            <input
              value={note}
              onChange={(event) => setNote(event.target.value)}
              maxLength={500}
            />
          </label>

          {error ? <p className={styles.error}>{error}</p> : null}

          <div className={styles.actions}>
            <button type="button" className={styles.cancel} onClick={onClose}>
              {t('common.cancel')}
            </button>
            <button
              type="submit"
              className={styles.submit}
              disabled={!valid || busy}
            >
              {busy ? t('cash.collecting') : t('cash.collect')}
            </button>
          </div>
        </form>
      </aside>
    </div>
  )
}

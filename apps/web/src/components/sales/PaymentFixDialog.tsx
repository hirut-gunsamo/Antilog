import { useEffect, useState, type FormEvent } from 'react'

import { api } from '../../lib/api'
import { BANKS } from '../../lib/banks'
import { useT } from '../../lib/i18n'
import { currency } from '../../lib/format'
import { saleRef } from '../../lib/sales'
import type { Sale } from '../../lib/types'
import styles from '../inventory/Panel.module.css'

/**
 * A salesperson corrects how a sale was paid (a mistyped transfer amount).
 * It is sent to the Owner, and the sale changes only once they approve it.
 */
export function PaymentFixDialog({
  sale,
  direct = false,
  onClose,
  onDone,
}: {
  /** The day is open (today, or allowed by the Owner): saved straight away. */
  direct?: boolean
  sale: Sale
  onClose: () => void
  onDone: (message: string) => void
}) {
  const t = useT()
  const total = Number(sale.totalAmount)
  const [method, setMethod] = useState<'CASH' | 'TRANSFER' | 'MIXED'>(sale.paymentMethod ?? 'CASH')
  const [cash, setCash] = useState(String(Number(sale.cashReceived)))
  const [transfer, setTransfer] = useState(String(Number(sale.transferReceived)))
  const [bank, setBank] = useState(sale.bankName ?? '')
  const [banks, setBanks] = useState<string[]>([...BANKS])
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const controller = new AbortController()
    api<{ banks: { id: string; name: string }[] }>('/api/banks', { signal: controller.signal })
      .then((payload) => {
        if (payload.banks?.length) setBanks(payload.banks.map((row) => row.name))
      })
      .catch(() => undefined)
    return () => controller.abort()
  }, [])

  const cashValue = Number(cash)
  const transferValue = Number(transfer)
  const valid =
    (method === 'CASH' ? cash.trim() !== '' && cashValue >= 0 : true) &&
    (method === 'TRANSFER' ? transferValue > 0 : true) &&
    (method === 'MIXED' ? cashValue > 0 && transferValue > 0 : true) &&
    (method === 'CASH' || bank !== '')

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    if (!valid || busy) return
    setBusy(true)
    setError(null)
    try {
      await api(direct ? `/api/sales/${sale.id}/payment` : `/api/sales/${sale.id}/payment-fix`, {
        method: direct ? 'PATCH' : 'POST',
        body: {
          paymentMethod: method,
          cashReceived: method === 'TRANSFER' ? 0 : cashValue,
          transferReceived: method === 'CASH' ? 0 : transferValue,
          ...(method !== 'CASH' ? { bankName: bank } : {}),
          ...(note.trim() ? { note: note.trim() } : {}),
        },
      })
      onDone(t(direct ? 'pf.saved' : 'pf.sent'))
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not send it.')
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
        aria-label={t('pf.title')}
        onClick={(event) => event.stopPropagation()}
      >
        <header className={styles.head}>
          <div>
            <h2>{t('pf.title')}</h2>
            <p className="tabular">
              {saleRef(sale)} · {t('dlg.total')} {currency(total)}
            </p>
          </div>
          <button type="button" onClick={onClose} aria-label={t('common.close')}>
            ✕
          </button>
        </header>

        <form className={styles.body} onSubmit={handleSubmit}>
          {direct ? null : <p className={styles.warn}>{t('pf.note')}</p>}

          <div className={styles.field}>
            <span>{t('pay.method')}</span>
            <div className={styles.lineGrid} style={{ gridTemplateColumns: 'repeat(3, minmax(0, 1fr))' }}>
              {(['CASH', 'TRANSFER', 'MIXED'] as const).map((option) => (
                <button
                  key={option}
                  type="button"
                  className={method === option ? styles.submit : styles.cancel}
                  aria-pressed={method === option}
                  onClick={() => setMethod(option)}
                >
                  {t(option === 'CASH' ? 'pay.cash' : option === 'TRANSFER' ? 'pay.transfer' : 'pay.mixed')}
                </button>
              ))}
            </div>
          </div>

          {method !== 'TRANSFER' ? (
            <label className={styles.field}>
              <span>{t('pay.cash')}</span>
              <input type="number" inputMode="decimal" min={0} step="any" value={cash} onChange={(event) => setCash(event.target.value)} />
            </label>
          ) : null}

          {method !== 'CASH' ? (
            <>
              <label className={styles.field}>
                <span>{t('pay.transfer')}</span>
                <input
                  type="number"
                  inputMode="decimal"
                  min={0}
                  step="any"
                  value={transfer}
                  onChange={(event) => setTransfer(event.target.value)}
                />
              </label>
              <label className={styles.field}>
                <span>{t('pay.bank')}</span>
                <select value={bank} onChange={(event) => setBank(event.target.value)} required>
                  <option value="">{t('pay.chooseBank')}</option>
                  {banks.map((name) => (
                    <option key={name} value={name}>
                      {name}
                    </option>
                  ))}
                </select>
              </label>
            </>
          ) : null}

          {direct ? null : (
            <label className={styles.field}>
              <span>{t('dlg.note')}</span>
              <input value={note} onChange={(event) => setNote(event.target.value)} maxLength={300} placeholder={t('pf.reason')} />
            </label>
          )}

          {error ? <p className={styles.error}>{error}</p> : null}

          <div className={styles.actions}>
            <button type="button" className={styles.cancel} onClick={onClose}>
              {t('common.cancel')}
            </button>
            <button type="submit" className={styles.submit} disabled={!valid || busy}>
              {busy ? t('common.saving') : t(direct ? 'common.save' : 'pf.send')}
            </button>
          </div>
        </form>
      </aside>
    </div>
  )
}

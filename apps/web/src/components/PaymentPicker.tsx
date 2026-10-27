import { useEffect, useState } from 'react'

import { api } from '../lib/api'
import { BANKS } from '../lib/banks'
import { currency } from '../lib/format'
import { useT } from '../lib/i18n'
import type { Payment } from '../lib/payment'
import styles from './inventory/Panel.module.css'

/**
 * How the customer paid, the same three ways as a sale: cash, transfer (to a
 * named bank) or some of each.
 */
export function PaymentPicker({
  value,
  onChange,
  amount,
}: {
  value: Payment
  onChange: (next: Payment) => void
  amount: number
}) {
  const t = useT()
  // Offline, the built-in list still lets a transfer be recorded.
  const [banks, setBanks] = useState<string[]>([...BANKS])

  useEffect(() => {
    const controller = new AbortController()
    api<{ banks: { id: string; name: string }[] }>('/api/banks', { signal: controller.signal })
      .then((payload) => {
        if (payload.banks?.length) setBanks(payload.banks.map((row) => row.name))
      })
      .catch(() => undefined)
    return () => controller.abort()
  }, [])

  const transfer = Number(value.transfer)

  return (
    <>
      <div className={styles.field}>
        <span>
          {t('pay.method')}<em>{t('common.required')}</em>
        </span>
        <div className={styles.lineGrid} style={{ gridTemplateColumns: 'repeat(3, minmax(0, 1fr))' }}>
          {(['CASH', 'TRANSFER', 'MIXED'] as const).map((option) => (
            <button
              key={option}
              type="button"
              className={value.method === option ? styles.submit : styles.cancel}
              aria-pressed={value.method === option}
              onClick={() => onChange({ ...value, method: option })}
            >
              {t(option === 'CASH' ? 'pay.cash' : option === 'TRANSFER' ? 'pay.transfer' : 'pay.mixed')}
            </button>
          ))}
        </div>
      </div>

      {value.method !== 'CASH' ? (
        <label className={styles.field}>
          <span>
            {t('pay.bank')}<em>{t('common.required')}</em>
          </span>
          <select value={value.bank} onChange={(event) => onChange({ ...value, bank: event.target.value })} required>
            <option value="">{t('pay.chooseBank')}</option>
            {banks.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
        </label>
      ) : null}

      {value.method === 'MIXED' ? (
        <label className={styles.field}>
          <span>
            {t('pay.transferPart')}<em>{t('common.required')}</em>
          </span>
          <input
            type="number"
            inputMode="decimal"
            min="0"
            step="0.01"
            value={value.transfer}
            onChange={(event) => onChange({ ...value, transfer: event.target.value })}
            required
          />
          {value.transfer.trim() !== '' && transfer > 0 && transfer < amount ? (
            <p className={styles.tally}>
              {t('pay.cash')} {currency(amount - transfer)} + {t('pay.transfer')} {currency(transfer)}
            </p>
          ) : null}
        </label>
      ) : null}
    </>
  )
}

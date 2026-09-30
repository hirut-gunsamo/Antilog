import { useEffect, useState, type FormEvent } from 'react'

import { useAuth } from '../../auth/context'
import { api } from '../../lib/api'
import { currency } from '../../lib/format'
import { useT } from '../../lib/i18n'
import type { BranchRow } from '../../lib/types'
import styles from '../inventory/Panel.module.css'

function useEscape(onClose: () => void) {
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])
}

/** The Owner adds money to the main Telebirr balance. */
export function LoadTelebirrDialog({
  onClose,
  onDone,
}: {
  onClose: () => void
  onDone: (amount: number) => void
}) {
  const t = useT()
  useEscape(onClose)

  const [amount, setAmount] = useState('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const value = Number(amount)
  const valid = amount.trim() !== '' && value > 0

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    if (!valid || busy) return
    setBusy(true)
    setError(null)

    try {
      await api('/api/telebirr/loads', {
        method: 'POST',
        body: { amount: value, ...(note.trim() ? { note: note.trim() } : {}) },
      })
      onDone(value)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not save it.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className={styles.scrim} onClick={onClose}>
      <aside className={styles.panel} role="dialog" aria-modal="true" aria-label={t('tb.loadTitle')} onClick={(event) => event.stopPropagation()}>
        <header className={styles.head}>
          <div>
            <h2>{t('tb.loadTitle')}</h2>
            <p>{t('tb.loadNote')}</p>
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
            <input type="number" inputMode="decimal" min="1" step="0.01" value={amount} onChange={(event) => setAmount(event.target.value)} autoFocus required />
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
              {busy ? t('prod.saving') : t('tb.load')}
            </button>
          </div>
        </form>
      </aside>
    </div>
  )
}

/**
 * A seller records Telebirr money spent: a cash-in (customer paid cash, got
 * Telebirr money) or airtime sold from Telebirr. It comes off the balance.
 */
export function RecordTelebirrDialog({
  balance,
  onClose,
  onDone,
}: {
  balance: number
  onClose: () => void
  onDone: (message: string) => void
}) {
  const t = useT()
  useEscape(onClose)

  const { user } = useAuth()
  const isOwner = user?.role === 'OWNER'

  const [kind, setKind] = useState<'CASH_IN' | 'AIRTIME'>('CASH_IN')
  const [amount, setAmount] = useState('')
  const [phone, setPhone] = useState('')
  const [note, setNote] = useState('')
  const [branches, setBranches] = useState<BranchRow[]>([])
  const [branchId, setBranchId] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!isOwner) return
    const controller = new AbortController()
    api<{ branches: BranchRow[] }>('/api/branches?isActive=true', { signal: controller.signal })
      .then((payload) => setBranches(payload.branches ?? []))
      .catch(() => undefined)
    return () => controller.abort()
  }, [isOwner])

  const validBranchId = branches.some((row) => row.id === branchId) ? branchId : (branches[0]?.id ?? '')
  const value = Number(amount)
  const enough = value <= balance
  const valid = amount.trim() !== '' && value > 0 && enough && (!isOwner || validBranchId !== '')

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    if (!valid || busy) return
    setBusy(true)
    setError(null)

    try {
      await api('/api/telebirr/transactions', {
        method: 'POST',
        body: {
          kind,
          amount: value,
          ...(isOwner ? { branchId: validBranchId } : {}),
          ...(phone.trim() ? { customerPhone: phone.trim() } : {}),
          ...(note.trim() ? { note: note.trim() } : {}),
        },
      })
      onDone(t(kind === 'CASH_IN' ? 'tb.cashInDone' : 'tb.airtimeDone', { amount: currency(value) }))
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not save it.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className={styles.scrim} onClick={onClose}>
      <aside className={styles.panel} role="dialog" aria-modal="true" aria-label={t('tb.recordTitle')} onClick={(event) => event.stopPropagation()}>
        <header className={styles.head}>
          <div>
            <h2>{t('tb.recordTitle')}</h2>
            <p>{t('tb.recordNote')}</p>
          </div>
          <button type="button" onClick={onClose} aria-label={t('common.close')}>
            ✕
          </button>
        </header>

        <form className={styles.body} onSubmit={handleSubmit}>
          {isOwner ? (
            <label className={styles.field}>
              <span>
                {t('common.branch')}<em>{t('common.required')}</em>
              </span>
              <select value={validBranchId} onChange={(event) => setBranchId(event.target.value)}>
                {branches.map((row) => (
                  <option key={row.id} value={row.id}>
                    {row.name}
                  </option>
                ))}
              </select>
            </label>
          ) : null}

          <label className={styles.field}>
            <span>
              {t('tb.kind')}<em>{t('common.required')}</em>
            </span>
            <select value={kind} onChange={(event) => setKind(event.target.value as 'CASH_IN' | 'AIRTIME')}>
              <option value="CASH_IN">{t('tb.cashIn')}</option>
              <option value="AIRTIME">{t('tb.airtime')}</option>
            </select>
          </label>

          <label className={styles.field}>
            <span>
              {t('ibid.amountBirr')}<em>{t('common.required')}</em>
            </span>
            <input type="number" inputMode="decimal" min="1" step="0.01" value={amount} onChange={(event) => setAmount(event.target.value)} autoFocus required />
          </label>

          <label className={styles.field}>
            <span>
              {t('tb.customerPhone')}<em>{t('prod.optional')}</em>
            </span>
            <input type="tel" inputMode="tel" value={phone} onChange={(event) => setPhone(event.target.value)} maxLength={24} placeholder="09…" />
          </label>

          <dl className={styles.facts}>
            <div>
              <dt>{t('ibid.balanceNow')}</dt>
              <dd className="tabular">{currency(balance)}</dd>
            </div>
            <div>
              <dt>{t('ibid.balanceAfter')}</dt>
              <dd className="tabular">
                <strong>{currency(balance - (value > 0 ? value : 0))}</strong>
              </dd>
            </div>
          </dl>

          {!enough ? <p className={styles.blocked}>{t('tb.notEnough')}</p> : null}

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

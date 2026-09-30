import { useEffect, useState, type FormEvent } from 'react'

import { useAuth } from '../../auth/context'
import { api } from '../../lib/api'
import { count, currency } from '../../lib/format'
import { CARDS_PER_CARTA, cartaText } from '../../lib/ibid'
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

/** The Owner adds birr to the main Ibid balance. */
export function LoadIbidDialog({
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
      await api('/api/ibid/loads', {
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
      <aside
        className={styles.panel}
        role="dialog"
        aria-modal="true"
        aria-label={t('ibid.loadTitle')}
        onClick={(event) => event.stopPropagation()}
      >
        <header className={styles.head}>
          <div>
            <h2>{t('ibid.loadTitle')}</h2>
            <p>{t('ibid.loadNote')}</p>
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
              min="1"
              step="0.01"
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
              placeholder="1000000"
              autoFocus
              required
            />
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
              {busy ? t('prod.saving') : t('ibid.load')}
            </button>
          </div>
        </form>
      </aside>
    </div>
  )
}

/**
 * A branch records Ibid it printed: one value, and how many carta (20 cards
 * each) and loose cards. The birr it comes to is taken off the main balance.
 */
export function PrintIbidDialog({
  values,
  balance,
  onClose,
  onDone,
}: {
  values: number[]
  balance: number
  onClose: () => void
  onDone: (message: string) => void
}) {
  const t = useT()
  useEscape(onClose)

  const { user } = useAuth()
  const isOwner = user?.role === 'OWNER'

  const [denomination, setDenomination] = useState(values[0] ?? 10)
  const [cartas, setCartas] = useState('')
  const [loose, setLoose] = useState('')
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

  const validBranchId = branches.some((row) => row.id === branchId)
    ? branchId
    : (branches[0]?.id ?? '')

  const whole = (text: string) => {
    const n = Number(text)
    return text.trim() === '' ? 0 : Number.isInteger(n) && n >= 0 ? n : NaN
  }
  const cards = whole(cartas) * CARDS_PER_CARTA + whole(loose)
  const counted = Number.isFinite(cards) && cards > 0
  const value = counted ? cards * denomination : 0
  const enough = value <= balance
  const valid = counted && enough && (!isOwner || validBranchId !== '')

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    if (!valid || busy) return

    setBusy(true)
    setError(null)

    try {
      await api('/api/ibid/prints', {
        method: 'POST',
        body: {
          denomination,
          cartas: whole(cartas),
          cards: whole(loose),
          ...(isOwner ? { branchId: validBranchId } : {}),
          ...(note.trim() ? { note: note.trim() } : {}),
        },
      })
      onDone(t('ibid.printed', { cards: cartaText(t, cards), value: denomination, amount: currency(value) }))
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
        aria-label={t('ibid.printTitle')}
        onClick={(event) => event.stopPropagation()}
      >
        <header className={styles.head}>
          <div>
            <h2>{t('ibid.printTitle')}</h2>
            <p>{t('ibid.printNote')}</p>
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
              {t('ibid.value')}<em>{t('common.required')}</em>
            </span>
            <select
              value={denomination}
              onChange={(event) => setDenomination(Number(event.target.value))}
            >
              {values.map((option) => (
                <option key={option} value={option}>
                  Ibid {option}
                </option>
              ))}
            </select>
          </label>

          <div className={styles.lineGrid} style={{ gridTemplateColumns: 'repeat(2, minmax(0, 1fr))' }}>
            <label>
              <span>{t('ibid.carta')}</span>
              <input
                type="number"
                inputMode="numeric"
                min="0"
                step="1"
                value={cartas}
                onChange={(event) => setCartas(event.target.value)}
                placeholder="0"
                autoFocus
              />
            </label>
            <label>
              <span>{t('ibid.looseCards')}</span>
              <input
                type="number"
                inputMode="numeric"
                min="0"
                step="1"
                value={loose}
                onChange={(event) => setLoose(event.target.value)}
                placeholder="0"
              />
            </label>
          </div>

          <p className={styles.tally}>{t('ibid.cartaHint', { n: CARDS_PER_CARTA })}</p>

          <dl className={styles.facts}>
            <div>
              <dt>{t('ibid.cards')}</dt>
              <dd className="tabular">{counted ? `${count(cards)} · ${cartaText(t, cards)}` : '—'}</dd>
            </div>
            <div>
              <dt>{t('ibid.amountBirr')}</dt>
              <dd className="tabular">{currency(value)}</dd>
            </div>
            <div>
              <dt>{t('ibid.balanceAfter')}</dt>
              <dd className="tabular">
                <strong>{currency(balance - value)}</strong>
              </dd>
            </div>
          </dl>

          {!enough ? <p className={styles.blocked}>{t('ibid.notEnough')}</p> : null}

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
              {busy ? t('prod.saving') : t('ibid.print')}
            </button>
          </div>
        </form>
      </aside>
    </div>
  )
}

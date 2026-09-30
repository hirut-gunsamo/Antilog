import { useEffect, useState, type FormEvent } from 'react'

import { api } from '../../lib/api'
import { currency } from '../../lib/format'
import { useT } from '../../lib/i18n'
import type { PayrollMonth } from '../../lib/types'
import styles from '../inventory/Panel.module.css'

type Row = PayrollMonth['rows'][number]

function useEscape(onClose: () => void) {
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])
}

/** Sets what one employee is paid a month. */
export function SalaryDialog({
  row,
  onClose,
  onDone,
}: {
  row: Row
  onClose: () => void
  onDone: () => void
}) {
  const t = useT()
  useEscape(onClose)

  const [value, setValue] = useState(row.employee.monthlySalary ?? '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const amount = Number(value)
  const valid = value === '' || (Number.isFinite(amount) && amount >= 0)

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    if (!valid || busy) return
    setBusy(true)
    setError(null)

    try {
      await api(`/api/payroll/employees/${row.employee.id}`, {
        method: 'PATCH',
        body: { monthlySalary: value === '' ? null : amount },
      })
      onDone()
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
        aria-label={t('pay.salaryTitle')}
        onClick={(event) => event.stopPropagation()}
      >
        <header className={styles.head}>
          <div>
            <h2>{t('pay.salaryTitle')}</h2>
            <p>{row.employee.name}</p>
          </div>
          <button type="button" onClick={onClose} aria-label={t('common.close')}>
            ✕
          </button>
        </header>

        <form className={styles.body} onSubmit={handleSubmit}>
          <label className={styles.field}>
            <span>{t('pay.monthlySalary')}</span>
            <input
              type="number"
              inputMode="decimal"
              min="0"
              step="0.01"
              value={value}
              onChange={(event) => setValue(event.target.value)}
              autoFocus
            />
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

/**
 * Pay salary: choose the employee, then salary, commission, bonus and
 * deduction. Commission starts at what their sales earned this month and can
 * be changed. The same form edits a payment already recorded.
 */
export function PayDialog({
  rows,
  month,
  editing,
  onClose,
  onDone,
}: {
  rows: Row[]
  month: string
  /** Set when correcting a payment already made. */
  editing: Row | null
  onClose: () => void
  onDone: (name: string, net: number) => void
}) {
  const t = useT()
  useEscape(onClose)

  // Only people not yet paid this month can be picked for a new payment.
  const choices = editing ? [editing] : rows.filter((row) => !row.payment)
  const [userId, setUserId] = useState(editing?.employee.id ?? choices[0]?.employee.id ?? '')
  const row = choices.find((entry) => entry.employee.id === userId) ?? null

  const start = (value: number | undefined) => (value ? String(value) : '')
  const [salary, setSalary] = useState(
    start(editing ? editing.salary : Number(row?.employee.monthlySalary ?? 0)),
  )
  const [commission, setCommission] = useState(start(row?.commission))
  const [bonus, setBonus] = useState(start(editing?.payment?.bonus))
  const [deduction, setDeduction] = useState(start(editing?.payment?.deduction))
  const [note, setNote] = useState(editing?.payment?.note ?? '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function pick(id: string) {
    setUserId(id)
    const next = choices.find((entry) => entry.employee.id === id)
    setSalary(start(Number(next?.employee.monthlySalary ?? 0)))
    setCommission(start(next?.commission))
  }

  const n = (value: string) => Number(value) || 0
  const net = n(salary) + n(commission) + n(bonus) - n(deduction)
  const valid =
    row != null && [salary, commission, bonus, deduction].every((value) => n(value) >= 0) && net >= 0

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    if (!valid || busy || !row) return
    setBusy(true)
    setError(null)

    const body = {
      salary: n(salary),
      commission: n(commission),
      bonus: n(bonus),
      deduction: n(deduction),
      ...(note.trim() ? { note: note.trim() } : {}),
    }

    try {
      if (editing?.payment) {
        await api(`/api/payroll/payments/${editing.payment.id}`, { method: 'PATCH', body })
      } else {
        await api('/api/payroll/payments', {
          method: 'POST',
          body: { userId: row.employee.id, month, ...body },
        })
      }
      onDone(row.employee.name, net)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not save it.')
    } finally {
      setBusy(false)
    }
  }

  const money = (label: string, value: string, set: (value: string) => void, optional = false) => (
    <label className={styles.field}>
      <span>
        {label}
        <em>{t(optional ? 'prod.optional' : 'common.required')}</em>
      </span>
      <input
        type="number"
        inputMode="decimal"
        min="0"
        step="0.01"
        value={value}
        onChange={(event) => set(event.target.value)}
        placeholder="0"
      />
    </label>
  )

  return (
    <div className={styles.scrim} onClick={onClose}>
      <aside
        className={styles.panel}
        role="dialog"
        aria-modal="true"
        aria-label={t(editing ? 'pay.editTitle' : 'pay.payTitle')}
        onClick={(event) => event.stopPropagation()}
      >
        <header className={styles.head}>
          <div>
            <h2>{t(editing ? 'pay.editTitle' : 'pay.payTitle')}</h2>
            <p>{month}</p>
          </div>
          <button type="button" onClick={onClose} aria-label={t('common.close')}>
            ✕
          </button>
        </header>

        <form className={styles.body} onSubmit={handleSubmit}>
          <label className={styles.field}>
            <span>
              {t('pay.employee')}<em>{t('common.required')}</em>
            </span>
            <select value={userId} onChange={(event) => pick(event.target.value)} disabled={Boolean(editing)}>
              {choices.length === 0 ? <option value="">{t('pay.allPaid')}</option> : null}
              {choices.map((entry) => (
                <option key={entry.employee.id} value={entry.employee.id}>
                  {entry.employee.name}
                  {entry.employee.branch ? ` · ${entry.employee.branch.name}` : ''}
                </option>
              ))}
            </select>
          </label>

          {money(t('pay.salary'), salary, setSalary)}
          {money(t('pay.commission'), commission, setCommission, true)}
          {money(t('pay.bonus'), bonus, setBonus, true)}
          {money(t('pay.deduction'), deduction, setDeduction, true)}

          <label className={styles.field}>
            <span>
              {t('dlg.note')}<em>{t('prod.optional')}</em>
            </span>
            <input value={note} onChange={(event) => setNote(event.target.value)} maxLength={300} />
          </label>

          <dl className={styles.facts}>
            <div>
              <dt>{t('pay.net')}</dt>
              <dd className="tabular">
                <strong>{currency(net)}</strong>
              </dd>
            </div>
          </dl>

          {net < 0 ? <p className={styles.blocked}>{t('pay.negative')}</p> : null}
          {error ? <p className={styles.error}>{error}</p> : null}

          <div className={styles.actions}>
            <button type="button" className={styles.cancel} onClick={onClose}>
              {t('common.cancel')}
            </button>
            <button type="submit" className={styles.submit} disabled={!valid || busy}>
              {busy ? t('prod.saving') : t(editing ? 'common.save' : 'pay.paySalary')}
            </button>
          </div>
        </form>
      </aside>
    </div>
  )
}

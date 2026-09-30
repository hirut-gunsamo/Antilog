import { useEffect, useState, type FormEvent } from 'react'

import { useAuth } from '../auth/context'
import { Card, Empty } from '../components/Card'
import { Toasts } from '../components/Toasts'
import { api } from '../lib/api'
import { useBranchList } from '../lib/branches'
import { count, currency, shortDate } from '../lib/format'
import { useT } from '../lib/i18n'
import { useToasts } from '../lib/toasts'
import type { ExpenseReport } from '../lib/types'
import panel from '../components/inventory/Panel.module.css'
import base from './Products.module.css'
import styles from './Ibid.module.css'

function isoDay(date: Date) {
  return `${date.getFullYear()}-${`${date.getMonth() + 1}`.padStart(2, '0')}-${`${date.getDate()}`.padStart(2, '0')}`
}

// Common reasons, offered as the supervisor types; anything else is fine too.
const REASONS = ['Transport', 'Food', 'Repairs', 'Supplies', 'Rent', 'Electricity', 'Water', 'Internet', 'Cleaning']

/** A supervisor records one expense: amount, reason, the day, a note. */
function AddExpenseDialog({ onClose, onDone }: { onClose: () => void; onDone: (amount: number) => void }) {
  const t = useT()
  const [amount, setAmount] = useState('')
  const [reason, setReason] = useState('')
  const [date, setDate] = useState(isoDay(new Date()))
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
  const valid = value > 0 && reason.trim().length >= 2 && date !== ''

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    if (!valid || busy) return
    setBusy(true)
    setError(null)
    try {
      await api('/api/expenses', {
        method: 'POST',
        body: { amount: value, reason: reason.trim(), date, ...(note.trim() ? { note: note.trim() } : {}) },
      })
      onDone(value)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not save it.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className={panel.scrim} onClick={onClose}>
      <aside className={panel.panel} role="dialog" aria-modal="true" aria-label={t('exp.addTitle')} onClick={(event) => event.stopPropagation()}>
        <header className={panel.head}>
          <div>
            <h2>{t('exp.addTitle')}</h2>
            <p>{t('exp.addNote')}</p>
          </div>
          <button type="button" onClick={onClose} aria-label={t('common.close')}>
            ✕
          </button>
        </header>

        <form className={panel.body} onSubmit={handleSubmit}>
          <label className={panel.field}>
            <span>
              {t('ibid.amountBirr')}<em>{t('common.required')}</em>
            </span>
            <input type="number" inputMode="decimal" min="0" step="0.01" value={amount} onChange={(event) => setAmount(event.target.value)} autoFocus required />
          </label>

          <label className={panel.field}>
            <span>
              {t('exp.reason')}<em>{t('common.required')}</em>
            </span>
            <input value={reason} onChange={(event) => setReason(event.target.value)} list="expense-reasons" maxLength={120} placeholder={t('exp.phReason')} required />
            <datalist id="expense-reasons">
              {REASONS.map((entry) => (
                <option key={entry} value={entry} />
              ))}
            </datalist>
          </label>

          <label className={panel.field}>
            <span>
              {t('req.date')}<em>{t('common.required')}</em>
            </span>
            <input type="date" value={date} max={isoDay(new Date())} onChange={(event) => setDate(event.target.value)} required />
          </label>

          <label className={panel.field}>
            <span>
              {t('dlg.note')}<em>{t('prod.optional')}</em>
            </span>
            <input value={note} onChange={(event) => setNote(event.target.value)} maxLength={500} />
          </label>

          {error ? <p className={panel.error}>{error}</p> : null}

          <div className={panel.actions}>
            <button type="button" className={panel.cancel} onClick={onClose}>
              {t('common.cancel')}
            </button>
            <button type="submit" className={panel.submit} disabled={!valid || busy}>
              {busy ? t('prod.saving') : t('exp.add')}
            </button>
          </div>
        </form>
      </aside>
    </div>
  )
}

/**
 * Expenses: supervisors record what their branch paid out, with a reason;
 * the Owner reads them as a report across branches, by reason and entry.
 */
export default function Expenses() {
  const { user } = useAuth()
  const t = useT()
  const { toasts, push, dismiss } = useToasts()
  const isOwner = user?.role === 'OWNER'
  const branchList = useBranchList()

  const now = new Date()
  const [from, setFrom] = useState(isoDay(new Date(now.getFullYear(), now.getMonth(), 1)))
  const [to, setTo] = useState(isoDay(now))
  const [branch, setBranch] = useState('')
  const [data, setData] = useState<ExpenseReport | null>(null)
  const [reloadKey, setReloadKey] = useState(0)
  const [adding, setAdding] = useState(false)

  useEffect(() => {
    const controller = new AbortController()
    const query = new URLSearchParams({ from, to })
    if (isOwner && branch) query.set('branchId', branch)
    api<ExpenseReport>(`/api/expenses?${query}`, { signal: controller.signal })
      .then(setData)
      .catch(() => {
        if (!controller.signal.aborted) setData({ total: 0, byBranch: [], byReason: [], expenses: [] })
      })
    return () => controller.abort()
  }, [from, to, branch, isOwner, reloadKey])

  const reload = () => setReloadKey((n) => n + 1)

  async function remove(id: string) {
    if (!window.confirm(t('exp.deleteConfirm'))) return
    try {
      await api(`/api/expenses/${id}`, { method: 'DELETE' })
      push('success', t('exp.deleted'))
      reload()
    } catch (caught) {
      push('error', caught instanceof Error ? caught.message : 'Failed.')
    }
  }

  function exportCsv() {
    if (!data) return
    const escape = (value: string | number) => `"${String(value).replace(/"/g, '""')}"`
    const lines = [
      ['Date', 'Branch', 'Reason', 'Amount', 'Note', 'Recorded by'],
      ...data.expenses.map((row) => [row.expenseDate.slice(0, 10), row.branch.name, row.reason, Number(row.amount), row.note ?? '', row.recordedBy.name]),
    ]
    const blob = new Blob([lines.map((line) => line.map(escape).join(',')).join('\n')], { type: 'text/csv' })
    const link = document.createElement('a')
    link.href = URL.createObjectURL(blob)
    link.download = `expenses-${from}-to-${to}.csv`
    link.click()
    URL.revokeObjectURL(link.href)
  }

  const canDelete = (row: ExpenseReport['expenses'][number]) => isOwner || row.recordedBy.id === user?.id

  return (
    <div className={base.page}>
      <header className={base.head}>
        <div className={base.mobileHeading}>
          <h1 className={base.title}>{t('exp.title')}</h1>
          <p className={base.subtitle}>{t(isOwner ? 'exp.noteOwner' : 'exp.note')}</p>
        </div>
        <div className={base.headActions}>
          {!isOwner ? (
            <button type="button" className={base.primary} onClick={() => setAdding(true)}>
              + {t('exp.add')}
            </button>
          ) : null}
          <button type="button" className={base.secondary} onClick={exportCsv} disabled={!data?.expenses.length}>
            {t('rep.export')}
          </button>
        </div>
      </header>

      <div className={styles.tiles}>
        <div className={styles.main}>
          <strong className="tabular">{data ? currency(data.total) : '—'}</strong>
          <span>{t('exp.total')}</span>
        </div>
        <div>
          <strong className="tabular">{data ? count(data.expenses.length) : '—'}</strong>
          <span>{t('exp.count')}</span>
        </div>
        <div>
          <strong>{data?.byReason[0]?.reason ?? '—'}</strong>
          <span>{t('exp.topReason')}</span>
        </div>
        {isOwner ? (
          <div>
            <strong>{data?.byBranch[0]?.name ?? '—'}</strong>
            <span>{t('exp.topBranch')}</span>
          </div>
        ) : null}
      </div>

      <Card>
        <div className={styles.filters} style={{ marginBottom: 0 }}>
          <label>
            {t('ibid.from')}
            <input type="date" value={from} max={to} onChange={(event) => setFrom(event.target.value)} />
          </label>
          <label>
            {t('ibid.to')}
            <input type="date" value={to} min={from} onChange={(event) => setTo(event.target.value)} />
          </label>
          {isOwner ? (
            <select value={branch} onChange={(event) => setBranch(event.target.value)} aria-label={t('common.branch')}>
              <option value="">{t('inv.allBranches')}</option>
              {branchList.map(([id, name]) => (
                <option key={id} value={id}>
                  {name}
                </option>
              ))}
            </select>
          ) : null}
        </div>
      </Card>

      {isOwner && data && data.byBranch.length > 0 ? (
        <Card title={t('exp.byBranch')}>
          <div className={base.scroll}>
            <table className={base.table}>
              <thead>
                <tr>
                  <th scope="col">{t('common.branch')}</th>
                  <th scope="col">{t('exp.count')}</th>
                  <th scope="col">{t('exp.total')}</th>
                </tr>
              </thead>
              <tbody>
                {data.byBranch.map((row) => (
                  <tr key={row.id}>
                    <td data-label={t('common.branch')} className={base.strong}>{row.name}</td>
                    <td data-label={t('exp.count')} className="tabular">{count(row.count)}</td>
                    <td data-label={t('exp.total')} className={`${base.strong} tabular`}>{currency(row.total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      ) : null}

      {data && data.byReason.length > 0 ? (
        <Card title={t('exp.byReason')}>
          <div className={base.scroll}>
            <table className={base.table}>
              <thead>
                <tr>
                  <th scope="col">{t('exp.reason')}</th>
                  <th scope="col">{t('exp.count')}</th>
                  <th scope="col">{t('exp.total')}</th>
                </tr>
              </thead>
              <tbody>
                {data.byReason.map((row) => (
                  <tr key={row.reason}>
                    <td data-label={t('exp.reason')} className={base.strong}>{row.reason}</td>
                    <td data-label={t('exp.count')} className="tabular">{count(row.count)}</td>
                    <td data-label={t('exp.total')} className={`${base.strong} tabular`}>{currency(row.total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      ) : null}

      <Card title={t('exp.entries')}>
        {!data ? (
          <Empty>{t('common.loading')}</Empty>
        ) : data.expenses.length === 0 ? (
          <Empty>{t('exp.none')}</Empty>
        ) : (
          <div className={base.scroll}>
            <table className={base.table}>
              <thead>
                <tr>
                  <th scope="col">{t('req.date')}</th>
                  <th scope="col">{t('exp.reason')}</th>
                  <th scope="col">{t('ibid.amountBirr')}</th>
                  <th scope="col">{t('common.branch')}</th>
                  <th scope="col">{t('ibid.by')}</th>
                  <th scope="col" />
                </tr>
              </thead>
              <tbody>
                {data.expenses.map((row) => (
                  <tr key={row.id}>
                    <td data-label={t('req.date')}>{shortDate(row.expenseDate)}</td>
                    <td data-label={t('exp.reason')} className={base.strong}>
                      {row.reason}
                      {row.note ? <em className={base.sub}>{row.note}</em> : null}
                    </td>
                    <td data-label={t('ibid.amountBirr')} className={`${base.strong} tabular`}>{currency(Number(row.amount))}</td>
                    <td data-label={t('common.branch')}>{row.branch.name}</td>
                    <td data-label={t('ibid.by')}>{row.recordedBy.name}</td>
                    <td>
                      {canDelete(row) ? (
                        <button type="button" className={styles.remove} onClick={() => void remove(row.id)}>
                          {t('prod.delete')}
                        </button>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {adding ? (
        <AddExpenseDialog
          onClose={() => setAdding(false)}
          onDone={(amount) => {
            setAdding(false)
            push('success', t('exp.added', { amount: currency(amount) }))
            reload()
          }}
        />
      ) : null}

      <Toasts toasts={toasts} onDismiss={dismiss} />
    </div>
  )
}

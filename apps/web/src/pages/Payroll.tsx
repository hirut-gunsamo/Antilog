import { useEffect, useState } from 'react'

import { Card, Empty } from '../components/Card'
import { PayDialog } from '../components/payroll/PayrollDialogs'
import { Toasts } from '../components/Toasts'
import { api } from '../lib/api'
import { currency, shortDate } from '../lib/format'
import { useT } from '../lib/i18n'
import { thisMonth } from '../lib/month'
import { useToasts } from '../lib/toasts'
import type { PayrollMonth } from '../lib/types'
import base from './Products.module.css'
import styles from './Ibid.module.css'

type Row = PayrollMonth['rows'][number]

/**
 * Salaries: each employee's month — salary, commission, and whether it has
 * been paid. Paying records the figures as they stood; the page is also the
 * month's salary report and exports as a CSV.
 */
export default function Payroll() {
  const t = useT()
  const { toasts, push, dismiss } = useToasts()

  const [month, setMonth] = useState(thisMonth())
  const [data, setData] = useState<PayrollMonth | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [reloadKey, setReloadKey] = useState(0)
  // null: closed; 'new': Pay Salary; a row: editing that payment.
  const [form, setForm] = useState<Row | 'new' | null>(null)

  useEffect(() => {
    const controller = new AbortController()

    api<PayrollMonth>(`/api/payroll/month?month=${month}`, { signal: controller.signal })
      .then((payload) => {
        setData(payload)
        setError(null)
      })
      .catch((caught: unknown) => {
        if (controller.signal.aborted) return
        setError(caught instanceof Error ? caught.message : 'Could not load.')
      })

    return () => controller.abort()
  }, [month, reloadKey])

  const reload = () => setReloadKey((n) => n + 1)

  const paid = (data?.rows ?? []).filter((row) => row.payment)

  async function undo(row: Row) {
    if (!row.payment || !window.confirm(t('pay.deleteConfirm', { name: row.employee.name }))) return

    try {
      await api(`/api/payroll/payments/${row.payment.id}`, { method: 'DELETE' })
      push('success', t('pay.deleted'))
      reload()
    } catch (caught) {
      push('error', caught instanceof Error ? caught.message : 'Failed.')
    }
  }

  function exportCsv() {
    if (!data) return
    const escape = (value: string | number) => `"${String(value).replace(/"/g, '""')}"`
    const lines = [
      ['Employee', 'Role', 'Branch', 'Salary', 'Commission', 'Bonus', 'Deduction', 'Net', 'Status', 'Paid on'],
      ...paid.map((row) => [
        row.employee.name,
        row.employee.role,
        row.employee.branch?.name ?? '',
        row.salary,
        row.commission,
        row.payment?.bonus ?? '',
        row.payment?.deduction ?? '',
        row.payment?.net ?? row.salary + row.commission,
        row.payment ? 'Paid' : 'Unpaid',
        row.payment ? row.payment.paidAt.slice(0, 10) : '',
      ]),
    ]
    const blob = new Blob([lines.map((line) => line.map(escape).join(',')).join('\n')], {
      type: 'text/csv',
    })
    const link = document.createElement('a')
    link.href = URL.createObjectURL(blob)
    link.download = `payroll-${month}.csv`
    link.click()
    URL.revokeObjectURL(link.href)
  }

  return (
    <div className={base.page}>
      <header className={base.head}>
        <div className={base.mobileHeading}>
          <h1 className={base.title}>{t('pay.title')}</h1>
          <p className={base.subtitle}>{t('pay.note')}</p>
        </div>
        <div className={base.headActions}>
          <button type="button" className={base.primary} onClick={() => setForm('new')} disabled={!data}>
            + {t('pay.paySalary')}
          </button>
          <button type="button" className={base.secondary} onClick={exportCsv} disabled={!data}>
            {t('rep.export')}
          </button>
        </div>
      </header>

      <div className={styles.tiles}>
        <div>
          <strong className="tabular">{data ? currency(data.totals.salary) : '—'}</strong>
          <span>{t('pay.totalSalary')}</span>
        </div>
        <div>
          <strong className="tabular">{data ? currency(data.totals.commission) : '—'}</strong>
          <span>{t('pay.totalCommission')}</span>
        </div>
        <div className={styles.main}>
          <strong className="tabular">{data ? currency(data.totals.paid) : '—'}</strong>
          <span>{t('pay.totalPaid')}</span>
        </div>
        <div>
          <strong className="tabular">{data ? currency(data.totals.unpaid) : '—'}</strong>
          <span>{t('pay.totalUnpaid')}</span>
        </div>
      </div>

      <Card>
        <div className={styles.filters}>
          <label>
            {t('pay.month')}
            <input type="month" value={month} max={thisMonth()} onChange={(event) => event.target.value && setMonth(event.target.value)} />
          </label>
        </div>

        {error ? <Empty>{error}</Empty> : null}

        {!data ? (
          <Empty>{t('common.loading')}</Empty>
        ) : paid.length === 0 ? (
          <Empty>{t('pay.nonePaid')}</Empty>
        ) : (
          <div className={base.scroll}>
            <table className={base.table}>
              <thead>
                <tr>
                  <th scope="col">{t('pay.employee')}</th>
                  <th scope="col">{t('pay.salary')}</th>
                  <th scope="col">{t('pay.commission')}</th>
                  <th scope="col">{t('pay.bonus')}</th>
                  <th scope="col">{t('pay.deduction')}</th>
                  <th scope="col">{t('pay.net')}</th>
                  <th scope="col">{t('pay.paidOn')}</th>
                  <th scope="col" className={base.actionsCol}>
                    {t('common.actions')}
                  </th>
                </tr>
              </thead>
              <tbody>
                {paid.map((row) => (
                  <tr key={row.employee.id}>
                    <td data-label={t('pay.employee')} className={base.strong}>
                      {row.employee.name}
                      <em className={base.sub}>
                        {t(row.employee.role === 'SUPERVISOR' ? 'role.SUPERVISOR' : 'role.SALES')}
                        {row.employee.branch ? ` · ${row.employee.branch.name}` : ''}
                      </em>
                    </td>
                    <td data-label={t('pay.salary')} className="tabular">{currency(row.salary)}</td>
                    <td data-label={t('pay.commission')} className="tabular">{currency(row.commission)}</td>
                    <td data-label={t('pay.bonus')} className="tabular">{currency(row.payment!.bonus)}</td>
                    <td data-label={t('pay.deduction')} className="tabular">{currency(row.payment!.deduction)}</td>
                    <td data-label={t('pay.net')} className={`${base.strong} tabular`}>
                      {currency(row.payment!.net)}
                      {row.payment!.note ? <em className={base.sub}>{row.payment!.note}</em> : null}
                    </td>
                    <td data-label={t('pay.paidOn')}>
                      {shortDate(row.payment!.paidAt)}
                      <em className={base.sub}>{row.payment!.paidBy}</em>
                    </td>
                    <td className={base.actionsCol}>
                      <div style={{ display: 'flex', gap: 12, justifyContent: 'flex-end' }}>
                        <button type="button" className={styles.link} style={{ margin: 0 }} onClick={() => setForm(row)}>
                          {t('prod.edit')}
                        </button>
                        <button type="button" className={styles.remove} onClick={() => void undo(row)}>
                          {t('prod.delete')}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {form && data ? (
        <PayDialog
          rows={data.rows}
          month={month}
          editing={form === 'new' ? null : form}
          onClose={() => setForm(null)}
          onDone={(name, net) => {
            const wasEdit = form !== 'new'
            setForm(null)
            push('success', t(wasEdit ? 'pay.updated' : 'pay.paidToast', { name, amount: currency(net) }))
            reload()
          }}
        />
      ) : null}

      <Toasts toasts={toasts} onDismiss={dismiss} />
    </div>
  )
}

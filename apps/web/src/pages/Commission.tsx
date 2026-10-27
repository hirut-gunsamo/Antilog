import { useEffect, useState } from 'react'
import rowStyles from '../components/RowMenu.module.css'

import { Card, Empty } from '../components/Card'
import { CommissionDialog } from '../components/payroll/CommissionDialog'
import { Toasts } from '../components/Toasts'
import { api } from '../lib/api'
import { CATEGORY_KEY, currency, shortDate } from '../lib/format'
import { useT } from '../lib/i18n'
import { thisMonth } from '../lib/month'
import { useToasts } from '../lib/toasts'
import type { CommissionPaymentRow } from '../lib/types'
import base from './Products.module.css'
import styles from './Ibid.module.css'


/**
 * Commission: what the Owner paid each employee on top of salary, item by
 * item. Pay Commission records one payment with one line per item; each can
 * be edited or deleted. The list is the month's commission report.
 */
export default function Commission() {
  const t = useT()
  const { toasts, push, dismiss } = useToasts()

  const [month, setMonth] = useState(thisMonth())
  const [rows, setRows] = useState<CommissionPaymentRow[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [reloadKey, setReloadKey] = useState(0)
  const [form, setForm] = useState<CommissionPaymentRow | 'new' | null>(null)

  useEffect(() => {
    const controller = new AbortController()

    api<{ commissions: CommissionPaymentRow[] }>(`/api/payroll/commissions?month=${month}`, {
      signal: controller.signal,
    })
      .then((payload) => {
        setRows(payload.commissions ?? [])
        setError(null)
      })
      .catch((caught: unknown) => {
        if (controller.signal.aborted) return
        setError(caught instanceof Error ? caught.message : 'Could not load.')
        setRows([])
      })

    return () => controller.abort()
  }, [month, reloadKey])

  const reload = () => setReloadKey((n) => n + 1)

  // One column per item paid on this month: categories by the name they were
  // paid under, then National ID.
  const labelOf = (line: CommissionPaymentRow['lines'][number]) =>
    line.label ?? (CATEGORY_KEY[line.category] ? t(CATEGORY_KEY[line.category]) : line.category)
  const ITEMS = [...new Set((rows ?? []).flatMap((row) => row.lines.map(labelOf)))].sort(
    (a, b) => Number(a === 'National ID') - Number(b === 'National ID'),
  )

  const amountFor = (row: CommissionPaymentRow, item: string) =>
    row.lines.filter((line) => labelOf(line) === item).reduce((sum, line) => sum + Number(line.amount), 0)

  const totals = {
    all: (rows ?? []).reduce((sum, row) => sum + Number(row.total), 0),
    ...Object.fromEntries(ITEMS.map((item) => [item, (rows ?? []).reduce((sum, row) => sum + amountFor(row, item), 0)])),
  } as Record<string, number>

  async function remove(row: CommissionPaymentRow) {
    if (!window.confirm(t('com.deleteConfirm', { name: row.user.name }))) return

    try {
      await api(`/api/payroll/commissions/${row.id}`, { method: 'DELETE' })
      push('success', t('pay.deleted'))
      reload()
    } catch (caught) {
      push('error', caught instanceof Error ? caught.message : 'Failed.')
    }
  }

  function exportCsv() {
    const escape = (value: string | number) => `"${String(value).replace(/"/g, '""')}"`
    const lines = [
      ['Employee', 'Branch', ...ITEMS.map((item) => item), 'Total', 'Paid on', 'Note'],
      ...(rows ?? []).map((row) => [
        row.user.name,
        row.user.branch?.name ?? '',
        ...ITEMS.map((item) => amountFor(row, item)),
        Number(row.total),
        row.paidAt.slice(0, 10),
        row.note ?? '',
      ]),
    ]
    const blob = new Blob([lines.map((line) => line.map(escape).join(',')).join('\n')], { type: 'text/csv' })
    const link = document.createElement('a')
    link.href = URL.createObjectURL(blob)
    link.download = `commission-${month}.csv`
    link.click()
    URL.revokeObjectURL(link.href)
  }

  return (
    <div className={base.page}>
      <header className={base.head}>
        <div className={base.mobileHeading}>
          <h1 className={base.title}>{t('com.title')}</h1>
          <p className={base.subtitle}>{t('com.note')}</p>
        </div>
        <div className={base.headActions}>
          <button type="button" className={base.primary} onClick={() => setForm('new')}>
            + {t('com.pay')}
          </button>
          <button type="button" className={base.secondary} onClick={exportCsv} disabled={!rows?.length}>
            {t('rep.export')}
          </button>
        </div>
      </header>

      <div className={styles.tiles}>
        <div className={styles.main}>
          <strong className="tabular">{currency(totals.all)}</strong>
          <span>{t('com.total')}</span>
        </div>
        {ITEMS.map((item) => (
          <div key={item}>
            <strong className="tabular">{currency(totals[item])}</strong>
            <span>{item}</span>
          </div>
        ))}
      </div>

      <Card>
        <div className={styles.filters}>
          <label>
            {t('pay.month')}
            <input type="month" value={month} max={thisMonth()} onChange={(event) => event.target.value && setMonth(event.target.value)} />
          </label>
        </div>

        {error ? <Empty>{error}</Empty> : null}

        {rows === null ? (
          <Empty>{t('common.loading')}</Empty>
        ) : rows.length === 0 ? (
          <Empty>{t('com.none')}</Empty>
        ) : (
          <div className={base.scroll}>
            <table className={base.table}>
              <thead>
                <tr>
                  <th scope="col">{t('pay.employee')}</th>
                  {ITEMS.map((item) => (
                    <th key={item} scope="col">
                      {item}
                    </th>
                  ))}
                  <th scope="col">{t('com.total')}</th>
                  <th scope="col">{t('pay.paidOn')}</th>
                  <th scope="col" className={base.actionsCol}>
                    {t('common.actions')}
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id}>
                    <td data-label={t('pay.employee')} className={base.strong}>
                      {row.user.name}
                      <em className={base.sub}>{row.user.branch?.name ?? ''}</em>
                    </td>
                    {ITEMS.map((item) => (
                      <td key={item} data-label={item} className="tabular">
                        {amountFor(row, item) ? currency(amountFor(row, item)) : '—'}
                      </td>
                    ))}
                    <td data-label={t('com.total')} className={`${base.strong} tabular`}>
                      {currency(Number(row.total))}
                      {row.note ? <em className={base.sub}>{row.note}</em> : null}
                    </td>
                    <td data-label={t('pay.paidOn')}>
                      {shortDate(row.paidAt)}
                      <em className={base.sub}>{row.paidBy.name}</em>
                    </td>
                    <td className={base.actionsCol}>
                      <div style={{ display: 'flex', gap: 12, justifyContent: 'flex-end' }}>
                        <button type="button" className={rowStyles.action} style={{ margin: 0 }} onClick={() => setForm(row)}>
                          {t('prod.edit')}
                        </button>
                        <button type="button" className={rowStyles.danger} onClick={() => void remove(row)}>
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

      {form ? (
        <CommissionDialog
          month={month}
          editing={form === 'new' ? null : form}
          onClose={() => setForm(null)}
          onDone={(names, total, skipped) => {
            const wasEdit = form !== 'new'
            setForm(null)
            push('success', t(wasEdit ? 'pay.updated' : 'com.paidToast', { name: names, amount: currency(total) }))
            if (skipped.length > 0) push('info', t('com.skipped', { names: skipped.join(', ') }))
            reload()
          }}
        />
      ) : null}

      <Toasts toasts={toasts} onDismiss={dismiss} />
    </div>
  )
}

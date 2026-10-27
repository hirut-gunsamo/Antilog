import { useEffect, useState } from 'react'
import { businessDay } from '../lib/tz'
import { useSavedState } from '../lib/savedState'

import { Card } from '../components/Card'
import { ProfitReport } from '../components/reports/ProfitReport'
import { Toasts } from '../components/Toasts'
import { api } from '../lib/api'
import { useBranchList } from '../lib/branches'
import { useT } from '../lib/i18n'
import { useToasts } from '../lib/toasts'
import type { ProfitReport as Report } from '../lib/types'
import base from './Products.module.css'
import styles from './Ibid.module.css'

function isoDay(date: Date) {
  return businessDay(date)
}

/**
 * The Owner's profit and loss: what came in, what it all cost, and what is
 * left, for the dates and branch chosen. It only reads; nothing here changes
 * a sale, a price or a payment.
 */
export default function ProfitLoss() {
  const t = useT()
  const { toasts, push, dismiss } = useToasts()
  const branchList = useBranchList()

  const now = new Date()
  const [from, setFrom] = useSavedState('profitloss:from', isoDay(new Date(now.getFullYear(), now.getMonth(), 1)))
  const [to, setTo] = useSavedState('profitloss:to', isoDay(now))
  const [branch, setBranch] = useState('')
  const [report, setReport] = useState<Report | null>(null)

  // One tap for the usual questions: today, yesterday, this week, month, year.
  const today = new Date()
  const monday = new Date(today)
  monday.setDate(today.getDate() - ((today.getDay() + 6) % 7))
  const yesterday = new Date(today)
  yesterday.setDate(today.getDate() - 1)
  const ranges: { key: string; label: string; from: string; to: string }[] = [
    { key: 'today', label: t('pl.today'), from: isoDay(today), to: isoDay(today) },
    { key: 'yesterday', label: t('pl.yesterday'), from: isoDay(yesterday), to: isoDay(yesterday) },
    { key: 'week', label: t('pl.week'), from: isoDay(monday), to: isoDay(today) },
    {
      key: 'month',
      label: t('pl.month'),
      from: isoDay(new Date(today.getFullYear(), today.getMonth(), 1)),
      to: isoDay(today),
    },
    { key: 'year', label: t('pl.year'), from: isoDay(new Date(today.getFullYear(), 0, 1)), to: isoDay(today) },
  ]

  useEffect(() => {
    const controller = new AbortController()
    const query = new URLSearchParams({ from, to })
    if (branch) query.set('branchId', branch)
    api<{ report: Report }>(`/api/reports/profit?${query}`, { signal: controller.signal })
      .then((payload) => setReport(payload.report))
      .catch((caught) => {
        if (controller.signal.aborted) return
        push('error', caught instanceof Error ? caught.message : t('rep.loadFailed'))
      })
    return () => controller.abort()
  }, [from, to, branch, push, t])

  /** The statement and the branch table as shown, for a spreadsheet. */
  function download() {
    if (!report) return
    const branchName = branch ? (branchList.find(([id]) => id === branch)?.[1] ?? '') : 'All branches'
    const name = `profit-and-loss-${from}-to-${to}.csv`
    const escape = (value: string | number) => {
      const text = String(value)
      return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
    }
    const rows: (string | number)[][] = [
      ['Profit and loss', `${from} to ${to}`, branchName],
      [],
      ['Income', ''],
      ...report.income.salesByBranch.map((row) => [`Sales: ${row.name || 'Office (no branch)'}`, row.amount]),
      ['Total item sales', report.income.sales],
      ['National ID', report.income.nationalId],
      ['Total income', report.income.total],
      [],
      ['Costs', ''],
      ['Buying cost of items sold', report.costs.goods],
      ['Branch expenses', report.costs.expenses],
      ['Salaries paid (net)', report.costs.payroll.net],
      ['Commission payments', report.costs.commission],
      ['Damage and loss', report.costs.losses],
      ['Office equipment bought', report.costs.equipment],
      ['Total costs', report.costs.total],
      [],
      [report.profit < 0 ? 'Net loss' : 'Net profit', report.profit],
      ...(report.uncosted.quantity > 0
        ? [[`Items sold without a buying price: ${report.uncosted.quantity}`, report.uncosted.revenue]]
        : []),
      [],
      ['Branch', 'Income', 'Item costs', 'Expenses', 'Salaries', 'Commission', 'Losses', 'Equipment', 'Profit'],
      ...report.byBranch.map((row) => [
        row.name || 'Office (no branch)',
        row.income,
        row.goods,
        row.expenses,
        row.payroll,
        row.commission,
        row.losses,
        row.equipment,
        row.profit,
      ]),
      [],
      ['Daily sales by branch'],
      ['Date', ...report.dailySales.branches.map((entry) => entry.name || 'Office (no branch)'), 'All branches'],
      ...report.dailySales.days.map((day) => [
        day.date,
        ...report.dailySales.branches.map((entry) => day.byBranch[entry.id] ?? 0),
        day.total,
      ]),
      [],
      ['Profit day by day'],
      ['Date', 'Income', 'Item costs', 'Expenses', 'Salaries', 'Commission', 'Losses', 'Equipment', 'Profit'],
      ...report.byDay.map((row) => [
        row.date,
        row.income,
        row.goods,
        row.expenses,
        row.payroll,
        row.commission,
        row.losses,
        row.equipment,
        row.profit,
      ]),
    ]
    const blob = new Blob([rows.map((row) => row.map(escape).join(',')).join('\n')], {
      type: 'text/csv;charset=utf-8',
    })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = name
    link.click()
    URL.revokeObjectURL(url)
    push('success', t('toast.savedToDownloads', { name }))
  }

  return (
    <div className={base.page}>
      <header className={base.head}>
        <div className={base.mobileHeading}>
          <h1 className={base.title}>{t('pl.title')}</h1>
          <p className={base.subtitle}>{t('pl.note')}</p>
        </div>
        <div className={base.headActions}>
          <button type="button" className={base.primary} onClick={download} disabled={!report}>
            {t('pl.download')}
          </button>
        </div>
      </header>

      <Card>
        <div className={styles.filters}>
          {ranges.map((range) => {
            const on = range.from === from && range.to === to
            return (
              <button
                key={range.key}
                type="button"
                className={on ? base.primary : base.secondary}
                aria-pressed={on}
                onClick={() => {
                  setFrom(range.from)
                  setTo(range.to)
                }}
              >
                {range.label}
              </button>
            )
          })}
        </div>
        <div className={styles.filters} style={{ marginBottom: 0 }}>
          <label>
            {t('ibid.from')}
            <input type="date" value={from} max={to} onChange={(event) => setFrom(event.target.value)} />
          </label>
          <label>
            {t('ibid.to')}
            <input type="date" value={to} min={from} onChange={(event) => setTo(event.target.value)} />
          </label>
          <select value={branch} onChange={(event) => setBranch(event.target.value)} aria-label={t('common.branch')}>
            <option value="">{t('inv.allBranches')}</option>
            {branchList.map(([id, name]) => (
              <option key={id} value={id}>
                {name}
              </option>
            ))}
          </select>
        </div>
      </Card>

      <ProfitReport report={report} />

      <Toasts toasts={toasts} onDismiss={dismiss} />
    </div>
  )
}

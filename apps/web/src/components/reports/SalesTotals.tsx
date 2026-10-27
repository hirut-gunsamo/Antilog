import { Fragment, useEffect, useMemo, useState } from 'react'

import { Card, Empty } from '../Card'
import { api } from '../../lib/api'
import { count, currency } from '../../lib/format'
import { useT, type TranslationKey } from '../../lib/i18n'
import { addUpDays, groupByDay, type OtherDay } from '../../lib/salesDays'
import type { Sale } from '../../lib/types'
import styles from '../../pages/Reports.module.css'
import card from '../Card.module.css'
import own from './DailyMoneyReport.module.css'

type Line = { key: string; label: string; quantity: number; amount: number }

// Airtime first: it is most of what a branch handles.
const CATEGORIES: { kind: string; labelKey: TranslationKey }[] = [
  { kind: 'SIM_CARD', labelKey: 'ds.sims' },
  { kind: 'AIRTIME_VOUCHER', labelKey: 'ds.airtime' },
  { kind: 'PHONE', labelKey: 'ds.phones' },
]

/**
 * Everything taken in the chosen dates as one list: each category with its
 * items (Airtime 10, Airtime 15...), SIM transfers, National ID original and
 * copy, Telebirr, and the grand total.
 */
export function SalesTotals({ from, to, branch, reload }: { from: string; to: string; branch: string; reload: number }) {
  const t = useT()
  const [sales, setSales] = useState<Sale[] | null>(null)
  const [others, setOthers] = useState<OtherDay[]>([])
  // The list starts closed: the title or its arrow opens it.
  const [shown, setShown] = useState(false)
  // Groups whose items are showing; each opens with its arrow.
  const [open, setOpen] = useState<Set<string>>(() => new Set())
  const toggle = (key: string) =>
    setOpen((current) => {
      const next = new Set(current)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })

  useEffect(() => {
    const controller = new AbortController()
    const query = new URLSearchParams()
    if (from) query.set('from', from)
    if (to) query.set('to', to)
    if (branch !== 'ALL') query.set('branchId', branch)
    Promise.all([
      api<{ sales: Sale[] }>(`/api/sales?${query.toString()}`, { signal: controller.signal }),
      api<{ days: OtherDay[] }>(`/api/reports/other-daily?${query.toString()}`, {
        signal: controller.signal,
      }).catch(() => ({ days: [] as OtherDay[] })),
    ])
      .then(([salesRes, otherRes]) => {
        // Only sales that count: approved ones.
        setSales((salesRes.sales ?? []).filter((sale) => sale.status === 'APPROVED'))
        setOthers(otherRes.days ?? [])
      })
      .catch(() => {
        if (!controller.signal.aborted) setSales([])
      })
    return () => controller.abort()
  }, [from, to, branch, reload])

  const total = useMemo(
    () => (sales ? addUpDays(groupByDay(sales, others), 'all', '') : null),
    [sales, others],
  )

  // Bills by kind: WiFi, electricity...
  const bills = useMemo(() => {
    const byType = new Map<string, Line>()
    for (const sale of sales ?? []) {
      for (const bill of sale.billPayments ?? []) {
        const key = bill.billType.trim().toLowerCase()
        const line = byType.get(key) ?? { key: `bill:${key}`, label: bill.billType, quantity: 0, amount: 0 }
        line.quantity += 1
        line.amount += Number(bill.amount)
        byType.set(key, line)
      }
    }
    return [...byType.values()].sort((a, b) => b.amount - a.amount)
  }, [sales])

  // Item by item inside each category, in the catalogue's order: Card_10,
  // Card_15, Card_25... (numbers compared as numbers).
  const items = useMemo(() => {
    const byKind = new Map<string, Map<string, Line>>()
    for (const sale of sales ?? []) {
      for (const item of sale.items) {
        const kind = CATEGORIES.some((entry) => entry.kind === item.product.category) ? item.product.category : 'OTHER'
        const lines = byKind.get(kind) ?? new Map<string, Line>()
        const line = lines.get(item.product.id) ?? { key: item.product.id, label: item.product.name, quantity: 0, amount: 0 }
        line.quantity += item.quantity
        line.amount += Number(item.lineTotal)
        lines.set(item.product.id, line)
        byKind.set(kind, lines)
      }
    }
    return (kind: string) =>
      [...(byKind.get(kind)?.values() ?? [])].sort((a, b) =>
        a.label.localeCompare(b.label, undefined, { numeric: true, sensitivity: 'base' }),
      )
  }, [sales])

  if (!total) {
    return (
      <Card title={t('tot.title')}>
        <Empty>{t('common.loading')}</Empty>
      </Card>
    )
  }

  const groups = [
    ...CATEGORIES.map((entry) => ({
      key: entry.kind,
      label: t(entry.labelKey),
      figure: entry.kind === 'SIM_CARD' ? total.sims : entry.kind === 'AIRTIME_VOUCHER' ? total.airtime : total.phones,
      lines: items(entry.kind),
    })),
    { key: 'OTHER', label: t('ds.other'), figure: total.other, lines: items('OTHER') },
  ]
    .filter((group) => group.key !== 'OTHER' || group.figure.quantity > 0)
    .concat([
      { key: 'SIM_TRANSFER', label: t('st.short'), figure: total.simTransfer, lines: [] },
      { key: 'BILLS', label: t('bill.short'), figure: total.bills, lines: bills },
      {
        key: 'NATIONAL_ID',
        label: t('rep.nationalId'),
        figure: { quantity: total.nationalId.count, amount: total.nationalId.amount },
        lines: [
          { key: 'nidOriginal', label: t('nid.originalId'), quantity: total.nidOriginal.count, amount: total.nidOriginal.amount },
          { key: 'nidCopy', label: t('nid.copyId'), quantity: total.nidCopy.count, amount: total.nidCopy.amount },
        ],
      },
      { key: 'TELEBIRR', label: t('tb.title'), figure: { quantity: total.telebirr.count, amount: total.telebirr.amount }, lines: [] },
    ])

  const money: Line[] = [
    { key: 'cash', label: t('ds.cashTotal'), quantity: 0, amount: total.cash },
    { key: 'transfer', label: t('ds.transferTotal'), quantity: 0, amount: total.transfer },
    { key: 'deductions', label: t('rep.deductions'), quantity: 0, amount: total.deductions.amount },
    { key: 'expenses', label: t('rep.expenses'), quantity: 0, amount: total.expenses.amount },
    { key: 'deposits', label: t('ds.depositedShort'), quantity: 0, amount: total.deposits.amount },
    { key: 'net', label: t('ds.afterCosts'), quantity: 0, amount: total.net },
  ]

  return (
    <Card>
      <button
        type="button"
        className={styles.cardToggle}
        aria-expanded={shown}
        onClick={() => setShown((open) => !open)}
      >
        <span>
          <span className={card.title}>{t('tot.title')}</span>
          <span className={card.subtitle}>{t('tot.note')}</span>
        </span>
        <span className={styles.cardArrow} aria-hidden="true">
          {shown ? '▾' : '▸'}
        </span>
      </button>
      {shown ? (
      <div className={styles.scroll} style={{ marginTop: 16 }}>
        {/* No tfoot: these rows are the totals and stay when details are hidden. */}
        <table className={styles.table}>
          <thead>
            <tr>
              <th scope="col">{t('tot.what')}</th>
              <th scope="col">{t('sales.qty')}</th>
              <th scope="col">{t('rep.amount')}</th>
            </tr>
          </thead>
          <tbody>
            {groups.map((group) => (
              <Fragment key={group.key}>
                <tr className={own.dayTotal}>
                  <td data-label={t('tot.what')}>
                    {group.lines.length > 0 ? (
                      <button
                        type="button"
                        className={styles.groupToggle}
                        aria-expanded={open.has(group.key)}
                        onClick={() => toggle(group.key)}
                      >
                        <span aria-hidden="true">{open.has(group.key) ? '▾' : '▸'}</span>
                        {group.label}
                      </button>
                    ) : (
                      group.label
                    )}
                  </td>
                  <td data-label={t('sales.qty')} className="tabular">{count(group.figure.quantity)}</td>
                  <td data-label={t('rep.amount')} className="tabular">{currency(group.figure.amount)}</td>
                </tr>
                {(open.has(group.key) ? group.lines : []).map((line) => (
                  <tr key={line.key}>
                    <td data-label={t('tot.what')} style={{ paddingLeft: 28 }}>{line.label}</td>
                    <td data-label={t('sales.qty')} className="tabular">{count(line.quantity)}</td>
                    <td data-label={t('rep.amount')} className="tabular">{currency(line.amount)}</td>
                  </tr>
                ))}
              </Fragment>
            ))}
            <tr className={own.dayTotal}>
              <td data-label={t('tot.what')} className={styles.strong}>{t('tot.grand')}</td>
              <td data-label={t('sales.qty')} />
              <td data-label={t('rep.amount')} className={`${styles.strong} tabular`}>{currency(total.total)}</td>
            </tr>
            {money.map((line) => (
              <tr key={line.key}>
                <td data-label={t('tot.what')}>{line.label}</td>
                <td data-label={t('sales.qty')} />
                <td data-label={t('rep.amount')} className={line.key === 'net' ? `${styles.strong} tabular` : 'tabular'}>
                  {currency(line.amount)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      ) : null}
    </Card>
  )
}

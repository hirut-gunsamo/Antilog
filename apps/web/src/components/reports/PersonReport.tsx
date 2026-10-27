import { useEffect, useMemo, useState } from 'react'

import { Card, Empty } from '../Card'
import { api } from '../../lib/api'
import { count, currency, shortDate } from '../../lib/format'
import { useT, type TranslationKey } from '../../lib/i18n'
import styles from '../../pages/Reports.module.css'
import own from './PersonReport.module.css'

type Staff = { id: string; name: string; role: string; isActive: boolean; branch?: { name: string } | null }

type PersonReportData = {
  person: { id: string; name: string; role: string; branch: string | null }
  totals: {
    sales: number
    salesCount: number
    items: number
    cash: number
    transfer: number
    nationalId: number
    telebirr: number
    deductions: number
    expenses: number
    lost: number
    banked: number
  }
  sales: {
    id: string
    date: string
    total: number
    cash: number
    transfer: number
    paymentMethod: string
    bankName: string | null
    items: { name: string; quantity: number; total: number }[]
  }[]
  deductions: {
    id: string
    day: string
    total: number
    note: string | null
    lines: { label: string | null; quantity: number; amount: number }[]
  }[]
  expenses: { id: string; date: string; reason: string; note: string | null; amount: number }[]
  losses: {
    id: string
    date: string
    kind: string
    status: string
    product: string
    quantity: number
    value: number
    reason: string
  }[]
  deposits: { id: string; date: string; bankName: string | null; amount: number; status: string }[]
}

const STATUS_KEY: Record<string, TranslationKey> = {
  PENDING: 'loss.statusPending',
  APPROVED: 'loss.statusApproved',
  REJECTED: 'loss.statusRejected',
}

/**
 * Type a salesperson's name and read everything they did in the dates
 * chosen: each sale with every item on it, then their deductions, expenses,
 * stock lost or damaged and bank deposits, with the totals on top.
 */
export function PersonReport({ from, to, reload }: { from: string; to: string; reload: number }) {
  const t = useT()
  const [staff, setStaff] = useState<Staff[]>([])
  const [search, setSearch] = useState('')
  const [report, setReport] = useState<PersonReportData | null>(null)
  const [error, setError] = useState<string | null>(null)

  // The Owner sees everyone, a supervisor their own branch (the API decides).
  useEffect(() => {
    const controller = new AbortController()
    api<{ users: Staff[] }>('/api/users', { signal: controller.signal })
      .then((payload) =>
        setStaff(
          (payload.users ?? [])
            .filter((row) => row.isActive && (row.role === 'SALES' || row.role === 'SUPERVISOR'))
            .sort((a, b) => a.name.localeCompare(b.name)),
        ),
      )
      .catch(() => undefined)
    return () => controller.abort()
  }, [])

  // An exact name wins; otherwise the one name that contains what was typed.
  const term = search.trim().toLowerCase()
  const matches = useMemo(
    () => (term ? staff.filter((row) => row.name.toLowerCase().includes(term)) : []),
    [staff, term],
  )
  const chosen = staff.find((row) => row.name.toLowerCase() === term) ?? (matches.length === 1 ? matches[0] : null)

  useEffect(() => {
    if (!chosen) return
    const controller = new AbortController()
    const query = new URLSearchParams({ userId: chosen.id })
    if (from) query.set('from', from)
    if (to) query.set('to', to)
    api<PersonReportData>(`/api/reports/person?${query.toString()}`, { signal: controller.signal })
      .then((payload) => {
        setReport(payload)
        setError(null)
      })
      .catch((caught) => {
        if (controller.signal.aborted) return
        setReport(null)
        setError(caught instanceof Error ? caught.message : 'Could not load the report.')
      })
    return () => controller.abort()
  }, [chosen, from, to, reload])

  const shown = chosen && report?.person.id === chosen.id ? report : null

  const figures: { key: string; label: string; value: string }[] = shown
    ? [
        { key: 'sales', label: t('pr.sales'), value: currency(shown.totals.sales) },
        { key: 'count', label: t('pr.salesCount'), value: count(shown.totals.salesCount) },
        { key: 'items', label: t('pr.items'), value: count(shown.totals.items) },
        { key: 'cash', label: t('dm.cash'), value: currency(shown.totals.cash) },
        { key: 'transfer', label: t('dm.transfer'), value: currency(shown.totals.transfer) },
        { key: 'nid', label: t('nav.nationalId'), value: currency(shown.totals.nationalId) },
        { key: 'telebirr', label: t('nav.telebirr'), value: currency(shown.totals.telebirr) },
        { key: 'banked', label: t('rep.banked'), value: currency(shown.totals.banked) },
        { key: 'deductions', label: t('rep.deductions'), value: currency(shown.totals.deductions) },
        { key: 'expenses', label: t('rep.expenses'), value: currency(shown.totals.expenses) },
        { key: 'lost', label: t('pr.lost'), value: currency(shown.totals.lost) },
      ]
    : []

  return (
    <Card title={t('pr.title')} subtitle={t('pr.note')}>
      <div className={own.search}>
        <input
          type="search"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          list="person-report-names"
          placeholder={t('pr.searchPlaceholder')}
          aria-label={t('pr.searchPlaceholder')}
        />
        <datalist id="person-report-names">
          {staff.map((row) => (
            <option key={row.id} value={row.name} />
          ))}
        </datalist>
      </div>

      {term && !chosen ? (
        matches.length > 1 ? (
          <div className={own.picks}>
            {matches.map((row) => (
              <button key={row.id} type="button" onClick={() => setSearch(row.name)}>
                {row.name}
                {row.branch?.name ? <em>{row.branch.name}</em> : null}
              </button>
            ))}
          </div>
        ) : (
          <Empty>{t('pr.noMatch')}</Empty>
        )
      ) : null}

      {chosen && error ? <p className={own.error}>{error}</p> : null}
      {chosen && !shown && !error ? <Empty>{t('common.loading')}</Empty> : null}

      {shown ? (
        <>
          <p className={own.who}>
            <strong>{shown.person.name}</strong>
            {shown.person.branch ? ` · ${shown.person.branch}` : ''}
          </p>

          <dl className={own.figures}>
            {figures.map((figure) => (
              <div key={figure.key}>
                <dt>{figure.label}</dt>
                <dd className="tabular">{figure.value}</dd>
              </div>
            ))}
          </dl>

          <h3 className={own.heading}>{t('pr.salesList')}</h3>
          {shown.sales.length === 0 ? (
            <Empty>{t('rep.noSalesPeriod')}</Empty>
          ) : (
            <div className={styles.scroll}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th scope="col">{t('req.date')}</th>
                    <th scope="col">{t('sales.items')}</th>
                    <th scope="col">{t('pr.total')}</th>
                    <th scope="col">{t('pay.received')}</th>
                  </tr>
                </thead>
                <tbody>
                  {shown.sales.map((sale) => (
                    <tr key={sale.id}>
                      <td data-label={t('req.date')}>{shortDate(sale.date)}</td>
                      <td data-label={t('sales.items')}>
                        {sale.items.map((item, index) => (
                          <span key={index} className={own.line}>
                            {item.name} × <span className="tabular">{count(item.quantity)}</span>
                            <span className="tabular"> · {currency(item.total)}</span>
                          </span>
                        ))}
                      </td>
                      <td data-label={t('pr.total')} className={`${styles.strong} tabular`}>
                        {currency(sale.total)}
                      </td>
                      <td data-label={t('pay.received')} className="tabular">
                        {sale.paymentMethod === 'TRANSFER'
                          ? `${t('pay.transfer')} ${currency(sale.transfer)}`
                          : sale.paymentMethod === 'MIXED'
                            ? `${t('pay.cash')} ${currency(sale.cash)} + ${t('pay.transfer')} ${currency(sale.transfer)}`
                            : `${t('pay.cash')} ${currency(sale.cash)}`}
                        {sale.bankName ? <em className={styles.sub}>{sale.bankName}</em> : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {shown.deductions.length > 0 ? (
            <>
              <h3 className={own.heading}>{t('rep.deductions')}</h3>
              <div className={styles.scroll}>
                <table className={styles.table}>
                  <thead>
                    <tr>
                      <th scope="col">{t('req.date')}</th>
                      <th scope="col">{t('pr.what')}</th>
                      <th scope="col">{t('pr.total')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {shown.deductions.map((row) => (
                      <tr key={row.id}>
                        <td data-label={t('req.date')}>{shortDate(`${row.day}T12:00:00`)}</td>
                        <td data-label={t('pr.what')}>
                          {row.lines.map((line, index) => (
                            <span key={index} className={own.line}>
                              {line.label ? `${line.label} × ${count(line.quantity)}` : t('ded.otherLine')} ·{' '}
                              <span className="tabular">{currency(line.amount)}</span>
                            </span>
                          ))}
                          {row.note ? <em className={styles.sub}>{row.note}</em> : null}
                        </td>
                        <td data-label={t('pr.total')} className={`${styles.strong} tabular`}>
                          {currency(row.total)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          ) : null}

          {shown.expenses.length > 0 ? (
            <>
              <h3 className={own.heading}>{t('rep.expenses')}</h3>
              <div className={styles.scroll}>
                <table className={styles.table}>
                  <thead>
                    <tr>
                      <th scope="col">{t('req.date')}</th>
                      <th scope="col">{t('exp.reason')}</th>
                      <th scope="col">{t('pr.total')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {shown.expenses.map((row) => (
                      <tr key={row.id}>
                        <td data-label={t('req.date')}>{shortDate(row.date)}</td>
                        <td data-label={t('exp.reason')}>
                          {row.reason}
                          {row.note ? <em className={styles.sub}>{row.note}</em> : null}
                        </td>
                        <td data-label={t('pr.total')} className={`${styles.strong} tabular`}>
                          {currency(row.amount)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          ) : null}

          {shown.losses.length > 0 ? (
            <>
              <h3 className={own.heading}>{t('pr.lossList')}</h3>
              <div className={styles.scroll}>
                <table className={styles.table}>
                  <thead>
                    <tr>
                      <th scope="col">{t('req.date')}</th>
                      <th scope="col">{t('pr.what')}</th>
                      <th scope="col">{t('common.status')}</th>
                      <th scope="col">{t('pr.total')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {shown.losses.map((row) => (
                      <tr key={row.id}>
                        <td data-label={t('req.date')}>{shortDate(row.date)}</td>
                        <td data-label={t('pr.what')}>
                          {row.product} × <span className="tabular">{count(row.quantity)}</span> ·{' '}
                          {t(row.kind === 'LOST' ? 'loss.lost' : 'loss.damaged')}
                          {row.reason ? <em className={styles.sub}>{row.reason}</em> : null}
                        </td>
                        <td data-label={t('common.status')}>
                          {STATUS_KEY[row.status] ? t(STATUS_KEY[row.status]) : row.status}
                        </td>
                        <td data-label={t('pr.total')} className={`${styles.strong} tabular`}>
                          {currency(row.value)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          ) : null}

          {shown.deposits.length > 0 ? (
            <>
              <h3 className={own.heading}>{t('pr.deposits')}</h3>
              <div className={styles.scroll}>
                <table className={styles.table}>
                  <thead>
                    <tr>
                      <th scope="col">{t('req.date')}</th>
                      <th scope="col">{t('rep.bank')}</th>
                      <th scope="col">{t('common.status')}</th>
                      <th scope="col">{t('pr.total')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {shown.deposits.map((row) => (
                      <tr key={row.id}>
                        <td data-label={t('req.date')}>{shortDate(row.date)}</td>
                        <td data-label={t('rep.bank')}>{row.bankName ?? '—'}</td>
                        <td data-label={t('common.status')}>{row.status}</td>
                        <td data-label={t('pr.total')} className={`${styles.strong} tabular`}>
                          {currency(row.amount)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          ) : null}
        </>
      ) : null}
    </Card>
  )
}

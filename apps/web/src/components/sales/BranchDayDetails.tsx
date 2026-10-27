import { useEffect, useState } from 'react'

import { useAuth } from '../../auth/context'
import { api } from '../../lib/api'

import { count, currency, shortDate } from '../../lib/format'
import { useT } from '../../lib/i18n'
import type { BranchDeposit, SalesDay } from '../../lib/salesDays'
import styles from '../inventory/Panel.module.css'
import own from './SaleDetails.module.css'

/**
 * A branch's day in short: its totals, each salesperson on one line, what
 * the supervisor banked, and the yadere the branch keeps overnight. A
 * salesperson's line opens their own day.
 */
export function BranchDayDetails({
  total,
  people,
  slips,
  onOpenPerson,
  onClose,
}: {
  total: SalesDay
  people: SalesDay[]
  slips: BranchDeposit[]
  onOpenPerson: (day: SalesDay) => void
  onClose: () => void
}) {
  const t = useT()
  const { user } = useAuth()
  // The Owner opens the whole day to every salesperson at once.
  const [allowing, setAllowing] = useState(false)
  const [allowed, setAllowed] = useState(false)
  const [allowError, setAllowError] = useState<string | null>(null)

  async function allowAll() {
    setAllowing(true)
    setAllowError(null)
    try {
      for (const day of people) {
        await api('/api/sales/allow-edits', {
          method: 'POST',
          body: { salespersonId: day.salesperson.id, day: day.date },
        })
      }
      setAllowed(true)
    } catch (caught) {
      setAllowError(caught instanceof Error ? caught.message : 'Could not allow it.')
    } finally {
      setAllowing(false)
    }
  }

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  const supervisorBanked = slips.reduce((sum, row) => sum + row.amount, 0)

  // Airtime each salesperson sold, value by value (cartas), and the branch's.
  const airtime = new Map<string, { id: string; name: string }>()
  const soldBy = new Map<string, Map<string, number>>()
  for (const day of people) {
    const mine = new Map<string, number>()
    for (const sale of day.sales) {
      for (const item of sale.items) {
        if (item.product.category !== 'AIRTIME_VOUCHER') continue
        airtime.set(item.product.id, { id: item.product.id, name: item.product.name })
        mine.set(item.product.id, (mine.get(item.product.id) ?? 0) + item.quantity)
      }
    }
    soldBy.set(day.key, mine)
  }
  const values = [...airtime.values()].sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }))
  const personTotal = (key: string) => [...(soldBy.get(key)?.values() ?? [])].reduce((sum, n) => sum + n, 0)
  const valueTotal = (id: string) => people.reduce((sum, day) => sum + (soldBy.get(day.key)?.get(id) ?? 0), 0)
  // The value that sold most that day, so it is seen at a glance.
  const best = values.reduce<{ id: string; n: number } | null>((top, value) => {
    const n = valueTotal(value.id)
    return n > 0 && (!top || n > top.n) ? { id: value.id, n } : top
  }, null)

  return (
    <div className={styles.scrim} onClick={onClose}>
      <aside
        className={styles.panel}
        role="dialog"
        aria-modal="true"
        aria-label={total.branch}
        onClick={(event) => event.stopPropagation()}
      >
        <header className={styles.head}>
          <div>
            <h2>{total.branch}</h2>
            <p>
              {t('bd.title')} · {shortDate(`${total.date}T12:00:00`)}
            </p>
          </div>
          <button type="button" onClick={onClose} aria-label={t('common.close')}>
            ✕
          </button>
        </header>

        <div className={styles.body}>
          {user?.role === 'OWNER' && people.length > 0 ? (
            <div className={own.allow}>
              {allowed ? (
                <p>{t('bd.allEditAllowed')}</p>
              ) : (
                <>
                  <button type="button" className={styles.cancel} disabled={allowing} onClick={() => void allowAll()}>
                    {t('bd.allowAll')}
                  </button>
                  <small>{t('bd.allowAllNote')}</small>
                </>
              )}
              {allowError ? <p className={styles.error}>{allowError}</p> : null}
            </div>
          ) : null}

          <dl className={own.final}>
            {[
              { key: 'total', label: t('det.dayTotal'), value: currency(total.total) },
              { key: 'ded', label: t('rep.deductions'), value: `− ${currency(total.deductions.amount)}`, tone: 'bad' },
              { key: 'exp', label: t('rep.expenses'), value: `− ${currency(total.expenses.amount)}`, tone: 'bad' },
              { key: 'transfer', label: t('ds.transferTotal'), value: currency(total.transfer) },
              { key: 'cash', label: t('ds.cashTotal'), value: currency(total.cash) },
              { key: 'deposited', label: t('ds.depositedShort'), value: currency(total.deposits.amount) },
              { key: 'yadereDeposit', label: t('ds.yadereDeposit'), value: currency(total.yadereDeposit) },
              { key: 'yadere', label: t('ds.yadere'), value: currency(total.yadere), strong: true },
            ].map((figure) => (
              <div key={figure.key} data-tone={figure.tone} data-strong={figure.strong ? '' : undefined}>
                <dt>{figure.label}</dt>
                <dd className="tabular">{figure.value}</dd>
              </div>
            ))}
          </dl>

          {/* Each salesperson on one line; a line opens their day. */}
          <section className={own.payment}>
            <h3>{t('bd.people')}</h3>
            <div className={own.peopleScroll}>
              <table className={own.people}>
                <thead>
                  <tr>
                    <th scope="col">{t('sales.employee')}</th>
                    <th scope="col">{t('det.dayTotal')}</th>
                    <th scope="col">{t('ds.transferTotal')}</th>
                    <th scope="col">{t('ds.cashTotal')}</th>
                    <th scope="col">{t('ds.depositedShort')}</th>
                    <th scope="col">{t('ds.netBalance')}</th>
                  </tr>
                </thead>
                <tbody>
                  {people.map((day) => (
                    <tr key={day.key} onClick={() => onOpenPerson(day)}>
                      <td>{day.salesperson.name}</td>
                      <td className="tabular">{currency(day.total)}</td>
                      <td className="tabular">{currency(day.transfer)}</td>
                      <td className="tabular">{currency(day.cash)}</td>
                      <td className="tabular">{currency(day.deposits.amount)}</td>
                      <td className="tabular">
                        <strong>{currency(day.net)}</strong>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          {/* Airtime by salesperson: each value sold, their total, and the
              branch's total for each value. */}
          {values.length > 0 ? (
            <section className={own.payment}>
              <h3>{t('bd.airtime')}</h3>
              <div className={own.peopleScroll}>
                <table className={own.people}>
                  <thead>
                    <tr>
                      <th scope="col">{t('sales.employee')}</th>
                      {values.map((value) => (
                        <th key={value.id} scope="col">
                          {value.name}
                        </th>
                      ))}
                      <th scope="col">{t('ds.total')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {people.map((day) => (
                      <tr key={day.key}>
                        <td>{day.salesperson.name}</td>
                        {values.map((value) => (
                          <td key={value.id} className="tabular">
                            {count(soldBy.get(day.key)?.get(value.id) ?? 0)}
                          </td>
                        ))}
                        <td className="tabular">
                          <strong>{count(personTotal(day.key))}</strong>
                        </td>
                      </tr>
                    ))}
                    <tr className={own.peopleTotal}>
                      <td>{t('ds.branchTotal')}</td>
                      {values.map((value) => (
                        <td key={value.id} className="tabular" data-best={best?.id === value.id ? '' : undefined}>
                          {count(valueTotal(value.id))}
                          {best?.id === value.id ? <em className={own.bestTag}>{t('bd.mostSold')}</em> : null}
                        </td>
                      ))}
                      <td className="tabular">
                        {count(values.reduce((sum, value) => sum + valueTotal(value.id), 0))}
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
              <p className={own.salePaid}>{t('bd.airtimeNote')}</p>
            </section>
          ) : null}

          {/* The branch's cash: last night's yadere, what the salespeople
              handed in, what the supervisor banked; the rest stays overnight. */}
          <section className={own.payment}>
            <h3>{t('bd.cash')}</h3>
            <dl>
              <div>
                <dt>{t('bd.yadereBefore')}</dt>
                <dd className="tabular">{currency(total.broughtForward)}</dd>
              </div>
              <div>
                <dt>{t('bd.handedIn')}</dt>
                <dd className="tabular">{currency(total.handedOver)}</dd>
              </div>
              {slips.flatMap((slip) =>
                slip.items.map((item, index) => (
                  <div key={`${slip.date}-${index}`}>
                    <dt>
                      {t('det.depositedTo', { bank: item.bankName ?? '—' })}
                      <em>
                        {item.by}
                        {item.status === 'PENDING' ? ` · ${t('det.notVerified')}` : ''}
                      </em>
                    </dt>
                    <dd className="tabular">− {currency(item.amount)}</dd>
                  </div>
                )),
              )}
              {slips.flatMap((slip) =>
                (slip.expenses ?? []).map((item, index) => (
                  <div key={`${slip.date}-exp-${index}`}>
                    <dt>
                      {t('rep.expenses')}: {item.reason}
                      <em>{item.by}</em>
                    </dt>
                    <dd className="tabular">− {currency(item.amount)}</dd>
                  </div>
                )),
              )}
              {supervisorBanked === 0 ? (
                <div>
                  <dt>{t('bd.supervisorBanked')}</dt>
                  <dd className="tabular">{currency(0)}</dd>
                </div>
              ) : null}
              <div className={own.netTotal}>
                <dt>{t('det.yadere')}</dt>
                <dd className="tabular">{currency(total.yadere)}</dd>
              </div>
            </dl>
            {(total.overDeposited ?? 0) > 0 ? (
              <p className={own.salePaid}>{t('bd.overDeposited', { amount: currency(total.overDeposited ?? 0) })}</p>
            ) : null}
          </section>
        </div>
      </aside>
    </div>
  )
}

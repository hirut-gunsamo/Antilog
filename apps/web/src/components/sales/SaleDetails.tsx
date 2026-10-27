import { useEffect, useState } from 'react'
import { businessDay } from '../../lib/tz'

import { useAuth } from '../../auth/context'
import { api } from '../../lib/api'
import { count, currency, shortDate } from '../../lib/format'
import { useT } from '../../lib/i18n'
import { saleItemCount, saleRef, STATUS_KEY } from '../../lib/sales'
import { groupByDay, type SalesDay } from '../../lib/salesDays'
import { DayCorrections } from './DayCorrections'
import { PaymentFixDialog } from './PaymentFixDialog'
import type { Sale, SaleItem } from '../../lib/types'
import styles from '../inventory/Panel.module.css'
import own from './SaleDetails.module.css'

function saleTime(iso: string) {
  const when = new Date(iso)
  return Number.isNaN(when.getTime()) ? '' : when.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
}

// A serialised line names the exact units that left the shelf.
function unitLabel(unit: SaleItem['inventoryUnits'][number]) {
  return unit.iccid ?? unit.imei ?? unit.serialNumber ?? unit.id.slice(-8)
}

/** Lines added up by product: how many, at what price, for how much. */
function combine(sales: Sale[]) {
  const byProduct = new Map<string, { id: string; name: string; quantity: number; price: number; amount: number }>()
  for (const sale of sales) {
    for (const item of sale.items) {
      const row = byProduct.get(item.product.id) ?? {
        id: item.product.id,
        name: item.product.name,
        quantity: 0,
        price: Number(item.unitPrice),
        amount: 0,
      }
      row.quantity += item.quantity
      row.amount += Number(item.lineTotal)
      byProduct.set(item.product.id, row)
    }
  }
  return [...byProduct.values()].sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }))
}

/**
 * The day of the salesperson behind the sale that was clicked: everything
 * they sold that day added up product by product, the day's total and how it
 * was paid, then each sale of the day, which opens to show its own items.
 */
export function SaleDetails({
  sale,
  daySales,
  day: summary,
  showEachSale = true,
  onChanged,
  onClose,
}: {
  /** Called after a correction made from here, so the page reloads. */
  onChanged?: () => void
  /** The sale clicked; absent when a whole day was opened. */
  sale?: Sale
  /** That salesperson's sales on the same day, the clicked one included. */
  daySales?: Sale[]
  /** A salesperson's day, National ID and Telebirr included. */
  day?: SalesDay
  /** False for a supervisor, who reads the day's totals, not each customer. */
  showEachSale?: boolean
  onClose: () => void
}) {
  const t = useT()
  const { user } = useAuth()
  const [allowing, setAllowing] = useState(false)
  const [allowedNow, setAllowedNow] = useState(false)
  const [allowError, setAllowError] = useState<string | null>(null)
  // A salesperson asks the Owner to open one of their past days.
  const [askedNow, setAskedNow] = useState(false)
  const now = new Date()
  const todayKey = businessDay(now)
  // Everything reads off one day: the one given, or built from the sales.
  const fallback = daySales && daySales.length > 0 ? daySales : sale ? [sale] : []
  const d = summary ?? groupByDay(fallback)[0]
  // A salesperson looking at their own day sees the correction form first.
  const ownDay = user?.role === 'SALES' && d != null && d.salesperson.id === user.id
  const day = d?.sales ?? []
  const [openId, setOpenId] = useState<string | null>(sale?.id ?? null)

  // Fixing how the day's sales were paid (a mistyped transfer amount): open
  // on the day itself, else once the Owner allows it for 24 hours.
  const [payGrant, setPayGrant] = useState<{ requestedAt: string | null; until: string | null } | null>(null)
  const [payList, setPayList] = useState(false)
  const [payFixing, setPayFixing] = useState<Sale | null>(null)
  const [payMessage, setPayMessage] = useState<string | null>(null)
  const dayKey = d?.date ?? ''
  useEffect(() => {
    if (!ownDay || !dayKey) return
    const controller = new AbortController()
    api<{ grant: { requestedAt: string | null; until: string | null } | null }>(
      `/api/sales/payment-edit-status?day=${dayKey}`,
      { signal: controller.signal },
    )
      .then((payload) => setPayGrant(payload.grant))
      .catch(() => undefined)
    return () => controller.abort()
  }, [ownDay, dayKey])
  const payOpen =
    dayKey === todayKey || (payGrant?.until != null && new Date(payGrant.until) > new Date())
  const payAsked = payGrant?.requestedAt != null

  async function askPaymentEdit() {
    try {
      const payload = await api<{ grant: { requestedAt: string | null; until: string | null } }>(
        '/api/sales/request-payment-edit',
        { method: 'POST', body: { day: dayKey } },
      )
      setPayGrant(payload.grant)
    } catch (caught) {
      setPayMessage(caught instanceof Error ? caught.message : 'Could not send it.')
    }
  }
  const name = d?.salesperson.name ?? sale?.salesperson.name ?? ''
  const when = d ? `${d.date}T12:00:00` : (sale?.saleDate ?? '')
  const branch = d?.branch ?? sale?.location.name ?? ''

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose()
    }

    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  const lines = combine(day)
  const total = d?.total ?? 0
  const units = day.reduce((sum, row) => sum + saleItemCount(row), 0)
  const deductions = d?.deductions.amount ?? 0
  // The day's sale ID: the one sale, or the first with how many more.
  const saleId =
    day.length === 0 ? '—' : day.length === 1 ? saleRef(day[0]) : `${saleRef(day[0])} +${day.length - 1}`

  // National ID and Telebirr always listed, at zero when nothing was done.
  const extras = [
    { key: 'simTransfer', label: t('st.short'), count: d?.simTransfer.quantity ?? 0, amount: d?.simTransfer.amount ?? 0 },
    { key: 'bills', label: t('bill.short'), count: d?.bills.quantity ?? 0, amount: d?.bills.amount ?? 0 },
    { key: 'nidOriginal', label: t('det.nidOriginal'), count: d?.nidOriginal.count ?? 0, amount: d?.nidOriginal.amount ?? 0 },
    { key: 'nidCopy', label: t('det.nidCopy'), count: d?.nidCopy.count ?? 0, amount: d?.nidCopy.amount ?? 0 },
    { key: 'telebirr', label: t('nav.telebirr'), count: d?.telebirr.count ?? 0, amount: d?.telebirr.amount ?? 0 },
  ]

  return (
    <div className={styles.scrim} onClick={onClose}>
      <aside
        className={styles.panel}
        role="dialog"
        aria-modal="true"
        aria-label={t('det.dayOf', { name })}
        onClick={(event) => event.stopPropagation()}
      >
        <header className={styles.head}>
          <div>
            <h2>{name}</h2>
            <p>
              {t('det.daySales')} · {shortDate(when)} · {branch}
            </p>
          </div>
          <button type="button" onClick={onClose} aria-label={t('common.close')}>
            ✕
          </button>
        </header>

        <div className={styles.body}>
          {/* A salesperson's own day opens on correcting it; the day's figures
              below are for everyone else. */}
          {ownDay && d ? (
            <DayCorrections day={d} onChanged={() => onChanged?.()} />
          ) : null}

          {!ownDay ? (
            <>
          <div className={own.summary}>
            <div>
              <span>{t('det.saleId')}</span>
              <strong className="tabular">{saleId}</strong>
            </div>
            <div>
              <span>{t('det.itemsSold')}</span>
              <strong className="tabular">{count(units)}</strong>
            </div>
            <div>
              <span>{t('det.dayTotal')}</span>
              <strong className="tabular">{currency(total)}</strong>
            </div>
            <div data-tone="bad">
              <span>{t('rep.deductions')}</span>
              <strong className="tabular">− {currency(deductions)}</strong>
            </div>
            <div data-tone="bad">
              <span>{t('rep.expenses')}</span>
              <strong className="tabular">− {currency(d?.expenses.amount ?? 0)}</strong>
            </div>
          </div>
            </>
          ) : null}

          {/* The Owner lets the salesperson correct a past day's sales, until
              the end of today. */}
          {user?.role === 'OWNER' && d && (d.sales.length > 0 || d.telebirr.count > 0 || d.nationalId.count > 0) ? (
            <div className={own.allow}>
              {allowedNow || d.sales.some((row) => row.editAllowedUntil && new Date(row.editAllowedUntil) > new Date()) ? (
                <p>{t('det.editAllowed', { name: name.split(' ')[0] })}</p>
              ) : (
                <>
                  {d.sales.some((row) => row.editRequestedAt) ? (
                    <p className={own.asked}>{t('det.editAsked', { name: name.split(' ')[0] })}</p>
                  ) : null}
                  <button
                    type="button"
                    className={styles.cancel}
                    disabled={allowing}
                    onClick={async () => {
                      setAllowing(true)
                      setAllowError(null)
                      try {
                        await api('/api/sales/allow-edits', {
                          method: 'POST',
                          body: { salespersonId: d.salesperson.id, day: d.date },
                        })
                        setAllowedNow(true)
                      } catch (caught) {
                        setAllowError(caught instanceof Error ? caught.message : 'Could not allow it.')
                      } finally {
                        setAllowing(false)
                      }
                    }}
                  >
                    {t('det.allowEdit', { name: name.split(' ')[0] })}
                  </button>
                  <small>{t('det.allowEditNote', { name: name.split(' ')[0] })}</small>
                </>
              )}
              {allowError ? <p className={styles.error}>{allowError}</p> : null}
            </div>
          ) : null}

          {/* A salesperson's own past day: ask the Owner to open it. */}
          {user?.role === 'SALES' && d && d.salesperson.id === user.id && d.date !== todayKey && d.sales.length > 0 ? (
            <div className={own.allow}>
              {d.sales.some((row) => row.editAllowedUntil && new Date(row.editAllowedUntil) > new Date()) ? (
                <p>{t('det.youCanEdit')}</p>
              ) : askedNow || d.sales.some((row) => row.editRequestedAt) ? (
                <p className={own.asked}>{t('sales.editRequested')}</p>
              ) : (
                <>
                  <button
                    type="button"
                    className={styles.cancel}
                    disabled={allowing}
                    onClick={async () => {
                      setAllowing(true)
                      setAllowError(null)
                      try {
                        await api('/api/sales/request-day-edit', { method: 'POST', body: { day: d.date } })
                        setAskedNow(true)
                      } catch (caught) {
                        setAllowError(caught instanceof Error ? caught.message : 'Could not send it.')
                      } finally {
                        setAllowing(false)
                      }
                    }}
                  >
                    {t('det.askEditDay')}
                  </button>
                  <small>{t('det.askEditDayNote')}</small>
                </>
              )}
              {allowError ? <p className={styles.error}>{allowError}</p> : null}
            </div>
          ) : null}

          {!ownDay ? (
            <>
          {/* The day's final numbers at a glance: what came in, what came off,
              how it was paid, what went to the bank and what is still held. */}
          {d ? (
            <dl className={own.final}>
              {[
                { key: 'total', label: t('det.dayTotal'), value: currency(d.total) },
                { key: 'ded', label: t('rep.deductions'), value: `− ${currency(d.deductions.amount)}`, tone: 'bad' },
                { key: 'exp', label: t('rep.expenses'), value: `− ${currency(d.expenses.amount)}`, tone: 'bad' },
                { key: 'net', label: t('ds.afterCosts'), value: currency(d.net), strong: true },
                { key: 'transfer', label: t('ds.transferTotal'), value: currency(d.transfer) },
                { key: 'cash', label: t('ds.cashTotal'), value: currency(d.cash) },
                { key: 'deposited', label: t('ds.depositedShort'), value: currency(d.deposits.amount) },
              ].map((figure) => (
                <div key={figure.key} data-tone={figure.tone} data-strong={figure.strong ? '' : undefined}>
                  <dt>{figure.label}</dt>
                  <dd className="tabular">{figure.value}</dd>
                </div>
              ))}
            </dl>
          ) : null}

          {/* The whole day, product by product, National ID and Telebirr
              included, then the total. */}
          <section className={own.items}>
            <div className={own.itemsHead} aria-hidden="true">
              <span>{t('dlg.product')}</span>
              <span>{t('sales.qty')}</span>
              <span>{t('prod.price')}</span>
              <span>{t('pr.total')}</span>
            </div>
            <ul>
              {lines.map((line) => (
                <li key={line.id} className={own.itemRow}>
                  <span className={own.itemName}>{line.name}</span>
                  <span className={`${own.itemQty} tabular`}>{count(line.quantity)}</span>
                  <span className={`${own.itemPrice} tabular`}>{currency(line.price)}</span>
                  <span className={`${own.itemAmount} tabular`}>{currency(line.amount)}</span>
                </li>
              ))}
              {extras.map((extra) => (
                <li key={extra.key} className={own.itemRow} data-zero={extra.count === 0 ? '' : undefined}>
                  <span className={own.itemName}>{extra.label}</span>
                  <span className={`${own.itemQty} tabular`}>{count(extra.count)}</span>
                  <span className={own.itemPrice} />
                  <span className={`${own.itemAmount} tabular`}>{currency(extra.amount)}</span>
                </li>
              ))}
            </ul>
            <div className={own.itemsTotal}>
              <span>
                {t('det.dayTotal')}
                <em>
                  {count(units)} {t('det.items').toLowerCase()}
                </em>
              </span>
              <strong className="tabular">{currency(total)}</strong>
            </div>
          </section>
            </>
          ) : null}

          {/* What was taken off the day, and what is left after it. */}
          {d && deductions > 0 ? (
            <section className={own.payment}>
              <h3>{t('rep.deductions')}</h3>
              <dl>
                {d.deductions.items.map((item, index) => (
                  <div key={index}>
                    <dt>
                      {item.label ? `${item.label} × ${count(item.quantity)}` : t('ded.otherLine')}
                      {item.note ? <em>{item.note}</em> : null}
                    </dt>
                    <dd className="tabular">− {currency(item.amount)}</dd>
                  </div>
                ))}
              </dl>

              <dl className={own.net}>
                <div>
                  <dt>{t('det.dayTotal')}</dt>
                  <dd className="tabular">{currency(d.total)}</dd>
                </div>
                <div data-tone="bad">
                  <dt>{t('rep.deductions')}</dt>
                  <dd className="tabular">− {currency(deductions)}</dd>
                </div>
                <div className={own.netTotal}>
                  <dt>{t('ds.afterDeductions')}</dt>
                  <dd className="tabular">{currency(d.total - deductions)}</dd>
                </div>
              </dl>
            </section>
          ) : null}

          {/* How it was paid: what customers transferred, bank by bank, and
              the rest, which came in cash. */}
          <section className={own.payment}>
            <h3 className={own.payHead}>
              {t('pay.method')}
              {/* The salesperson's own day: fix a mistyped transfer. */}
              {ownDay ? (
                payOpen ? (
                  <button type="button" className={own.payEdit} onClick={() => setPayList((open) => !open)}>
                    {t(payList ? 'common.close' : 'pe.edit')}
                  </button>
                ) : payAsked ? (
                  <span className={own.payWait}>{t('pe.waiting')}</span>
                ) : (
                  <button type="button" className={own.payEdit} onClick={() => void askPaymentEdit()}>
                    {t('pe.ask')}
                  </button>
                )
              ) : null}
            </h3>
            {payMessage ? <p className={styles.error}>{payMessage}</p> : null}
            {ownDay && payOpen && payList ? (
              <ul className={own.payList}>
                {[...day]
                  .sort((a, b) => Number(b.transferReceived) - Number(a.transferReceived))
                  .map((row) => (
                    <li key={row.id}>
                      <span>
                        {saleRef(row)} · {currency(Number(row.totalAmount))}
                        <em>
                          {row.paymentMethod === 'CASH'
                            ? t('pay.cash')
                            : `${t('pay.transfer')} ${currency(Number(row.transferReceived))} · ${row.bankName ?? ''}`}
                        </em>
                      </span>
                      <button type="button" className={own.payEdit} onClick={() => setPayFixing(row)}>
                        {t('pe.editOne')}
                      </button>
                    </li>
                  ))}
              </ul>
            ) : null}
            <dl>
              {(d?.banks ?? []).map((bank) => (
                <div key={bank.bankName}>
                  <dt>
                    {t('pay.transfer')}
                    <em>{bank.bankName}</em>
                  </dt>
                  <dd className="tabular">{currency(bank.amount)}</dd>
                </div>
              ))}
              {(d?.banks.length ?? 0) === 0 ? (
                <div>
                  <dt>{t('pay.transfer')}</dt>
                  <dd className="tabular">{currency(0)}</dd>
                </div>
              ) : null}
              <div>
                <dt>{t('pay.cash')}</dt>
                <dd className="tabular">{currency(d?.cash ?? 0)}</dd>
              </div>
              <div className={own.netTotal}>
                <dt>{t('det.dayTotal')}</dt>
                <dd className="tabular">{currency(total)}</dd>
              </div>
            </dl>
          </section>

          {/* The day's cash, linked through: taken in, less deductions and
              expenses, less what the salesperson banked; the rest goes to the
              supervisor at the end of the day. */}
          <section className={own.payment}>
            <h3>{t('det.cashFlow')}</h3>
            <dl>
              <div>
                <dt>{t('det.cashTaken')}</dt>
                <dd className="tabular">{currency(d?.cash ?? 0)}</dd>
              </div>
              {deductions > 0 ? (
                <div data-tone="bad">
                  <dt>{t('rep.deductions')}</dt>
                  <dd className="tabular">− {currency(deductions)}</dd>
                </div>
              ) : null}
              {(d?.expenses.items ?? []).map((expense, index) => (
                <div key={`e${index}`} data-tone="bad">
                  <dt>
                    {t('rep.expenses')}
                    <em>{expense.reason}</em>
                  </dt>
                  <dd className="tabular">− {currency(expense.amount)}</dd>
                </div>
              ))}
              {/* What should go to the bank: the cash less what came off it. */}
              <div className={own.netTotal}>
                <dt>{t('det.toDeposit')}</dt>
                <dd className="tabular">
                  {currency((d?.cash ?? 0) - deductions - (d?.expenses.amount ?? 0))}
                </dd>
              </div>
              {(d?.deposits.items ?? []).map((deposit, index) => (
                <div key={index}>
                  <dt>
                    {t('det.depositedTo', { bank: deposit.bankName ?? '—' })}
                    {deposit.status === 'PENDING' ? <em>{t('det.notVerified')}</em> : null}
                  </dt>
                  <dd className="tabular">− {currency(deposit.amount)}</dd>
                </div>
              ))}
              {(d?.deposits.items.length ?? 0) === 0 ? (
                <div>
                  <dt>{t('det.deposited')}</dt>
                  <dd className="tabular">{currency(0)}</dd>
                </div>
              ) : null}
            </dl>
          </section>

          {/* Each sale of the day; the one clicked starts open. */}
          {showEachSale ? (
            <section className={own.daySales}>
              <h3>
                {t('det.salesThatDay')}
                <span>{day.length}</span>
              </h3>
              <ul>
                {day.map((row) => {
                  const open = openId === row.id
                  const unitsSold = row.items.flatMap((item) =>
                    item.inventoryUnits.map((unit) => ({ unit, sku: item.product.sku })),
                  )
                  return (
                    <li key={row.id} data-open={open ? '' : undefined} data-current={row.id === sale?.id ? '' : undefined}>
                      <button type="button" className={own.saleHead} onClick={() => setOpenId(open ? null : row.id)} aria-expanded={open}>
                        <span className={own.saleWhen}>
                          <strong className="tabular">{saleTime(row.saleDate)}</strong>
                          <em className="tabular">{saleRef(row)}</em>
                        </span>
                        <span className={styles.status} data-state={row.status}>
                          {t(STATUS_KEY[row.status])}
                        </span>
                        <strong className="tabular">{currency(Number(row.totalAmount))}</strong>
                        <span className={own.chevron} aria-hidden="true">
                          {open ? '▾' : '▸'}
                        </span>
                      </button>

                      {open ? (
                        <div className={own.saleBody}>
                          <ul>
                            {row.items.map((item) => (
                              <li key={item.id}>
                                <span>
                                  {item.product.name}
                                  <em className="tabular">
                                    {count(item.quantity)} × {currency(Number(item.unitPrice))}
                                  </em>
                                </span>
                                <strong className="tabular">{currency(Number(item.lineTotal))}</strong>
                              </li>
                            ))}
                            {(row.simTransfers ?? []).map((transfer) => (
                              <li key={transfer.id}>
                                <span>
                                  {t('st.short')}
                                  <em>
                                    {transfer.quantity} × {currency(Number(transfer.price))}
                                  </em>
                                </span>
                                <strong className="tabular">
                                  {currency(Number(transfer.price) * transfer.quantity)}
                                </strong>
                              </li>
                            ))}
                            {(row.billPayments ?? []).map((bill) => (
                              <li key={bill.id}>
                                <span>
                                  {t('bill.short')} · {bill.billType}
                                  {bill.account ? <em>{bill.account}</em> : null}
                                </span>
                                <strong className="tabular">{currency(Number(bill.amount))}</strong>
                              </li>
                            ))}
                          </ul>
                          <p className={own.salePaid}>
                            {row.paymentMethod === 'TRANSFER'
                              ? `${t('pay.transfer')} ${currency(Number(row.transferReceived))} · ${row.bankName ?? ''}`
                              : row.paymentMethod === 'MIXED'
                                ? `${t('pay.cash')} ${currency(Number(row.cashReceived))} + ${t('pay.transfer')} ${currency(Number(row.transferReceived))} · ${row.bankName ?? ''}`
                                : `${t('pay.cash')} ${currency(Number(row.cashReceived))}`}
                          </p>
                          {unitsSold.length > 0 ? (
                            <ul className={styles.units}>
                              {unitsSold.map(({ unit, sku }) => (
                                <li key={unit.id}>
                                  <span className="tabular">{unitLabel(unit)}</span>
                                  <em>{sku}</em>
                                </li>
                              ))}
                            </ul>
                          ) : null}
                          {row.status === 'REJECTED' && row.rejectionReason ? (
                            <p className={styles.blocked}>{row.rejectionReason}</p>
                          ) : null}
                          {row.notes ? <p className={own.salePaid}>{row.notes}</p> : null}
                        </div>
                      ) : null}
                    </li>
                  )
                })}
              </ul>
            </section>
          ) : null}
        </div>
      </aside>
      {/* Its own window on top; clicks stay in it, not the day behind. */}
      {payFixing ? (
        <div onClick={(event) => event.stopPropagation()}>
        <PaymentFixDialog
          sale={payFixing}
          direct
          onClose={() => setPayFixing(null)}
          onDone={(message) => {
            setPayFixing(null)
            setPayMessage(message)
            onChanged?.()
          }}
        />
        </div>
      ) : null}
    </div>
  )
}

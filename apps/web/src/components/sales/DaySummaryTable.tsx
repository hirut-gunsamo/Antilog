import { Fragment, useState } from 'react'

import { count, currency, shortDate } from '../../lib/format'
import { useT } from '../../lib/i18n'
import { byBranch, type BranchDeposit, type BranchYadereDaily, type SalesDay } from '../../lib/salesDays'
import { BranchDayDetails } from './BranchDayDetails'
import styles from './DaySummaryTable.module.css'

/**
 * One line per salesperson per day. What was sold (SIM cards, airtime,
 * phones, National ID, Telebirr: always shown, 0 when nothing was done), then
 * the day's money in order: the total less deductions, how it came in, what
 * went to the bank, and the yadere still held. A line opens the full detail.
 */
export function DaySummaryTable({
  days,
  onOpen,
  branchDeposits,
  branchYadereDaily,
  branchOpening,
  showBranchTotalRows = true,
  tailColumn = 'yadere',
}: {
  days: SalesDay[]
  onOpen: (day: SalesDay) => void
  /** What supervisors banked for each branch: it comes off the branch's day. */
  branchDeposits?: BranchDeposit[]
  /** Sum of salespeople's declared yadere per branch/day. */
  branchYadereDaily?: BranchYadereDaily[]
  branchOpening?: Record<string, number>
  showBranchTotalRows?: boolean
  tailColumn?: 'yadere' | 'handedOver'
}) {
  // A branch's total line opens the branch's day.
  const [branchDay, setBranchDay] = useState<{ total: SalesDay; people: SalesDay[]; slips: BranchDeposit[] } | null>(null)
  const t = useT()
  const anyOther = days.some((day) => day.other.quantity > 0)
  const columns = (anyOther ? 18 : 17) + (tailColumn === 'yadere' ? 1 : 0)
  const tailLabel = tailColumn === 'handedOver' ? t('cash.handedOver') : t('ds.yadere')

  // One line per day: goods show how many (the amount on hover and in the
  // detail), National ID and Telebirr show the money. A zero stays quiet.
  const cell = (label: string, quantity: number, amount: number, show: 'count' | 'money', first = false) => (
    <td
      data-label={label}
      className={`tabular ${first ? styles.groupStart : ''}`}
      data-zero={quantity === 0 ? '' : undefined}
      title={show === 'count' ? currency(amount) : t('ds.nTimes', { n: count(quantity) })}
    >
      <strong>{show === 'count' ? count(quantity) : currency(amount)}</strong>
    </td>
  )

  // One line of figures: a salesperson's day, or a branch's total for it.
  const cells = (day: SalesDay, isTotal: boolean) => (
    <>
      <td data-label={t('req.date')} className={styles.when}>
        {shortDate(`${day.date}T12:00:00`)}
      </td>
      {/* First name only: the row stays narrow; the full name is in the detail. */}
      <td data-label={t('sales.employee')} className={styles.who} title={day.salesperson.name}>
        <strong>{isTotal ? t('ds.branchTotal') : day.salesperson.name.split(' ')[0]}</strong>
      </td>
      {cell(t('st.short'), day.simTransfer.quantity, day.simTransfer.amount, 'count', true)}
      {cell(t('bill.short'), day.bills.quantity, day.bills.amount, 'money')}
      {cell(t('ds.sims'), day.sims.quantity, day.sims.amount, 'count')}
      {cell(t('ds.airtime'), day.airtime.quantity, day.airtime.amount, 'count')}
      {cell(t('ds.phones'), day.phones.quantity, day.phones.amount, 'count')}
      {anyOther ? cell(t('ds.other'), day.other.quantity, day.other.amount, 'count') : null}
      {cell(t('nav.nationalId'), day.nationalId.count, day.nationalId.amount, 'money')}
      {cell(t('nav.telebirr'), day.telebirr.count, day.telebirr.amount, 'money')}
      <td
        data-label={t('rep.deductions')}
        className={`${styles.groupStart} ${styles.minus} tabular`}
        data-zero={day.deductions.amount === 0 ? '' : undefined}
      >
        <strong>{currency(day.deductions.amount)}</strong>
      </td>
      <td data-label={t('rep.expenses')} className={`${styles.minus} tabular`} data-zero={day.expenses.amount === 0 ? '' : undefined}>
        <strong>{currency(day.expenses.amount)}</strong>
      </td>
      <td data-label={t('det.dayTotal')} className={`${styles.total} ${styles.groupStart} tabular`}>
        <strong>{currency(day.total)}</strong>
      </td>
      <td data-label={t('ds.transferTotal')} className="tabular" data-zero={day.transfer === 0 ? '' : undefined}>
        <strong>{currency(day.transfer)}</strong>
      </td>
      <td data-label={t('ds.cashTotal')} className="tabular" data-zero={day.cash === 0 ? '' : undefined}>
        <strong>{currency(day.cash)}</strong>
      </td>
      <td data-label={t('ds.depositedShort')} className="tabular" data-zero={day.deposits.amount === 0 ? '' : undefined}>
        <strong>{currency(day.deposits.amount)}</strong>
      </td>
      {/* The supervisor's next-morning deposit of the branch's yadere. */}
      {tailColumn === 'yadere' ? (
        <td data-label={t('ds.yadereDeposit')} className="tabular" data-zero={isTotal && day.yadereDeposit === 0 ? '' : undefined}>
          {isTotal ? <strong>{currency(day.yadereDeposit)}</strong> : <span className={styles.none}>—</span>}
        </td>
      ) : null}
      {/* Sales hand back to supervisor; branches carry yadere overnight. */}
      {tailColumn === 'yadere' ? (
        <>
          <td data-label={tailLabel} className={`${styles.yadere} tabular`}>
            {isTotal ? <strong>{currency(day.yadere)}</strong> : <span className={styles.none}>—</span>}
          </td>
          {/* The day's total once deductions and expenses are off. */}
          <td data-label={t('ds.netBalance')} className={`${styles.total} tabular`}>
            <strong>{currency(day.net)}</strong>
          </td>
        </>
      ) : (
        <>
          {/* The day's total once deductions and expenses are off. */}
          <td data-label={t('ds.netBalance')} className={`${styles.total} tabular`}>
            <strong>{currency(day.net)}</strong>
          </td>
          <td data-label={tailLabel} className={`${styles.yadere} tabular`}>
            <strong>{currency(day.handedOver)}</strong>
          </td>
        </>
      )}
    </>
  )

  return (
    <div className={styles.scroll}>
      <table className={styles.table}>
        <thead>
          <tr>
            <th scope="col">{t('req.date')}</th>
            <th scope="col">{t('sales.employee')}</th>
            <th scope="col" className={styles.groupStart}>{t('st.short')}</th>
            <th scope="col">{t('bill.short')}</th>
            <th scope="col">{t('ds.sims')}</th>
            <th scope="col">{t('ds.airtime')}</th>
            <th scope="col">{t('ds.phones')}</th>
            {anyOther ? <th scope="col">{t('ds.other')}</th> : null}
            <th scope="col">{t('nav.nationalId')}</th>
            <th scope="col">{t('nav.telebirr')}</th>
            <th scope="col" className={styles.groupStart}>{t('rep.deductions')}</th>
            <th scope="col">{t('rep.expenses')}</th>
            <th scope="col" className={styles.groupStart}>{t('det.dayTotal')}</th>
            <th scope="col">{t('ds.transferTotal')}</th>
            <th scope="col">{t('ds.cashTotal')}</th>
            <th scope="col">{t('ds.depositedShort')}</th>
            {tailColumn === 'yadere' ? (
              <>
                <th scope="col">{t('ds.yadereDeposit')}</th>
                <th scope="col">{tailLabel}</th>
                <th scope="col">{t('ds.netBalance')}</th>
              </>
            ) : (
              <>
                <th scope="col">{t('ds.netBalance')}</th>
                <th scope="col">{tailLabel}</th>
              </>
            )}
          </tr>
        </thead>
        <tbody>
          {byBranch(days, { deposits: branchDeposits, yadere: branchYadereDaily, opening: branchOpening }).map((group) => (
            <Fragment key={group.branch}>
              {/* Each branch on its own, under its name. */}
              <tr className={styles.branchRow}>
                <td colSpan={columns}>{group.branch}</td>
              </tr>
              {group.rows.map(({ day, isTotal, people, slips }) =>
                isTotal ? (showBranchTotalRows ? (
                  <tr
                    key={day.key}
                    className={styles.totalRow}
                    onClick={() => setBranchDay({ total: day, people: people ?? [], slips: slips ?? [] })}
                    tabIndex={0}
                    onKeyDown={(event) =>
                      event.key === 'Enter' && setBranchDay({ total: day, people: people ?? [], slips: slips ?? [] })
                    }
                  >
                    {cells(day, true)}
                  </tr>
                ) : null) : (
                  <tr
                    key={day.key}
                    onClick={() => onOpen(day)}
                    tabIndex={0}
                    onKeyDown={(event) => event.key === 'Enter' && onOpen(day)}
                  >
                    {cells(day, false)}
                  </tr>
                ),
              )}
            </Fragment>
          ))}
        </tbody>
      </table>

      {branchDay ? (
        <BranchDayDetails
          total={branchDay.total}
          people={branchDay.people}
          slips={branchDay.slips}
          onOpenPerson={(day) => {
            setBranchDay(null)
            onOpen(day)
          }}
          onClose={() => setBranchDay(null)}
        />
      ) : null}
    </div>
  )
}

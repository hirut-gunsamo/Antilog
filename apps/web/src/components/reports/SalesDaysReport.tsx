import { useEffect, useMemo, useState } from 'react'
import { businessDay } from '../../lib/tz'
import { useSavedState } from '../../lib/savedState'

import { Card, Empty } from '../Card'
import { DaySummaryTable } from '../sales/DaySummaryTable'
import { SaleDetails } from '../sales/SaleDetails'
import { useAuth } from '../../auth/context'
import { api } from '../../lib/api'
import { useBranchList } from '../../lib/branches'
import { useT } from '../../lib/i18n'
import { groupByDay, type BranchDeposit, type BranchYadereDaily, type OtherDay, type SalesDay } from '../../lib/salesDays'
import type { Sale } from '../../lib/types'
import styles from './SalesDaysReport.module.css'

/**
 * The sales report as the business reads it: one line per salesperson per
 * day with SIM cards, airtime, phones, National ID and Telebirr, the day's
 * total, its deductions and what is left. A line opens to the day's detail.
 */
export function SalesDaysReport({ from, to, branch, reload }: { from: string; to: string; branch: string; reload: number }) {
  const t = useT()
  const { user } = useAuth()
  const branchList = useBranchList()
  const [sales, setSales] = useState<Sale[] | null>(null)
  const [others, setOthers] = useState<OtherDay[]>([])
  const [opening, setOpening] = useState<Record<string, number>>({})
  const [branchDeposits, setBranchDeposits] = useState<BranchDeposit[]>([])
  const [branchYadereDaily, setBranchYadereDaily] = useState<BranchYadereDaily[]>([])
  const [branchOpening, setBranchOpening] = useState<Record<string, number>>({})
  const [open, setOpen] = useState<SalesDay | null>(null)
  const [tableBranchDraft, setTableBranchDraft] = useState(branch)
  const [tableBranch, setTableBranch] = useState(branch)
  // One day at a time keeps the table readable; cleared, the whole period shows.
  const [tableDay, setTableDay] = useSavedState('salesDays:day', () => {
    const now = new Date()
    return businessDay(now)
  })

  const isOwner = user?.role === 'OWNER'
  const effectiveBranch = isOwner ? tableBranch : branch

  useEffect(() => {
    setTableBranchDraft(branch)
    setTableBranch(branch)
  }, [branch])

  // The day picker follows the period chosen above: a single day shows that
  // day, a longer one (this week, a month) shows all of it. A saved day used
  // to pin the table to today whatever "Yesterday" or "This week" said.
  useEffect(() => {
    setTableDay(from && from === to ? from : '')
  }, [from, to, reload, setTableDay])

  useEffect(() => {
    const controller = new AbortController()
    const query = new URLSearchParams()
    const dayFrom = tableDay || from
    const dayTo = tableDay || to
    if (dayFrom) query.set('from', dayFrom)
    if (dayTo) query.set('to', dayTo)
    if (effectiveBranch !== 'ALL') query.set('branchId', effectiveBranch)
    Promise.all([
      api<{ sales: Sale[] }>(`/api/sales?${query.toString()}`, { signal: controller.signal }),
      api<{
        days: OtherDay[]
        opening?: Record<string, number>
        branchDeposits?: BranchDeposit[]
        branchYadereDaily?: BranchYadereDaily[]
        branchOpening?: Record<string, number>
      }>(`/api/reports/other-daily?${query.toString()}`, {
        signal: controller.signal,
      }).catch(() => ({ days: [] as OtherDay[], opening: {}, branchDeposits: [], branchYadereDaily: [], branchOpening: {} })),
    ])
      .then(([salesRes, otherRes]) => {
        // Only sales that count: approved ones.
        setSales((salesRes.sales ?? []).filter((sale) => sale.status === 'APPROVED'))
        setOthers(otherRes.days ?? [])
        setOpening(otherRes.opening ?? {})
        setBranchDeposits(otherRes.branchDeposits ?? [])
        setBranchYadereDaily(otherRes.branchYadereDaily ?? [])
        setBranchOpening(otherRes.branchOpening ?? {})
      })
      .catch(() => {
        if (!controller.signal.aborted) setSales([])
      })
    return () => controller.abort()
  }, [from, to, tableDay, effectiveBranch, reload])

  const days = useMemo(() => (sales ? groupByDay(sales, others, opening) : []), [sales, others, opening])
  const hasDailyRows = days.length > 0 || branchDeposits.length > 0
  const salesView = user?.role === 'SALES'


  return (
    <Card title={t('ds.title')} subtitle={t('ds.note')}>
      <div className={styles.branchBar}>
        <input
          type="date"
          className={styles.branchSelect}
          value={tableDay}
          onChange={(event) => setTableDay(event.target.value)}
          aria-label={t('req.date')}
          style={{ maxWidth: 180 }}
        />
        {tableDay ? (
          <button type="button" className={styles.apply} onClick={() => setTableDay('')}>
            {t('ds.allDates')}
          </button>
        ) : null}
      {isOwner ? (
        <>
          <select
            className={styles.branchSelect}
            value={tableBranchDraft}
            onChange={(event) => setTableBranchDraft(event.target.value)}
            aria-label={t('inv.branchLabel')}
          >
            <option value="ALL">{t('inv.allBranches')}</option>
            {branchList.map(([id, name]) => (
              <option key={id} value={id}>
                {name}
              </option>
            ))}
          </select>
          <button
            type="button"
            className={styles.apply}
            onClick={() => setTableBranch(tableBranchDraft)}
            disabled={tableBranch === tableBranchDraft}
          >
            {t('rep.apply')}
          </button>
        </>
      ) : null}
      </div>
      {sales === null ? (
        <Empty>{t('common.loading')}</Empty>
      ) : !hasDailyRows ? (
        <Empty>{t('rep.noSalesPeriod')}</Empty>
      ) : (
        <>
          <DaySummaryTable
            days={days}
            onOpen={setOpen}
            branchDeposits={branchDeposits}
            branchYadereDaily={branchYadereDaily}
            branchOpening={branchOpening}
            showBranchTotalRows={!salesView}
            tailColumn={salesView ? 'handedOver' : 'yadere'}
          />
        </>
      )}

      {open ? <SaleDetails day={open} showEachSale={false} onClose={() => setOpen(null)} /> : null}
    </Card>
  )
}

import { useEffect, useMemo, useState } from 'react'

import { useAuth } from '../auth/context'
import { Card, Empty } from '../components/Card'
import { ItemBreakdown, type ItemRow } from '../components/reports/ItemBreakdown'
import { TransferReport } from '../components/reports/TransferReport'
import { BarList, ColumnChart } from '../components/charts/Charts'
import { Donut } from '../components/charts/Donut'
import { DownloadButton } from '../components/DownloadButton'
import { icons } from '../components/icons'
import { Toasts } from '../components/Toasts'
import { api, downloadCsv } from '../lib/api'
import {
  CATEGORY_COLORS,
  CATEGORY_KEY,
  CATEGORY_ORDER,
  count,
  currency,
  shortDate,
} from '../lib/format'
import { requestItemRows, type RequestItemRow } from '../lib/requests'
import { useT, type TranslationKey } from '../lib/i18n'
import { useToasts } from '../lib/toasts'
import type {
  NationalIdSummary,
  BankReceipt,
  BranchRow,
  CashPositionReport,
  InventoryReport,
  ReportPeriod,
  SalesReport,
  StockRequest,
  TransferRow,
} from '../lib/types'
import styles from './Reports.module.css'

const TABS = [
  { value: 'SALES', labelKey: 'rep.tabSales' },
  { value: 'INVENTORY', labelKey: 'rep.tabInventory' },
  { value: 'REQUESTS', labelKey: 'rep.tabRequests' },
  { value: 'CASH', labelKey: 'rep.tabCash' },
  { value: 'RECEIPTS', labelKey: 'rep.tabReceipts' },
  { value: 'NATIONAL_ID', labelKey: 'rep.tabNationalId' },
  { value: 'TRANSFERS', labelKey: 'rep.tabTransfers' },
] as const satisfies readonly { value: string; labelKey: TranslationKey }[]

type TabValue = (typeof TABS)[number]['value']

/**
 * The four windows a branch is asked about — today's takings, this week's,
 * the month's, the year's. Each report can be downloaded for one of these
 * without disturbing the filters above, because "send me today's cash" should
 * not mean re-typing two dates first.
 */
const QUICK_RANGES: {
  value:
    | 'today'
    | 'yesterday'
    | 'week'
    | 'lastWeek'
    | 'month'
    | 'lastMonth'
    | 'year'
    | 'lastYear'
    | 'chosen'
  labelKey: TranslationKey
}[] = [
  { value: 'today', labelKey: 'rep.rangeToday' },
  { value: 'yesterday', labelKey: 'rep.rangeYesterday' },
  { value: 'week', labelKey: 'rep.rangeWeek' },
  { value: 'lastWeek', labelKey: 'rep.rangeLastWeek' },
  { value: 'month', labelKey: 'rep.rangeMonth' },
  { value: 'lastMonth', labelKey: 'rep.rangeLastMonth' },
  { value: 'year', labelKey: 'rep.rangeYear' },
  { value: 'lastYear', labelKey: 'rep.rangeLastYear' },
  // Any earlier period: the dates picked in the filter bar.
  { value: 'chosen', labelKey: 'rep.rangeChosen' },
]

function rangeDates(
  value: (typeof QUICK_RANGES)[number]['value'],
  chosen: { from: string; to: string },
) {
  if (value === 'chosen') return chosen

  const today = new Date()
  const start = new Date(today)
  const end = new Date(today)
  // The week starts on Monday, as the reports elsewhere count it.
  const monday = today.getDate() - ((today.getDay() + 6) % 7)

  if (value === 'yesterday') {
    start.setDate(today.getDate() - 1)
    end.setDate(today.getDate() - 1)
  } else if (value === 'week') {
    start.setDate(monday)
  } else if (value === 'lastWeek') {
    start.setDate(monday - 7)
    end.setDate(monday - 1)
  } else if (value === 'month') {
    start.setDate(1)
  } else if (value === 'lastMonth') {
    start.setMonth(today.getMonth() - 1, 1)
    end.setDate(0)
  } else if (value === 'year') {
    start.setMonth(0, 1)
  } else if (value === 'lastYear') {
    start.setFullYear(today.getFullYear() - 1, 0, 1)
    end.setFullYear(today.getFullYear() - 1, 11, 31)
  }

  return { from: isoDay(start), to: isoDay(end) }
}

const PERIODS: { value: ReportPeriod; labelKey: TranslationKey }[] = [
  { value: 'daily', labelKey: 'rep.daily' },
  { value: 'weekly', labelKey: 'rep.weekly' },
  { value: 'monthly', labelKey: 'rep.monthly' },
  { value: 'yearly', labelKey: 'rep.yearly' },
]

function Icon({ name, size = 16 }: { name: keyof typeof icons; size?: number }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {icons[name].map((d, index) => (
        <path key={index} d={d} />
      ))}
    </svg>
  )
}

function isoDay(date: Date) {
  return `${date.getFullYear()}-${`${date.getMonth() + 1}`.padStart(2, '0')}-${`${date.getDate()}`.padStart(2, '0')}`
}

const todayIso = () => isoDay(new Date())
const monthStart = () => {
  const now = new Date()
  return isoDay(new Date(now.getFullYear(), now.getMonth(), 1))
}

// Airtime first in the daily table: it is most of what a branch sells.
const DAILY_ORDER = ['AIRTIME_VOUCHER', 'PHONE', 'SIM_CARD'] as const

export default function Reports() {
  const { user } = useAuth()

  // Yadere is the branch's overnight balance, carried by the supervisor. A
  // salesperson hands their takings over and goes home owing nothing, so the
  // carried-forward columns and the day book are not theirs to read.
  const carriesCash = user?.role !== 'SALES'

  const [sales, setSales] = useState<SalesReport | null>(null)
  const [cash, setCash] = useState<CashPositionReport | null>(null)
  const [stock, setStock] = useState<InventoryReport | null>(null)
  const [requests, setRequests] = useState<StockRequest[]>([])
  const [receipts, setReceipts] = useState<BankReceipt[]>([])
  const [transfers, setTransfers] = useState<TransferRow[]>([])
  const [branches, setBranches] = useState<BranchRow[]>([])
  const [nationalId, setNationalId] = useState<NationalIdSummary | null>(
    null,
  )

  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  const [tab, setTab] = useState<TabValue>('SALES')
  const [quickRange, setQuickRange] =
    useState<(typeof QUICK_RANGES)[number]['value']>('today')
  const [period, setPeriod] = useState<ReportPeriod>('daily')
  const [branch, setBranch] = useState('ALL')
  // This month by default, so the dates show what the page is reporting on
  // instead of sitting blank (which meant "all time").
  const [from, setFrom] = useState(() => monthStart())
  const [to, setTo] = useState(() => todayIso())

  // Filters only take effect on Apply: each change would otherwise refetch
  // three reports, and a date range is half-typed most of the time.
  const [applied, setApplied] = useState(0)

  const { toasts, push, dismiss } = useToasts()
  const t = useT()

  // Transfers are the Owner's and supervisors'; a salesperson has none.
  useEffect(() => {
    if (user?.role === 'SALES') return
    const controller = new AbortController()
    api<{ transfers: TransferRow[] }>('/api/transfers?status=RECEIVED', { signal: controller.signal })
      .then((payload) => setTransfers(payload.transfers ?? []))
      .catch(() => undefined)
    return () => controller.abort()
  }, [applied, user?.role])

  // Completed transfers in the chosen dates, touching the chosen branch.
  const scopedTransfers = useMemo(() => {
    const fromTime = from ? new Date(`${from}T00:00:00`).getTime() : null
    const toTime = to ? new Date(`${to}T23:59:59`).getTime() : null

    return transfers.filter((row) => {
      const when = new Date(row.receivedAt ?? row.createdAt).getTime()
      if (fromTime !== null && when < fromTime) return false
      if (toTime !== null && when > toTime) return false
      if (branch !== 'ALL' && row.fromLocation.id !== branch && row.toLocation.id !== branch) return false
      return true
    })
  }, [transfers, from, to, branch])

  useEffect(() => {
    const controller = new AbortController()

    async function load() {
      setLoading(true)

      const query = new URLSearchParams()
      if (from) query.set('from', from)
      if (to) query.set('to', to)
      if (branch !== 'ALL') query.set('branchId', branch)

      const salesQuery = new URLSearchParams(query)
      salesQuery.set('period', period)

      try {
        const nidQuery = new URLSearchParams(
          from && to
            ? { range: 'custom', from, to }
            : { range: 'month' },
        )
        if (branch !== 'ALL') nidQuery.set('locationId', branch)

        const [
          salesRes,
          cashRes,
          stockRes,
          requestRes,
          receiptRes,
          branchRes,
          nidRes,
        ] = await Promise.all([
            api<{ report: SalesReport }>(
              `/api/reports/sales?${salesQuery.toString()}`,
              { signal: controller.signal },
            ),
            api<{ report: CashPositionReport }>(
              `/api/reports/cash-position?${query.toString()}`,
              { signal: controller.signal },
            ),
            api<{ report: InventoryReport }>(
              `/api/reports/inventory?${branch !== 'ALL' ? `branchId=${branch}` : ''}`,
              { signal: controller.signal },
            ),
            // No report endpoint exists for these two, so they are summarised
            // from their own lists rather than invented.
            api<{ requests: StockRequest[] }>('/api/requests', {
              signal: controller.signal,
            }).catch(() => ({ requests: [] as StockRequest[] })),
            api<{ receipts: BankReceipt[] }>('/api/receipts', {
              signal: controller.signal,
            }).catch(() => ({ receipts: [] as BankReceipt[] })),
            api<{ branches: BranchRow[] }>('/api/branches', {
              signal: controller.signal,
            }).catch(() => ({ branches: [] as BranchRow[] })),
            api<{ summary: NationalIdSummary }>(
              `/api/national-id/summary?${nidQuery.toString()}`,
              { signal: controller.signal },
            ).catch(() => ({ summary: null as NationalIdSummary | null })),
          ])

        setSales(salesRes.report)
        setCash(cashRes.report)
        setStock(stockRes.report)
        setRequests(requestRes.requests ?? [])
        setReceipts(receiptRes.receipts ?? [])
        setBranches(branchRes.branches ?? [])
        setNationalId(nidRes.summary)
        setError(null)
      } catch (caught) {
        if (controller.signal.aborted) return
        setError(
          caught instanceof Error ? caught.message : t('rep.loadFailed'),
        )
      } finally {
        if (!controller.signal.aborted) setLoading(false)
      }
    }

    void load()

    return () => controller.abort()
  }, [applied, period, branch, from, to, t])

  // Requests and receipts are filtered client-side, since neither has a report
  // endpoint that understands the date range.
  const scopedRequests = useMemo(() => {
    const fromTime = from ? new Date(`${from}T00:00:00`).getTime() : null
    const toTime = to ? new Date(`${to}T23:59:59`).getTime() : null

    return requests.filter((request) => {
      if (branch !== 'ALL' && request.requestedBy.branch?.id !== branch) {
        return false
      }
      const when = new Date(request.createdAt).getTime()
      if (fromTime !== null && when < fromTime) return false
      if (toTime !== null && when > toTime) return false
      return true
    })
  }, [requests, branch, from, to])

  // One row per requested item, with what was approved and rejected of it.
  const requestRows = useMemo(() => requestItemRows(scopedRequests), [scopedRequests])
  const requestTotals = useMemo(
    () =>
      requestRows.reduce(
        (acc, row) => ({
          requested: acc.requested + row.requested,
          approved: acc.approved + row.approved,
          rejected: acc.rejected + row.rejected,
          pending: acc.pending + (row.result === 'PENDING' ? row.requested : 0),
        }),
        { requested: 0, approved: 0, rejected: 0, pending: 0 },
      ),
    [requestRows],
  )

  const categoryName = (row: RequestItemRow) =>
    row.category ||
    (CATEGORY_KEY[row.categoryKind] ? t(CATEGORY_KEY[row.categoryKind]) : row.categoryKind)

  const kindName = (row: RequestItemRow) =>
    t(row.kind === 'ISSUE' ? 'appr.typeIssue' : row.kind === 'RETURN' ? 'appr.typeReturn' : 'appr.typeRequest')

  const resultName = (row: RequestItemRow) =>
    t(
      row.result === 'APPROVED'
        ? 'appr.statusApproved'
        : row.result === 'REJECTED'
          ? 'appr.statusRejected'
          : row.result === 'PARTLY'
            ? 'rep.reqPartly'
            : row.result === 'CANCELLED'
              ? 'rep.reqCancelled'
              : 'appr.statusPending',
    )

  const scopedReceipts = useMemo(() => {
    const fromTime = from ? new Date(`${from}T00:00:00`).getTime() : null
    const toTime = to ? new Date(`${to}T23:59:59`).getTime() : null

    return receipts.filter((receipt) => {
      if (
        branch !== 'ALL' &&
        (receipt.location ?? receipt.uploadedBy.branch)?.id !== branch
      ) {
        return false
      }
      const when = new Date(receipt.receiptDate).getTime()
      if (fromTime !== null && when < fromTime) return false
      if (toTime !== null && when > toTime) return false
      return true
    })
  }, [receipts, branch, from, to])

  const itemsSold = useMemo(
    () =>
      Object.values(sales?.summary.byCategory ?? {}).reduce(
        (total, entry) => total + entry.quantity,
        0,
      ),
    [sales],
  )

  const bankedTotal = useMemo(
    () =>
      scopedReceipts
        .filter((receipt) => receipt.status === 'VERIFIED')
        .reduce((total, receipt) => total + Number(receipt.amount), 0),
    [scopedReceipts],
  )

  function reset() {
    setPeriod('daily')
    setBranch('ALL')
    setFrom(monthStart())
    setTo(todayIso())
    setApplied((n) => n + 1)
  }

  /** The server builds the CSV for the three reports it owns. */
  async function downloadServerCsv(
    kind: 'sales' | 'cash-position' | 'inventory',
    window?: { from: string; to: string },
  ) {
    const query = new URLSearchParams({ format: 'csv' })
    const start = window?.from ?? from
    const end = window?.to ?? to
    if (start) query.set('from', start)
    if (end) query.set('to', end)
    if (branch !== 'ALL') query.set('branchId', branch)
    if (kind === 'sales') query.set('period', period)

    const name = `${kind}-report-${isoDay(new Date())}.csv`

    try {
      await downloadCsv(`/api/reports/${kind}?${query.toString()}`, name)
      push('success', t('toast.savedToDownloads', { name }))
    } catch {
      push('error', t('dash.downloadFailed'))
    }
  }

  /** Requests and receipts have no server report, so the CSV is built here. */
  function downloadLocalCsv(
    kind: 'requests' | 'receipts' | 'transfers',
    window?: { from: string; to: string },
  ) {
    const name = `${kind}-report-${isoDay(new Date())}.csv`

    // The rows on screen already follow the page's filters; a quick download
    // narrows them again to the window asked for.
    const within = (date: string) => {
      if (!window) return true
      const day = isoDay(new Date(date))
      return day >= window.from && day <= window.to
    }

    const escape = (value: string) =>
      /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value

    const lines =
      kind === 'transfers'
        ? [
            ['Received', 'Sent', 'From', 'To', 'Items', 'Units', 'Driver', 'Plate', 'Received by'].join(','),
            ...scopedTransfers
              .filter((row) => within(row.receivedAt ?? row.createdAt))
              .map((row) =>
                [
                  (row.receivedAt ?? '').slice(0, 10),
                  (row.shippedAt ?? '').slice(0, 10),
                  row.fromLocation.name,
                  row.toLocation.name,
                  row.items.map((item) => `${item.quantity} x ${item.product.name}`).join('; '),
                  String(row.items.reduce((sum, item) => sum + item.quantity, 0)),
                  row.driverName ?? '',
                  row.vehiclePlate ?? '',
                  row.receivedBy?.name ?? '',
                ]
                  .map(escape)
                  .join(','),
              ),
          ]
        : kind === 'requests'
        ? [
            ['Date', 'Branch', 'Requested By', 'Type', 'Category', 'Item', 'Requested', 'Approved', 'Rejected', 'Result'].join(
              ',',
            ),
            ...requestRows
              .filter((row) => within(row.date))
              .map((row) =>
              [
                new Date(row.date).toISOString().slice(0, 10),
                row.branch,
                row.requestedBy,
                kindName(row),
                categoryName(row),
                row.product,
                String(row.requested),
                String(row.approved),
                String(row.rejected),
                resultName(row),
              ]
                .map(escape)
                .join(','),
            ),
          ]
        : [
            ['Date', 'Branch', 'Bank', 'Reference', 'Amount', 'Status'].join(
              ',',
            ),
            ...scopedReceipts
              .filter((receipt) => within(receipt.receiptDate))
              .map((receipt) =>
              [
                new Date(receipt.receiptDate).toISOString().slice(0, 10),
                receipt.uploadedBy.branch?.name ?? '',
                receipt.bankName ?? '',
                receipt.referenceNumber ?? '',
                String(Number(receipt.amount)),
                receipt.status,
              ]
                .map(escape)
                .join(','),
            ),
          ]

    const blob = new Blob([lines.join('\n')], {
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

  const exportName =
    tab === 'SALES'
      ? `sales-report-${isoDay(new Date())}.csv`
      : tab === 'INVENTORY'
        ? `inventory-report-${isoDay(new Date())}.csv`
        : tab === 'CASH'
          ? `cash-position-report-${isoDay(new Date())}.csv`
          : tab === 'REQUESTS'
            ? `requests-report-${isoDay(new Date())}.csv`
            : tab === 'TRANSFERS'
              ? `transfers-report-${isoDay(new Date())}.csv`
              : `receipts-report-${isoDay(new Date())}.csv`

  function exportCurrent(window?: { from: string; to: string }) {
    if (tab === 'SALES') return downloadServerCsv('sales', window)
    if (tab === 'INVENTORY') return downloadServerCsv('inventory', window)
    if (tab === 'CASH') return downloadServerCsv('cash-position', window)
    return downloadLocalCsv(
      tab === 'REQUESTS' ? 'requests' : tab === 'TRANSFERS' ? 'transfers' : 'receipts',
      window,
    )
  }

  if (error) {
    return (
      <div className={styles.page}>
        <Card title={t("rep.title")}>
          <Empty>{error}</Empty>
        </Card>
      </div>
    )
  }

  const tiles = [
    {
      key: 'sales',
      tone: 'green',
      icon: 'chart' as const,
      label: t('rep.totalSales'),
      value: currency(sales?.summary.revenue ?? 0),
    },
    {
      key: 'items',
      tone: 'blue',
      icon: 'cart' as const,
      label: t('rep.itemsSold'),
      value: count(itemsSold),
    },
    {
      key: 'requests',
      tone: 'amber',
      icon: 'box' as const,
      label: t('rep.stockRequests'),
      value: count(scopedRequests.length),
    },
    {
      key: 'banked',
      tone: 'red',
      icon: 'receipt' as const,
      label: t('rep.bankDeposits'),
      value: currency(bankedTotal),
    },
  ]

  const categorySlices = CATEGORY_ORDER.map((key) => ({
    key,
    label: CATEGORY_KEY[key] ? t(CATEGORY_KEY[key]) : key,
    value: sales?.summary.byCategory?.[key]?.revenue ?? 0,
    color: CATEGORY_COLORS[key] ?? 'var(--series-1)',
  })).filter((slice) => slice.value > 0)

  return (
    <div className={styles.page}>
      <header className={styles.head}>
        <div className={styles.mobileHeading}>
          <h1 className={styles.title}>{t('rep.title')}</h1>
          <p className={styles.subtitle}>
{t('rep.note')}
          </p>
        </div>

        <div className={styles.headActions}>
          <DownloadButton
            filename={exportName}
            note={t(TABS.find((entry) => entry.value === tab)?.labelKey ?? 'rep.tabSales')}
            onConfirm={exportCurrent}
            className={styles.primary}
          >
            <Icon name="download" size={15} />
            {t('rep.export')}
          </DownloadButton>
        </div>
      </header>

      {/* One filter bar for every tab, applied on demand. */}
      <div className={styles.filters}>
        {/* Past periods in one tap: picking one fills in the dates and the
            report reloads for them. Dates typed by hand read "Chosen dates". */}
        <select
          className={styles.select}
          value={
            QUICK_RANGES.find(
              (option) =>
                option.value !== 'chosen' &&
                rangeDates(option.value, { from, to }).from === from &&
                rangeDates(option.value, { from, to }).to === to,
            )?.value ?? 'chosen'
          }
          onChange={(event) => {
            const value = event.target.value as (typeof QUICK_RANGES)[number]['value']
            if (value === 'chosen') return
            const range = rangeDates(value, { from, to })
            setFrom(range.from)
            setTo(range.to)
          }}
          aria-label={t('rep.showPeriod')}
        >
          {QUICK_RANGES.map((option) => (
            <option key={option.value} value={option.value}>
              {t(option.value === 'chosen' ? 'rep.rangeCustom' : option.labelKey)}
            </option>
          ))}
        </select>

        <label className={styles.dates}>
          <input
            type="date"
            value={from}
            max={to || undefined}
            onChange={(event) => setFrom(event.target.value)}
            aria-label={t("sales.fromDate")}
          />
          <span aria-hidden="true">–</span>
          <input
            type="date"
            value={to}
            min={from || undefined}
            max={todayIso()}
            onChange={(event) => setTo(event.target.value)}
            aria-label={t("sales.toDate")}
          />
        </label>

        <select
          className={styles.select}
          value={branch}
          onChange={(event) => setBranch(event.target.value)}
          aria-label={t("inv.branchLabel")}
        >
          <option value="ALL">{t("inv.allBranches")}</option>
          {branches.map((entry) => (
            <option key={entry.id} value={entry.id}>
              {entry.name}
            </option>
          ))}
        </select>

        <select
          className={styles.select}
          value={period}
          onChange={(event) => setPeriod(event.target.value as ReportPeriod)}
          aria-label={t("rep.period")}
        >
          {PERIODS.map((option) => (
            <option key={option.value} value={option.value}>
              {t(option.labelKey)}
            </option>
          ))}
        </select>

        <button
          className={styles.apply}
          type="button"
          onClick={() => setApplied((n) => n + 1)}
          disabled={loading}
        >
          {loading ? t('common.loading') : t('rep.apply')}
        </button>

        <button className={styles.reset} type="button" onClick={reset}>
          {t('common.reset')}
        </button>
      </div>

      <div className={styles.tiles}>
        {tiles.map((tile) => (
          <div key={tile.key} className={styles.tile} data-tone={tile.tone}>
            <span className={styles.tileIcon}>
              <Icon name={tile.icon} size={19} />
            </span>
            <div className={styles.tileBody}>
              <span className={styles.tileLabel}>{tile.label}</span>
              <strong className={`${styles.tileValue} tabular`}>
                {tile.value}
              </strong>
            </div>
          </div>
        ))}
      </div>

      <div className={styles.tabs} role="tablist">
        <div className={styles.tabList}>
          {TABS.filter((option) => option.value !== 'TRANSFERS' || user?.role !== 'SALES').map((option) => (
            <button
              key={option.value}
              className={
                tab === option.value
                  ? `${styles.tab} ${styles.tabActive}`
                  : styles.tab
              }
              type="button"
              role="tab"
              aria-selected={tab === option.value}
              onClick={() => setTab(option.value)}
            >
              {t(option.labelKey)}
            </button>
          ))}
        </div>
      </div>

      {/* Each report carries its own download, so "send me this month's cash"
          is two taps rather than a date range typed twice. */}
      <div className={styles.quickExport}>
        <span className={styles.quickLabel}>
          {t('rep.downloadThis', {
            report: t(
              TABS.find((option) => option.value === tab)?.labelKey ??
                'rep.tabSales',
            ),
          })}
        </span>

        <select
          className={styles.select}
          value={quickRange}
          onChange={(event) =>
            setQuickRange(event.target.value as typeof quickRange)
          }
          aria-label={t('rep.downloadRange')}
        >
          {QUICK_RANGES.map((option) => (
            <option key={option.value} value={option.value}>
              {t(option.labelKey)}
            </option>
          ))}
        </select>

        <button
          type="button"
          className={styles.quickButton}
          onClick={() => void exportCurrent(rangeDates(quickRange, { from, to }))}
        >
          <Icon name="download" size={15} />
          {t('rep.download')}
        </button>
      </div>

      {tab === 'SALES' ? (
        <>
          <div className={styles.charts}>
            <Card title={t('rep.salesTrend', { total: currency(sales?.summary.revenue ?? 0) })}>
              {sales && sales.buckets.length > 0 ? (
                <ColumnChart
                  data={sales.buckets.map((bucket) => ({
                    key: bucket.key,
                    label: bucket.label,
                    value: bucket.revenue,
                  }))}
                  height={220}
                />
              ) : (
                <Empty>{t('rep.noSalesPeriod')}</Empty>
              )}
            </Card>

            <Card title={t("rep.byCategory")}>
              {categorySlices.length > 0 ? (
                <Donut slices={categorySlices} totalLabel="Total Sales" />
              ) : (
                <Empty>{t('rep.noSalesPeriod')}</Empty>
              )}
            </Card>

            <Card title={t("rep.byBranch")}>
              <BarList
                data={(sales?.byBranch ?? []).map((entry) => ({
                  key: entry.id,
                  label: entry.name,
                  value: entry.revenue,
                  note: `${count(entry.transactions)} sales`,
                }))}
                emptyMessage={t("rep.noBranchSales")}
              />
            </Card>
          </div>

          <Card title={t("rep.branchPerformance")}>
            {(sales?.byBranch ?? []).length === 0 ? (
              <Empty>{t('rep.noBranchSales')}</Empty>
            ) : (
              <div className={styles.scroll}>
                <table className={styles.table}>
                  <thead>
                    <tr>
                      <th scope="col">{t('common.branch')}</th>
                      <th scope="col">{t('rep.totalSales')}</th>
                      <th scope="col">{t('rep.salesCount')}</th>
                      {CATEGORY_ORDER.map((key) => (
                        <th key={key} scope="col">
                          {CATEGORY_KEY[key] ? t(CATEGORY_KEY[key]) : key}
                        </th>
                      ))}
                      <th scope="col">{t('sales.cashReceived')}</th>
                    </tr>
                  </thead>

                  <tbody>
                    {(sales?.byBranch ?? []).map((entry) => (
                      <tr key={entry.id}>
                        <td data-label={t('common.branch')} className={styles.strong}>
                          {entry.name}
                        </td>
                        <td data-label={t('rep.totalSales')} className="tabular">
                          {currency(entry.revenue)}
                        </td>
                        <td data-label={t('rep.salesCount')} className="tabular">
                          {count(entry.transactions)}
                        </td>
                        {CATEGORY_ORDER.map((key) => (
                          <td key={key} data-label={CATEGORY_KEY[key] ? t(CATEGORY_KEY[key]) : key} className="tabular">
                            {count(entry.byCategory?.[key]?.quantity ?? 0)}
                          </td>
                        ))}
                        <td data-label={t('sales.cashReceived')} className="tabular">
                          {currency(entry.cashReceived)}
                        </td>
                      </tr>
                    ))}
                  </tbody>

                  <tfoot>
                    <tr>
                      <td data-label={t('common.branch')}>{t('rep.totalRow')}</td>
                      <td data-label={t('rep.totalSales')} className="tabular">
                        {currency(sales?.summary.revenue ?? 0)}
                      </td>
                      <td data-label={t('rep.salesCount')} className="tabular">
                        {count(sales?.summary.transactions ?? 0)}
                      </td>
                      {CATEGORY_ORDER.map((key) => (
                        <td key={key} data-label={CATEGORY_KEY[key] ? t(CATEGORY_KEY[key]) : key} className="tabular">
                          {count(sales?.summary.byCategory?.[key]?.quantity ?? 0)}
                        </td>
                      ))}
                      <td data-label={t('sales.cashReceived')} className="tabular">
                        {currency(sales?.summary.cashReceived ?? 0)}
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}
          </Card>

          {/* One row per day per branch: airtime (Voucher and Ibid together),
              phones and SIM cards, each as birr and pieces sold. */}
          <Card title={t('rep.dailyByBranch')}>
            {(sales?.dailyByBranch ?? []).length === 0 ? (
              <Empty>{t('rep.noBranchSales')}</Empty>
            ) : (
              <div className={styles.scroll}>
                <table className={styles.table}>
                  <thead>
                    <tr>
                      <th scope="col">{t('req.date')}</th>
                      <th scope="col">{t('common.branch')}</th>
                      {DAILY_ORDER.map((key) => (
                        <th key={key} scope="col">
                          {CATEGORY_KEY[key] ? t(CATEGORY_KEY[key]) : key}
                        </th>
                      ))}
                      <th scope="col">{t('rep.totalSales')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(sales?.dailyByBranch ?? []).flatMap((row) =>
                      Object.entries(row.branches)
                        .map(([id, cell]) => ({
                          id,
                          cell,
                          name:
                            (sales?.byBranch ?? []).find((entry) => entry.id === id)?.name ?? '—',
                        }))
                        .sort((a, b) => a.name.localeCompare(b.name))
                        .map(({ id, cell, name }, index) => (
                          <tr key={`${row.day}-${id}`}>
                            <td data-label={t('req.date')} className={styles.strong}>
                              {index === 0 ? shortDate(`${row.day}T12:00:00`) : ''}
                            </td>
                            <td data-label={t('common.branch')}>{name}</td>
                            {DAILY_ORDER.map((key) => (
                              <td
                                key={key}
                                data-label={CATEGORY_KEY[key] ? t(CATEGORY_KEY[key]) : key}
                                className="tabular"
                              >
                                {currency(cell.byCategory?.[key]?.revenue ?? 0)}
                                <em className={styles.sub}>
                                  {t('rep.nSold', { n: count(cell.byCategory?.[key]?.quantity ?? 0) })}
                                </em>
                              </td>
                            ))}
                            <td data-label={t('rep.totalSales')} className={`${styles.strong} tabular`}>
                              {currency(cell.revenue)}
                            </td>
                          </tr>
                        )),
                    )}
                  </tbody>
                </table>
              </div>
            )}
          </Card>

          {/* What sold, item by item and branch by branch. */}
          <ItemBreakdown
            titleKey="rep.salesByItem"
            money
            branches={(sales?.byBranch ?? [])
              .map((entry) => ({ id: entry.id, name: entry.name }))
              .sort((a, b) => a.name.localeCompare(b.name))}
            rows={(sales?.byItem ?? []).map((item) => ({
              key: item.id,
              name: item.name,
              sku: item.sku,
              category: item.category,
              categoryName: item.categoryName,
              at: Object.fromEntries(
                Object.entries(item.branches).map(([id, value]) => [
                  id,
                  { quantity: value.quantity, revenue: value.revenue },
                ]),
              ),
            }))}
          />
        </>
      ) : null}

      {tab === 'INVENTORY' ? (
        <>
        <Card title={t("rep.stockByBranch")}>
          {(stock?.branches ?? []).length === 0 ? (
            <Empty>{t('rep.noStock')}</Empty>
          ) : (
            <div className={styles.scroll}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th scope="col">{t('common.branch')}</th>
                    {CATEGORY_ORDER.map((key) => (
                      <th key={key} scope="col">
                        {CATEGORY_KEY[key] ? t(CATEGORY_KEY[key]) : key}
                      </th>
                    ))}
                    <th scope="col">{t('rep.totalUnits')}</th>
                    <th scope="col">{t('rep.stockValue')}</th>
                  </tr>
                </thead>

                <tbody>
                  {(stock?.branches ?? []).map((entry) => (
                    <tr key={entry.id}>
                      <td data-label={t('common.branch')} className={styles.strong}>
                        {entry.name}
                      </td>
                      {CATEGORY_ORDER.map((key) => (
                        <td key={key} data-label={CATEGORY_KEY[key] ? t(CATEGORY_KEY[key]) : key} className="tabular">
                          {count(entry.byCategory?.[key]?.quantity ?? 0)}
                        </td>
                      ))}
                      <td data-label={t('rep.totalUnits')} className="tabular">
                        {count(entry.totalUnits)}
                      </td>
                      <td data-label={t('rep.stockValue')} className={`${styles.strong} tabular`}>
                        {currency(entry.stockValue)}
                      </td>
                    </tr>
                  ))}
                </tbody>

                <tfoot>
                  <tr>
                    <td data-label={t('common.branch')}>{t('rep.totalRow')}</td>
                    {CATEGORY_ORDER.map((key) => (
                      <td key={key} data-label={CATEGORY_KEY[key] ? t(CATEGORY_KEY[key]) : key} className="tabular">
                        {count(
                          (stock?.branches ?? []).reduce(
                            (sum, b) => sum + (b.byCategory?.[key]?.quantity ?? 0),
                            0,
                          ),
                        )}
                      </td>
                    ))}
                    <td data-label={t('rep.totalUnits')} className="tabular">
                      {count(
                        (stock?.branches ?? []).reduce(
                          (sum, b) => sum + b.totalUnits,
                          0,
                        ),
                      )}
                    </td>
                    <td data-label={t('rep.stockValue')} className="tabular">
                      {currency(
                        (stock?.branches ?? []).reduce(
                          (sum, b) => sum + b.stockValue,
                          0,
                        ),
                      )}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </Card>

        {/* The same stock, item by item: Airtime 100 is 40 Ibid 50 and 60
            Voucher 15, not just "100". */}
        <ItemBreakdown
          titleKey="rep.stockByItem"
          branches={(stock?.branches ?? []).map((entry) => ({ id: entry.id, name: entry.name }))}
          rows={Object.values(
            (stock?.branches ?? []).reduce<Record<string, ItemRow>>((acc, entry) => {
              for (const item of entry.items) {
                const row = acc[item.sku] ?? {
                  key: item.sku,
                  name: item.name,
                  sku: item.sku,
                  category: item.category,
                  categoryName: item.categoryName,
                  at: {},
                }
                const at = row.at[entry.id] ?? { quantity: 0 }
                at.quantity += item.quantity
                row.at[entry.id] = at
                acc[item.sku] = row
              }
              return acc
            }, {}),
          )}
        />
        </>
      ) : null}

      {tab === 'REQUESTS' ? (
        <>
        <Card
          title={t("rep.stockRequests")}
          subtitle={t("rep.requestsNote")}
        >
          {requestRows.length === 0 ? (
            <Empty>{t('rep.noRequests')}</Empty>
          ) : (
            <div className={styles.scroll}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th scope="col">{t('req.date')}</th>
                    <th scope="col">{t('common.branch')}</th>
                    <th scope="col">{t('req.requestedBy')}</th>
                    <th scope="col">{t('appr.type')}</th>
                    <th scope="col">{t('inv.category')}</th>
                    <th scope="col">{t('inv.product')}</th>
                    <th scope="col">{t('rep.reqRequested')}</th>
                    <th scope="col">{t('rep.reqApproved')}</th>
                    <th scope="col">{t('rep.reqRejected')}</th>
                    <th scope="col">{t('rep.reqResult')}</th>
                  </tr>
                </thead>
                <tbody>
                  {requestRows.map((row) => (
                    <tr key={row.key}>
                      <td data-label={t('req.date')}>{shortDate(row.date)}</td>
                      <td data-label={t('common.branch')}>{row.branch}</td>
                      <td data-label={t('req.requestedBy')}>{row.requestedBy}</td>
                      <td data-label={t('appr.type')}>{kindName(row)}</td>
                      <td data-label={t('inv.category')}>{categoryName(row)}</td>
                      <td data-label={t('inv.product')}>{row.product}</td>
                      <td data-label={t('rep.reqRequested')} className="tabular">
                        {count(row.requested)}
                      </td>
                      <td data-label={t('rep.reqApproved')} className="tabular">
                        {count(row.approved)}
                      </td>
                      <td data-label={t('rep.reqRejected')} className="tabular">
                        {count(row.rejected)}
                      </td>
                      <td data-label={t('rep.reqResult')}>
                        <span className={styles.reqResult} data-result={row.result}>
                          {resultName(row)}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <td data-label={t('common.branch')} colSpan={6}>{t('rep.totalRow')}</td>
                    <td data-label={t('rep.reqRequested')} className="tabular">
                      {count(requestTotals.requested)}
                    </td>
                    <td data-label={t('rep.reqApproved')} className="tabular">
                      {count(requestTotals.approved)}
                    </td>
                    <td data-label={t('rep.reqRejected')} className="tabular">
                      {count(requestTotals.rejected)}
                    </td>
                    <td data-label={t('appr.statusPending')} className="tabular">
                      {requestTotals.pending > 0
                        ? t('rep.reqPendingN', { n: count(requestTotals.pending) })
                        : ''}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </Card>

        {/* What was asked for, item by item and branch by branch. */}
        <ItemBreakdown
          titleKey="rep.requestsByItem"
          branches={[
            ...new Map(
              scopedRequests
                .filter((request) => request.requestedBy.branch)
                .map((request) => [request.requestedBy.branch!.id, request.requestedBy.branch!]),
            ).values(),
          ].sort((a, b) => a.name.localeCompare(b.name))}
          rows={Object.values(
            scopedRequests.reduce<Record<string, ItemRow>>((acc, request) => {
              const branchId = request.requestedBy.branch?.id
              if (!branchId) return acc

              for (const item of request.items) {
                const row = acc[item.product.id] ?? {
                  key: item.product.id,
                  name: item.product.name,
                  sku: item.product.sku,
                  category: item.product.category,
                  at: {},
                }
                const at = row.at[branchId] ?? { quantity: 0 }
                at.quantity += item.quantity
                row.at[branchId] = at
                acc[item.product.id] = row
              }
              return acc
            }, {}),
          )}
        />
        </>
      ) : null}

      {tab === 'CASH' ? (
        <>
          <div className={styles.charts}>
            <Card title={t("rep.cashPosition")}>
              <BarList
                data={[
                  {
                    key: 'sold',
                    label: t('rep.sold'),
                    value: cash?.totals.sold ?? 0,
                    color: 'var(--series-1)',
                  },
                  {
                    key: 'banked',
                    label: t('rep.banked'),
                    value: cash?.totals.banked ?? 0,
                    color: 'var(--success)',
                  },
                  {
                    key: 'inHand',
                    label: t('rep.stillInHand'),
                    value: cash?.totals.inHand ?? 0,
                    color: 'var(--warning)',
                  },
                ]}
                emptyMessage={t("rep.noCash")}
              />
            </Card>
          </div>

          <Card title={t("rep.bySalesperson")}>
            {(cash?.salespeople ?? []).length === 0 ? (
              <Empty>{t('rep.noCash')}</Empty>
            ) : (
              <div className={styles.scroll}>
                <table className={styles.table}>
                  <thead>
                    <tr>
                      <th scope="col">{t('rep.salesperson')}</th>
                      <th scope="col">{t('common.branch')}</th>
                      {carriesCash ? (
                        <th scope="col">{t('rep.broughtForward')}</th>
                      ) : null}
                      <th scope="col">{t('rep.sold')}</th>
                      <th scope="col">{t('cash.handedOver')}</th>
                      {carriesCash ? (
                        <th scope="col">{t('cash.takenIn')}</th>
                      ) : null}
                      <th scope="col">{t('rep.banked')}</th>
                      <th scope="col">{t('rep.stillInHand')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(cash?.salespeople ?? []).map((person) => (
                      <tr key={person.id}>
                        <td data-label={t('rep.salesperson')} className={styles.strong}>
                          {person.name}
                        </td>
                        <td data-label={t('common.branch')}>{person.branch}</td>
                        {carriesCash ? (
                          <td
                            data-label={t('rep.broughtForward')}
                            className="tabular"
                          >
                            {currency(person.opening)}
                          </td>
                        ) : null}
                        <td data-label={t('rep.sold')} className="tabular">
                          {currency(person.sold)}
                        </td>
                        <td data-label={t('cash.handedOver')} className="tabular">
                          {currency(person.handedOver)}
                        </td>
                        {carriesCash ? (
                          <td data-label={t('cash.takenIn')} className="tabular">
                            {currency(person.collected)}
                          </td>
                        ) : null}
                        <td data-label={t('rep.banked')} className="tabular">
                          {currency(person.banked)}
                        </td>
                        <td data-label={t('rep.stillInHand')} className={`${styles.strong} tabular`}>
                          {currency(person.inHand)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr>
                      <td data-label={t('rep.salesperson')}>{t('rep.totalRow')}</td>
                      <td data-label={t('common.branch')} />
                      {carriesCash ? (
                        <td
                          data-label={t('rep.broughtForward')}
                          className="tabular"
                        >
                          {currency(cash?.totals.opening ?? 0)}
                        </td>
                      ) : null}
                      <td data-label={t('rep.sold')} className="tabular">
                        {currency(cash?.totals.sold ?? 0)}
                      </td>
                      <td data-label={t('cash.handedOver')} className="tabular">
                        {currency(cash?.totals.handedOver ?? 0)}
                      </td>
                      {carriesCash ? (
                        <td data-label={t('cash.takenIn')} className="tabular">
                          {currency(cash?.totals.collected ?? 0)}
                        </td>
                      ) : null}
                      <td data-label={t('rep.banked')} className="tabular">
                        {currency(cash?.totals.banked ?? 0)}
                      </td>
                      <td data-label={t('rep.stillInHand')} className="tabular">
                        {currency(cash?.totals.inHand ?? 0)}
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}
          </Card>

          {/* The branch's own way of keeping the book: each day opens with
              what was carried over, and closes with what is still held. */}
          {carriesCash && cash?.days && cash.days.length > 0 ? (
            <Card title={t('rep.dailyCash')} subtitle={t('rep.dailyCashNote')}>
              <div className={styles.scroll}>
                <table className={styles.table}>
                  <thead>
                    <tr>
                      <th scope="col">{t('rep.date')}</th>
                      <th scope="col">{t('rep.broughtForward')}</th>
                      <th scope="col">{t('rep.collected')}</th>
                      <th scope="col">{t('rep.deposited')}</th>
                      <th scope="col">{t('rep.carriedForward')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {cash.days.map((day) => (
                      <tr key={day.date}>
                        <td data-label={t('rep.date')} className={styles.strong}>
                          {day.date}
                        </td>
                        <td data-label={t('rep.broughtForward')} className="tabular">
                          {currency(day.opening)}
                        </td>
                        <td data-label={t('rep.collected')} className="tabular">
                          {currency(day.collected)}
                        </td>
                        <td data-label={t('rep.deposited')} className="tabular">
                          {currency(day.deposited)}
                        </td>
                        <td
                          data-label={t('rep.carriedForward')}
                          className={`${styles.strong} tabular`}
                        >
                          {currency(day.closing)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          ) : null}
        </>
      ) : null}

      {tab === 'TRANSFERS' ? <TransferReport rows={scopedTransfers} /> : null}

      {tab === 'RECEIPTS' ? (
        <Card
          title={t("rep.tabReceipts")}
          subtitle={t("rep.receiptsNote")}
        >
          {scopedReceipts.length === 0 ? (
            <Empty>{t('rep.noReceipts')}</Empty>
          ) : (
            <div className={styles.scroll}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th scope="col">{t('req.date')}</th>
                    <th scope="col">{t('common.branch')}</th>
                    <th scope="col">{t('rep.bank')}</th>
                    <th scope="col">{t('rep.reference')}</th>
                    <th scope="col">{t('rep.amount')}</th>
                    <th scope="col">{t('common.status')}</th>
                  </tr>
                </thead>
                <tbody>
                  {scopedReceipts.map((receipt) => (
                    <tr key={receipt.id}>
                      <td data-label={t('req.date')}>{shortDate(receipt.receiptDate)}</td>
                      <td data-label={t('common.branch')}>
                        {receipt.uploadedBy.branch?.name ?? '—'}
                      </td>
                      <td data-label={t('rep.bank')}>{receipt.bankName}</td>
                      <td data-label={t('rep.reference')} className="tabular">
                        {receipt.referenceNumber}
                      </td>
                      <td data-label={t('rep.amount')} className={`${styles.strong} tabular`}>
                        {currency(Number(receipt.amount))}
                      </td>
                      <td data-label={t('common.status')}>{receipt.status}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <td data-label={t('req.date')}>{t('rep.verifiedTotal')}</td>
                    <td data-label={t('common.branch')} />
                    <td data-label={t('rep.bank')} />
                    <td data-label={t('rep.reference')} />
                    <td data-label={t('rep.amount')} className="tabular">
                      {currency(bankedTotal)}
                    </td>
                    <td data-label={t('common.status')} />
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </Card>
      ) : null}

      {tab === 'NATIONAL_ID' ? (
        <Card
          title={t('rep.nationalId')}
          subtitle={
            nationalId ? `${nationalId.from} → ${nationalId.to}` : t('nid.note')
          }
        >
          {!nationalId || nationalId.byBranch.length === 0 ? (
            <Empty>{t('nid.nothingYet')}</Empty>
          ) : (
            <div className={styles.scroll}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th scope="col">{t('common.branch')}</th>
                    <th scope="col">{t('nid.originalId')}</th>
                    <th scope="col">{t('nid.copyId')}</th>
                    <th scope="col">{t('rep.nidPrints')}</th>
                    <th scope="col">{t('rep.amount')}</th>
                  </tr>
                </thead>
                <tbody>
                  {nationalId.byBranch.map((entry) => (
                    <tr key={entry.locationId}>
                      <td data-label={t('common.branch')}>{entry.name}</td>
                      <td data-label={t('nid.originalId')} className="tabular">
                        {count(entry.original)}
                      </td>
                      <td data-label={t('nid.copyId')} className="tabular">
                        {count(entry.copy)}
                      </td>
                      <td
                        data-label={t('rep.nidPrints')}
                        className={`${styles.strong} tabular`}
                      >
                        {count(entry.total)}
                      </td>
                      <td data-label={t('rep.amount')} className="tabular">
                        {currency(entry.revenue)}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <td data-label={t('common.branch')}>{t('rep.total')}</td>
                    <td data-label={t('nid.originalId')} className="tabular">
                      {count(nationalId.totals.original)}
                    </td>
                    <td data-label={t('nid.copyId')} className="tabular">
                      {count(nationalId.totals.copy)}
                    </td>
                    <td data-label={t('rep.nidPrints')} className="tabular">
                      {count(nationalId.totals.total)}
                    </td>
                    <td data-label={t('rep.amount')} className="tabular">
                      {currency(nationalId.totals.revenue)}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </Card>
      ) : null}

      <Toasts toasts={toasts} onDismiss={dismiss} />
    </div>
  )
}

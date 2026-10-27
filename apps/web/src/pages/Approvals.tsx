import { AuthImg, AuthLink } from '../components/AuthFile'
import { BUSINESS_TZ } from '../lib/tz'
import { useSavedState } from '../lib/savedState'
import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'

import { useAuth } from '../auth/context'
import {
  BulkDeleteButton,
  deleteSelected,
  SelectAllCell,
  SelectCell,
  useSelection,
} from '../components/BulkDelete'
import { Card, Empty } from '../components/Card'
import { icons } from '../components/icons'
import { RejectDialog } from '../components/approvals/RejectDialog'
import { ApproveItemsDialog } from '../components/requests/ApproveItemsDialog'
import { ApproveRequestDialog } from '../components/requests/ApproveRequestDialog'
import { DispatchDialog } from '../components/requests/DispatchDialog'
import { askedOfBranch, readyToSend, requestStage, requestSummary } from '../lib/requests'
import { RequestDetails } from '../components/requests/RequestDetails'
import { Toasts } from '../components/Toasts'
import { api } from '../lib/api'
import { useBranchList } from '../lib/branches'
import {
  approvePath,
  fromLoss,
  fromReceipt,
  fromReport,
  fromRequest,
  rejectBody,
  rejectPath,
  type ApprovalKind,
  type ApprovalRow,
} from '../lib/approvals'
import { count, currency, shortDate } from '../lib/format'
import { useT, type TranslationKey } from '../lib/i18n'
import { usePageSize } from '../lib/prefs'
import { useToasts } from '../lib/toasts'
import type {
  BankReceipt,
  CashReport,
  StockLossReport,
  StockRequest,
} from '../lib/types'
import styles from './Approvals.module.css'

const TABS: {
  value: ApprovalKind
  labelKey: TranslationKey
  noteKey: TranslationKey
  icon: keyof typeof icons
}[] = [
  {
    value: 'REQUEST',
    labelKey: 'appr.stockRequests',
    noteKey: 'appr.approveRequests',
    icon: 'box',
  },
  {
    value: 'REPORT',
    labelKey: 'appr.salesReports',
    noteKey: 'appr.approveReports',
    icon: 'receipt',
  },
  {
    value: 'RECEIPT',
    labelKey: 'appr.bankReceipts',
    noteKey: 'appr.verifyReceipts',
    icon: 'cash',
  },
  {
    value: 'LOSS',
    labelKey: 'appr.damageLoss',
    noteKey: 'appr.reviewLosses',
    icon: 'more',
  },
]

const STATUS_FILTERS: { value: string; labelKey: TranslationKey }[] = [
  { value: 'PENDING', labelKey: 'appr.statusPending' },
  { value: 'ALL', labelKey: 'inv.allStatus' },
  { value: 'APPROVED', labelKey: 'appr.statusApproved' },
  { value: 'REJECTED', labelKey: 'appr.statusRejected' },
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

export default function Approvals() {
  const { user } = useAuth()

  const [rows, setRows] = useState<ApprovalRow[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [reloadKey, setReloadKey] = useState(0)

  const [tab, setTab] = useState<ApprovalKind>('REQUEST')
  const [search, setSearch] = useState('')
  const [branch, setBranch] = useState('ALL')
  const [status, setStatus] = useState('PENDING')
  const [from, setFrom] = useSavedState('approvals:from', '')
  const [to, setTo] = useSavedState('approvals:to', '')
  const [page, setPage] = useState(1)

  const [pending, setPending] = useState<string | null>(null)
  const [rejecting, setRejecting] = useState<ApprovalRow | null>(null)
  const [approvingRequest, setApprovingRequest] = useState<StockRequest | null>(
    null,
  )
  const [detailsOf, setDetailsOf] = useState<ApprovalRow | null>(null)
  // The request whose items are being approved, before it is sent.
  const [deciding, setDeciding] = useState<StockRequest | null>(null)
  // Every approved restock sent at once, a driver per branch.
  // true for every branch, or one branch's id from its row's Send.
  // A supervisor's restock open to approve and send, one car.
  const [dispatching, setDispatching] = useState<StockRequest | null>(null)
  // A notification lands here with ?request=<id> to open that request.
  const [searchParams, setSearchParams] = useSearchParams()
  const openRequestId = searchParams.get('request')

  const { toasts, push, dismiss } = useToasts()
  const PAGE_SIZE = usePageSize()
  const t = useT()

  useEffect(() => {
    const controller = new AbortController()

    async function load() {
      try {
        // Three queues, three endpoints, fetched together and normalised.
        // Each is allowed to fail on its own: a Supervisor can read cash
        // reports and receipts even where requests are restricted.
        const [requests, reports, receipts, losses] = await Promise.all([
          api<{ requests: StockRequest[] }>('/api/requests', {
            signal: controller.signal,
          }).catch(() => ({ requests: [] as StockRequest[] })),
          api<{ reports: CashReport[] }>('/api/cash-reports', {
            signal: controller.signal,
          }).catch(() => ({ reports: [] as CashReport[] })),
          api<{ receipts: BankReceipt[] }>('/api/receipts', {
            signal: controller.signal,
          }).catch(() => ({ receipts: [] as BankReceipt[] })),
          api<{ reports: StockLossReport[] }>('/api/stock-loss', {
            signal: controller.signal,
          }).catch(() => ({ reports: [] as StockLossReport[] })),
        ])

        setRows([
          ...(requests.requests ?? []).map(fromRequest),
          ...(reports.reports ?? []).map(fromReport),
          ...(receipts.receipts ?? []).map(fromReceipt),
          ...(losses.reports ?? []).map(fromLoss),
        ])
        setError(null)
      } catch (caught) {
        if (controller.signal.aborted) return
        setError(
          caught instanceof Error
            ? caught.message
            : t('appr.loadFailed'),
        )
      }
    }

    void load()

    return () => controller.abort()
  }, [reloadKey, t])

  const all = useMemo(() => rows ?? [], [rows])

  const branchList = useBranchList()
  const branches = useMemo(() => {
    const seen = new Set<string>(branchList.map(([, name]) => name))
    for (const row of all) if (row.branch !== '—') seen.add(row.branch)
    return [...seen].sort()
  }, [all, branchList])

  // The cards count every queue, not just the open tab: they are the reason to
  // come to this page at all.
  const summary = useMemo(() => {
    const today = new Date()
    const sameDay = (iso: string | null) => {
      if (!iso) return false
      const date = new Date(iso)
      return (
        date.getFullYear() === today.getFullYear() &&
        date.getMonth() === today.getMonth() &&
        date.getDate() === today.getDate()
      )
    }
    const thisMonth = (iso: string) => {
      const date = new Date(iso)
      return (
        date.getFullYear() === today.getFullYear() &&
        date.getMonth() === today.getMonth()
      )
    }

    return {
      pending: all.filter((row) => row.state === 'PENDING').length,
      approvedToday: all.filter(
        (row) => row.state === 'APPROVED' && sameDay(row.decidedAt),
      ).length,
      rejected: all.filter((row) => row.state === 'REJECTED').length,
      thisMonth: all.filter((row) => thisMonth(row.date)).length,
    }
  }, [all])

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase()
    const fromTime = from ? new Date(`${from}T00:00:00`).getTime() : null
    const toTime = to ? new Date(`${to}T23:59:59`).getTime() : null

    return all
      .filter((row) => {
        if (row.kind !== tab) return false
        if (status !== 'ALL' && row.state !== status) return false
        if (branch !== 'ALL' && row.branch !== branch) return false

        const when = new Date(row.date).getTime()
        if (fromTime !== null && when < fromTime) return false
        if (toTime !== null && when > toTime) return false

        if (term) {
          const hit =
            row.reference.toLowerCase().includes(term) ||
            row.requestedBy.toLowerCase().includes(term) ||
            row.summary.toLowerCase().includes(term)

          if (!hit) return false
        }

        return true
      })
      .sort((a, b) => +new Date(b.date) - +new Date(a.date))
  }, [all, tab, status, branch, from, to, search])

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const safePage = Math.min(page, totalPages)
  const pageRows = filtered.slice(
    (safePage - 1) * PAGE_SIZE,
    safePage * PAGE_SIZE,
  )

  const canDecide = user?.role === 'SUPERVISOR' || user?.role === 'OWNER'

  // The Owner can delete requests and bank receipts from here; cash and loss
  // reports have no delete, so they cannot be ticked.
  const isOwner = user?.role === 'OWNER'
  const selection = useSelection()
  const DELETE_URL: Partial<Record<ApprovalRow['kind'], string>> = {
    REQUEST: '/api/requests',
    RECEIPT: '/api/receipts',
  }
  const keyOf = (row: ApprovalRow) => `${row.kind}:${row.id}`

  async function removeSelected() {
    const keys = [...selection.selected]
    const url = (key: string) => {
      const [kind, id] = key.split(':') as [ApprovalRow['kind'], string]
      return `${DELETE_URL[kind]}/${id}`
    }
    if (await deleteSelected(keys, url, t, push)) {
      selection.clear()
      setReloadKey((n) => n + 1)
    }
  }

  const filtersOn =
    search !== '' || branch !== 'ALL' || status !== 'PENDING' || from !== '' || to !== ''

  function reset() {
    setSearch('')
    setBranch('ALL')
    setStatus('PENDING')
    setFrom('')
    setTo('')
    setPage(1)
  }

  function change<T>(setter: (value: T) => void) {
    return (value: T) => {
      setter(value)
      setPage(1)
    }
  }

  async function approve(row: ApprovalRow) {
    // A stock request cannot be approved without naming a source branch, so it
    // opens the dialog instead of firing straight away.
    if (row.kind === 'REQUEST') {
      setApprovingRequest(row.source as StockRequest)
      return
    }

    setPending(row.id)

    try {
      await api(approvePath(row), { method: 'PATCH' })
      push(
        'success',
        t(
          row.kind === 'RECEIPT'
            ? 'appr.verifiedRef'
            : row.kind === 'LOSS'
              ? 'loss.confirmedRef'
              : 'appr.approvedRef',
          { ref: row.reference },
        ),
      )
      setReloadKey((n) => n + 1)
    } catch (caught) {
      push(
        'error',
        caught instanceof Error ? caught.message : t('appr.approveFailed'),
      )
    } finally {
      setPending(null)
    }
  }

  // A request is decided one item at a time by whoever it was sent to; each
  // line has its own Approve and Reject.
  const byItem = (row: ApprovalRow) => row.kind === 'REQUEST'

  // Supervisors' restocks waiting on this viewer (the Owner): each is
  // approved and sent from one page, Approve & send.
  const isDispatchable = (request: StockRequest) =>
    isOwner && request.requestedBy.role !== 'SALES' && request.status === 'PENDING' && request.requestedTo?.id === user?.id
  const waitingRestocks = (rows ?? [])
    .filter((row) => row.kind === 'REQUEST')
    .map((row) => row.source as StockRequest)
    .filter(isDispatchable)

  // Once the rows are in, open the request a notification pointed at: its
  // items to approve, or Send once they are decided, else its details. Done
  // during render, once per link, so it opens on the first frame.
  const [openedId, setOpenedId] = useState<string | null>(null)
  if (!openRequestId && openedId !== null) setOpenedId(null)
  if (openRequestId && rows !== null && openedId !== openRequestId) {
    setOpenedId(openRequestId)
    const row = rows.find((entry) => entry.kind === 'REQUEST' && entry.id === openRequestId)
    if (row) {
      const request = row.source as StockRequest
      setTab('REQUEST')
      if (isDispatchable(request)) {
        setDispatching(request)
      } else if (
        askedOfBranch(request, user) ||
        (request.status === 'PENDING' &&
          request.requestedTo?.id === user?.id &&
          request.items.some((item) => item.approvedQuantity === null))
      ) {
        setApprovingRequest(request)
      } else {
        setDetailsOf(row)
      }
    }
  }

  // Then the link is taken off the address, so tapping it again reopens it.
  useEffect(() => {
    if (openRequestId && openedId === openRequestId) setSearchParams({}, { replace: true })
  }, [openRequestId, openedId, setSearchParams])

  // A salesperson's request addressed to this viewer with items still to
  // decide (a supervisor's restock goes through Approve & send instead).
  const toDecide = (row: ApprovalRow) => {
    if (row.kind !== 'REQUEST') return false
    const request = row.source as StockRequest
    // Another branch asking this supervisor's branch is approved and sent
    // from one page too.
    if (askedOfBranch(request, user)) return true
    return (
      request.requestedBy.role === 'SALES' &&
      request.status === 'PENDING' &&
      request.requestedTo?.id === user?.id &&
      request.items.some((item) => item.approvedQuantity === null)
    )
  }

  // A category decided: the Owner goes straight on to sending a restock
  // once its last category is decided.
  function onDecided(updated: StockRequest, message: string) {
    push('success', message)
    setReloadKey((n) => n + 1)
    if (detailsOf?.id === updated.id) setDetailsOf(fromRequest(updated))
    // The approve window stays open until every item is decided, then
    // closes. Nothing is sent from here: the Owner presses Send (or Send all)
    // when ready, ticks what goes in the car and names the driver.
    const left = updated.status === 'PENDING' && updated.items.some((item) => item.approvedQuantity === null)
    if (deciding?.id === updated.id && !left) setDeciding(null)
    else if (deciding?.id === updated.id) setDeciding(updated)
  }

  async function reject(row: ApprovalRow, reason: string) {
    setPending(row.id)

    try {
      await api(rejectPath(row), {
        method: 'PATCH',
        body: rejectBody(row, reason),
      })

      push('success', t('toast.rejectedRef', { ref: row.reference }))
      setRejecting(null)
      setReloadKey((n) => n + 1)
    } finally {
      setPending(null)
    }
  }

  if (error) {
    return (
      <div className={styles.page}>
        <Card title={t("appr.title")}>
          <Empty>{error}</Empty>
        </Card>
      </div>
    )
  }

  if (!rows) {
    return (
      <div className={styles.page}>
        <div className={styles.tiles}>
          {[0, 1, 2, 3].map((n) => (
            <div key={n} className={styles.skeletonTile} />
          ))}
        </div>
        <div className={styles.skeletonCard} />
      </div>
    )
  }

  const tiles = [
    { key: 'pending', tone: 'amber', icon: 'clipboard' as const, label: t('appr.statusPending'), value: summary.pending },
    { key: 'today', tone: 'green', icon: 'check' as const, label: t('appr.approvedToday'), value: summary.approvedToday },
    { key: 'rejected', tone: 'red', icon: 'more' as const, label: t('appr.statusRejected'), value: summary.rejected },
    { key: 'month', tone: 'blue', icon: 'chart' as const, label: t('appr.totalThisMonth'), value: summary.thisMonth },
  ]

  return (
    <div className={styles.page}>
      <header className={styles.head}>
        <div className={styles.mobileHeading}>
          <h1 className={styles.title}>{t('appr.title')}</h1>
          <p className={styles.subtitle}>
{t('appr.note')}
          </p>
        </div>
      </header>

      {/* The three queues, as cards rather than plain tabs: each says what it
          is for, and carries its own pending count. */}
      <div className={styles.queues} role="tablist">
        {TABS.map((option) => {
          const waiting = all.filter(
            (row) => row.kind === option.value && row.state === 'PENDING',
          ).length

          return (
            <button
              key={option.value}
              type="button"
              role="tab"
              aria-selected={tab === option.value}
              className={
                tab === option.value
                  ? `${styles.queue} ${styles.queueOn}`
                  : styles.queue
              }
              onClick={() => change(setTab)(option.value)}
            >
              <span className={styles.queueIcon}>
                <Icon name={option.icon} size={18} />
              </span>
              <span className={styles.queueText}>
                <strong>{t(option.labelKey)}</strong>
                <em>{t(option.noteKey)}</em>
              </span>
              {waiting > 0 ? (
                <span className={styles.queueCount}>{count(waiting)}</span>
              ) : null}
            </button>
          )
        })}
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
                {count(tile.value)}
              </strong>
            </div>
          </div>
        ))}
      </div>

      <Card>
        <div className={styles.filters}>
          <label className={styles.dates}>
            <input
              type="date"
              value={from}
              onChange={(event) => change(setFrom)(event.target.value)}
              aria-label={t("sales.fromDate")}
            />
            <span aria-hidden="true">–</span>
            <input
              type="date"
              value={to}
              onChange={(event) => change(setTo)(event.target.value)}
              aria-label={t("sales.toDate")}
            />
          </label>

          <select
            className={styles.select}
            value={branch}
            onChange={(event) => change(setBranch)(event.target.value)}
            aria-label={t("inv.branchFilter")}
          >
            <option value="ALL">{t("inv.allBranches")}</option>
            {branches.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>

          <select
            className={styles.select}
            value={status}
            onChange={(event) => change(setStatus)(event.target.value)}
            aria-label={t("inv.statusFilter")}
          >
            {STATUS_FILTERS.map((option) => (
              <option key={option.value} value={option.value}>
                {t(option.labelKey)}
              </option>
            ))}
          </select>

          <button
            className={styles.reset}
            type="button"
            onClick={reset}
            disabled={!filtersOn}
          >
            {t('common.reset')}
          </button>
        </div>

        {filtered.length === 0 ? (
          <Empty>
            {status === 'PENDING'
              ? t('appr.nothingWaiting', {
                  queue: t(
                    TABS.find((entry) => entry.value === tab)?.labelKey ??
                      'appr.stockRequests',
                  ).toLowerCase(),
                })
              : t('appr.noMatch')}
          </Empty>
        ) : (
          <>
            <div className={styles.scroll}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    {isOwner ? (
                      <SelectAllCell
                        ids={pageRows.filter((row) => DELETE_URL[row.kind]).map(keyOf)}
                        selection={selection}
                      />
                    ) : null}
                    <th scope="col">{t('appr.reference')}</th>
                    <th scope="col">{t('req.date')}</th>
                    <th scope="col">{t('req.requestedBy')}</th>
                    <th scope="col">{t('common.branch')}</th>
                    <th scope="col">{t('appr.type')}</th>
                    <th scope="col">{t('req.items')}</th>
                    <th scope="col">{t('common.status')}</th>
                    <th scope="col" className={styles.actionsCol}>
                      {isOwner ? (
                        <BulkDeleteButton
                          count={selection.selected.size}
                          busy={pending !== null}
                          onClick={() => void removeSelected()}
                        />
                      ) : (
                        t('common.actions')
                      )}
                    </th>
                  </tr>
                </thead>

                <tbody>
                  {pageRows.map((row) => {
                    const when = new Date(row.date)
                    const time = Number.isNaN(when.getTime())
                      ? ''
                      : when.toLocaleTimeString('en-GB', {
                          timeZone: BUSINESS_TZ,
                          hour: '2-digit',
                          minute: '2-digit',
                        })

                    return (
                      <tr
                        key={`${row.kind}-${row.id}`}
                        data-busy={pending === row.id}
                        data-meta={`${row.branch} · ${shortDate(row.date)} ${time}`}
                        className={styles.clickableRow}
                        onClick={() => (row.kind === 'REQUEST' && isDispatchable(row.source as StockRequest) ? setDispatching(row.source as StockRequest) : setDetailsOf(row))}
                      >
                        {isOwner ? (
                          <SelectCell
                            id={keyOf(row)}
                            name={row.reference}
                            selection={selection}
                            disabled={!DELETE_URL[row.kind]}
                          />
                        ) : null}
                        <td data-label={t('appr.reference')} className={styles.ref}>
                          {row.reference}
                        </td>

                        <td data-label={t('req.date')}>
                          {shortDate(row.date)}
                          <span className={styles.time}> {time}</span>
                        </td>

                        <td data-label={t('req.requestedBy')}>
                          {row.requestedBy}
                          <span className={styles.sub}>
                            {row.requestedByRole === 'SUPERVISOR'
                              ? t('role.SUPERVISOR')
                              : row.requestedByRole === 'SALES'
                                ? t('role.SALES')
                                : row.requestedByRole}
                          </span>
                        </td>

                        <td data-label={t('common.branch')}>{row.branch}</td>
                        <td data-label={t('appr.type')}>{t(row.typeKey)}</td>

                        <td data-label={t('req.items')} data-lines={byItem(row) ? '' : undefined}>
                          {byItem(row) ? (
                            // SIM cards, airtime, phones; each item is in the details.
                            <ul className={styles.itemLines}>
                              {requestSummary(row.source as StockRequest).lines.map((line) => (
                                <li key={line.key}>
                                  <span>{t(line.labelKey)}</span>
                                  <span className="tabular">× {count(line.quantity)}</span>
                                </li>
                              ))}
                            </ul>
                          ) : (
                            row.summary
                          )}
                          {row.kind === 'RECEIPT' ? (
                            <span className={styles.sub}>
                              {currency(
                                Number((row.source as BankReceipt).amount),
                              )}
                            </span>
                          ) : null}
                        </td>

                        <td data-label={t('common.status')}>
                          <span
                            className={styles.status}
                            data-state={
                              row.kind === 'REQUEST' && requestStage(row.source as StockRequest) === 'WAITING_TO_SEND'
                                ? 'APPROVED'
                                : row.state
                            }
                          >
                            {row.kind === 'REQUEST' && requestStage(row.source as StockRequest) === 'WAITING_TO_SEND'
                              ? t('appr.statusApproved')
                              : row.state === 'PENDING'
                              ? t('appr.statusPending')
                              : row.state === 'APPROVED'
                                ? row.kind === 'RECEIPT'
                                  ? t('appr.statusVerified')
                                  : t('appr.statusApproved')
                                : row.state === 'REJECTED'
                                  ? t('appr.statusRejected')
                                  : '—'}
                          </span>
                          {row.kind === 'REQUEST' && requestStage(row.source as StockRequest) === 'WAITING_TO_SEND' ? (
                            <span className={styles.sub}>{t('req.waitingToSend')}</span>
                          ) : null}
                        </td>

                        <td
                          className={styles.actionsCol}
                          onClick={(event) => event.stopPropagation()}
                        >
                          <div className={styles.rowActions}>
                            <button
                              type="button"
                              className={styles.view}
                              onClick={() => (row.kind === 'REQUEST' && isDispatchable(row.source as StockRequest) ? setDispatching(row.source as StockRequest) : setDetailsOf(row))}
                            >
                              {t('appr.view')}
                            </button>

                            {row.kind === 'REQUEST' && isDispatchable(row.source as StockRequest) ? (
                              <button
                                type="button"
                                className={styles.approve}
                                onClick={() => setDispatching(row.source as StockRequest)}
                              >
                                {t(requestStage(row.source as StockRequest) === 'WAITING_TO_SEND' ? 'appr.send' : 'dispatch.open')}
                              </button>
                            ) : null}

                            {/* A salesperson's request is approved whole, from one
                                page, or rejected. */}
                            {toDecide(row) ? (
                              <>
                                <button
                                  type="button"
                                  className={styles.approve}
                                  onClick={() => setApprovingRequest(row.source as StockRequest)}
                                >
                                  {t('appr.approve')}
                                </button>
                                {(row.source as StockRequest).items.every((item) => item.approvedQuantity === null) ? (
                                  <button
                                    type="button"
                                    className={styles.rejectBtn}
                                    onClick={() => setRejecting(row)}
                                  >
                                    {t('appr.reject')}
                                  </button>
                                ) : null}
                              </>
                            ) : null}

                            {row.kind === 'REQUEST' &&
                            (row.source as StockRequest).requestedBy.role === 'SALES' &&
                            readyToSend(row.source as StockRequest, user?.id) ? (
                              <button
                                type="button"
                                className={styles.approve}
                                onClick={() => setApprovingRequest(row.source as StockRequest)}
                              >
                                {t('appr.send')}
                              </button>
                            ) : null}

                            {canDecide && row.state === 'PENDING' && !byItem(row) ? (
                              <>
                                <button
                                  type="button"
                                  className={styles.approve}
                                  disabled={pending === row.id}
                                  onClick={() => void approve(row)}
                                >
                                  {row.kind === 'RECEIPT'
                                    ? t('appr.verify')
                                    : t('appr.approve')}
                                </button>
                                <button
                                  type="button"
                                  className={styles.rejectBtn}
                                  disabled={pending === row.id}
                                  onClick={() => setRejecting(row)}
                                >
                                  {t('appr.reject')}
                                </button>
                              </>
                            ) : null}
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>

            <div className={styles.foot}>
              <span className={styles.showing}>
                Showing {(safePage - 1) * PAGE_SIZE + 1}–
                {Math.min(safePage * PAGE_SIZE, filtered.length)} of{' '}
                {count(filtered.length)}{' '}
                {status === 'PENDING' ? 'pending ' : ''}approvals
              </span>

              {totalPages > 1 ? (
                <nav className={styles.pager} aria-label={t("common.pagination")}>
                  <button
                    type="button"
                    disabled={safePage === 1}
                    onClick={() => setPage(safePage - 1)}
                    aria-label={t("common.prevPage")}
                  >
                    ‹
                  </button>
                  {Array.from({ length: totalPages }, (_, i) => i + 1).map(
                    (n) => (
                      <button
                        key={n}
                        type="button"
                        className={n === safePage ? styles.pageOn : ''}
                        aria-current={n === safePage ? 'page' : undefined}
                        onClick={() => setPage(n)}
                      >
                        {n}
                      </button>
                    ),
                  )}
                  <button
                    type="button"
                    disabled={safePage === totalPages}
                    onClick={() => setPage(safePage + 1)}
                    aria-label={t("common.nextPage")}
                  >
                    ›
                  </button>
                </nav>
              ) : null}
            </div>
          </>
        )}
      </Card>

      <Toasts toasts={toasts} onDismiss={dismiss} />

      {rejecting ? (
        <RejectDialog
          title={t(
            rejecting.kind === 'RECEIPT'
              ? 'appr.rejectTitleReceipt'
              : rejecting.kind === 'REPORT'
                ? 'appr.rejectTitleReport'
                : 'appr.rejectTitleRequest',
          )}
          reference={rejecting.reference}
          what={
            rejecting.kind === 'RECEIPT'
              ? t('appr.rejectWhatReceipt')
              : t('appr.rejectWhatOther')
          }
          onClose={() => setRejecting(null)}
          onConfirm={(reason) => reject(rejecting, reason)}
        />
      ) : null}

      {deciding ? (
        <ApproveItemsDialog
          request={deciding}
          onClose={() => setDeciding(null)}
          onDecided={onDecided}
          onError={(message) => push('error', message)}
        />
      ) : null}

      {dispatching ? (
        <DispatchDialog
          request={dispatching}
          waiting={waitingRestocks}
          onClose={() => {
            setDispatching(null)
            setReloadKey((n) => n + 1)
          }}
          onDone={(message) => {
            setDispatching(null)
            push('success', message)
            setReloadKey((n) => n + 1)
          }}
        />
      ) : null}

      {approvingRequest ? (
        <ApproveRequestDialog
          request={approvingRequest}
          onClose={() => setApprovingRequest(null)}
          onDone={(message) => {
            setApprovingRequest(null)
            push('success', message)
            setReloadKey((n) => n + 1)
          }}
        />
      ) : null}

      {detailsOf?.kind === 'REQUEST' ? (
        <RequestDetails
          request={detailsOf.source as StockRequest}
          onClose={() => setDetailsOf(null)}
          {...(isDispatchable(detailsOf.source as StockRequest)
            ? {
                onDispatch: () => {
                  setDispatching(detailsOf.source as StockRequest)
                  setDetailsOf(null)
                },
              }
            : {})}
        />
      ) : detailsOf ? (
        <ApprovalDetails row={detailsOf} onClose={() => setDetailsOf(null)} />
      ) : null}
    </div>
  )
}

/** Cash reports and receipts, which have no page of their own yet. */
function ApprovalDetails({
  row,
  onClose,
}: {
  row: ApprovalRow
  onClose: () => void
}) {
  const t = useT()

  const report = row.kind === 'REPORT' ? (row.source as CashReport) : null
  const receipt = row.kind === 'RECEIPT' ? (row.source as BankReceipt) : null

  return (
    <div className={styles.scrim} onClick={onClose}>
      <aside
        className={styles.detailPanel}
        role="dialog"
        aria-modal="true"
        aria-label={row.reference}
        onClick={(event) => event.stopPropagation()}
      >
        <header>
          <div>
            <h2 className="tabular">{row.reference}</h2>
            <p>
              {t(row.typeKey)} · {row.branch}
            </p>
          </div>
          <button type="button" onClick={onClose} aria-label={t('common.close')}>
            ✕
          </button>
        </header>

        <div className={styles.detailBody}>
          {report ? (
            <dl className={styles.detailFacts}>
              <div>
                <dt>{t('det.period')}</dt>
                <dd>
                  {shortDate(report.periodStart)} – {shortDate(report.periodEnd)}
                </dd>
              </div>
              <div>
                <dt>{t('det.expected')}</dt>
                <dd className="tabular">
                  {currency(Number(report.expectedCash))}
                </dd>
              </div>
              <div>
                <dt>{t('det.actual')}</dt>
                <dd className="tabular">
                  {currency(Number(report.actualCash))}
                </dd>
              </div>
              <div>
                <dt>{t('det.variance')}</dt>
                <dd className="tabular">
                  {currency(Number(report.variance))}
                </dd>
              </div>
              <div>
                <dt>{t('det.salesCovered')}</dt>
                <dd className="tabular">{count(report.sales.length)}</dd>
              </div>
              <div>
                <dt>{t('rep.salesperson')}</dt>
                <dd>{report.salesperson.name}</dd>
              </div>
            </dl>
          ) : null}

          {receipt ? (
            <>
              <dl className={styles.detailFacts}>
                <div>
                  <dt>{t('rep.bank')}</dt>
                  <dd>{receipt.bankName}</dd>
                </div>
                <div>
                  <dt>{t('det.reference')}</dt>
                  <dd className="tabular">{receipt.referenceNumber}</dd>
                </div>
                <div>
                  <dt>{t('det.amount')}</dt>
                  <dd className="tabular">
                    {currency(Number(receipt.amount))}
                  </dd>
                </div>
                <div>
                  <dt>{t('det.paidIn')}</dt>
                  <dd>{shortDate(receipt.receiptDate)}</dd>
                </div>
                <div>
                  <dt>{t('det.uploadedBy')}</dt>
                  <dd>{receipt.uploadedBy.name}</dd>
                </div>
                <div>
                  <dt>{t('det.verifiedBy')}</dt>
                  <dd>{receipt.verifiedBy?.name ?? t('det.notYet')}</dd>
                </div>
              </dl>

              {/* The slip itself is the evidence — it has to be visible. */}
              {receipt.fileUrl ? (
                <AuthLink
                  className={styles.slip}
                  href={receipt.fileUrl}
                  target="_blank"
                  rel="noreferrer"
                >
                  <AuthImg
                    src={receipt.fileUrl}
                    alt={t('a11y.receipt', { ref: receipt.referenceNumber ?? '' })}
                  />
                  <span>{t('det.openFullSize')}</span>
                </AuthLink>
              ) : (
                <p>{t('rcpt.noSlip')}</p>
              )}
            </>
          ) : null}

          {(report?.notes ?? receipt?.notes) ? (
            <p className={styles.detailNote}>
              {report?.notes ?? receipt?.notes}
            </p>
          ) : null}
        </div>
      </aside>
    </div>
  )
}

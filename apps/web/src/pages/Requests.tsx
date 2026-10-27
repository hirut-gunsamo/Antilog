import { Navigate, useLocation } from 'react-router-dom'
import rowStyles from '../components/RowMenu.module.css'
import { BUSINESS_TZ, businessDay } from '../lib/tz'
import { useEffect, useMemo, useRef, useState } from 'react'

import { useAuth } from '../auth/context'
import { BulkDeleteButton, deleteSelected } from '../components/BulkDelete'
import { Card, Empty } from '../components/Card'
import { DownloadButton } from '../components/DownloadButton'
import { icons } from '../components/icons'
import { YadereDialog } from '../components/cash/YadereDialog'
import { ApproveRequestDialog } from '../components/requests/ApproveRequestDialog'
import { DispatchDialog } from '../components/requests/DispatchDialog'
import { RejectDialog } from '../components/approvals/RejectDialog'
import { NewRequestDialog } from '../components/requests/NewRequestDialog'
import { RequestDetails } from '../components/requests/RequestDetails'
import { Toasts } from '../components/Toasts'
import { api } from '../lib/api'
import { useBranchList } from '../lib/branches'
import { count, shortDate } from '../lib/format'
import {
  REQUEST_STATUS_KEY,
  REQUEST_STATUS_LABEL,
  readyToSend,
  requestRef,
  requestRoute,
  requestUnitCount,
  requestStage,
  requestSummary,
  askedOfBranch,
} from '../lib/requests'
import { useT, type TranslationKey } from '../lib/i18n'
import { usePageSize } from '../lib/prefs'
import { useToasts } from '../lib/toasts'
import type {
  RequestStatus,
  StockRequest,
  StockRequestKind,
} from '../lib/types'
import styles from './Requests.module.css'

const TABS = [
  { value: 'ALL', labelKey: 'req.tabAll' },
  { value: 'MINE', labelKey: 'req.tabMine' },
  { value: 'PENDING', labelKey: 'req.tabPending' },
  { value: 'APPROVED', labelKey: 'req.approved' },
  { value: 'REJECTED', labelKey: 'req.rejected' },
  { value: 'HANDBACK', labelKey: 'hold.handBack' },
] as const satisfies readonly { value: string; labelKey: TranslationKey }[]

type TabValue = (typeof TABS)[number]['value']

const STATUS_FILTERS: {
  value: RequestStatus | 'ALL'
  labelKey: TranslationKey
}[] = [
  { value: 'ALL', labelKey: 'inv.allStatus' },
  { value: 'PENDING', labelKey: 'req.statusPending' },
  { value: 'APPROVED', labelKey: 'req.statusApproved' },
  { value: 'REJECTED', labelKey: 'req.statusRejected' },
  { value: 'FULFILLED', labelKey: 'req.statusFulfilled' },
  { value: 'CANCELLED', labelKey: 'req.statusCancelled' },
]

const TYPE_FILTERS: { value: string; labelKey: TranslationKey }[] = [
  { value: 'ALL', labelKey: 'req.allTypes' },
  { value: 'SIM_CARD', labelKey: 'inv.simCards' },
  { value: 'PHONE', labelKey: 'inv.phones' },
  { value: 'AIRTIME_VOUCHER', labelKey: 'inv.vouchers' },
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
  return businessDay(date)
}

/**
 * A supervisor has two lists: what their salespeople asked them for
 * (scope SALES) and what they asked the Owner for (scope MINE). The Owner
 * has two as well: from salespeople (SALES) and from supervisors
 * (SUPERVISOR). A salesperson sees one list (ALL).
 */
export default function Requests({
  scope = 'ALL',
}: {
  scope?: 'ALL' | 'SALES' | 'MINE' | 'SUPERVISOR'
}) {
  const { user } = useAuth()
  const location = useLocation()

  const [requests, setRequests] = useState<StockRequest[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [reloadKey, setReloadKey] = useState(0)

  const [tab, setTab] = useState<TabValue>('ALL')
  const [search, setSearch] = useState('')
  const [branch, setBranch] = useState('ALL')
  const [type, setType] = useState('ALL')
  const [status, setStatus] = useState<RequestStatus | 'ALL'>('ALL')
  const [page, setPage] = useState(1)

  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [openMenu, setOpenMenu] = useState<string | null>(null)
  const [detailsOf, setDetailsOf] = useState<StockRequest | null>(null)
  const [approving, setApproving] = useState<StockRequest | null>(null)
  const [settingYadere, setSettingYadere] = useState(false)
  // A supervisor's branch, its decided requests going out in one car.
  const [dispatching, setDispatching] = useState<StockRequest | null>(null)
  // A supervisor's restock waiting on this viewer (the Owner): opening it
  // opens Approve & send, where it is approved, given a driver and sent.
  const isDispatchable = (request: StockRequest) =>
    user?.role === 'OWNER' && request.requestedBy.role !== 'SALES' && request.status === 'PENDING' && request.requestedTo?.id === user?.id

  // A salesperson's request being rejected, with its reason.
  const [rejecting, setRejecting] = useState<StockRequest | null>(null)
  const [creating, setCreating] = useState<StockRequestKind | null>(null)
  const [editingRequest, setEditingRequest] = useState<StockRequest | null>(null)
  const [pending, setPending] = useState<string | null>(null)

  const menuRef = useRef<HTMLDivElement | null>(null)
  const { toasts, push, dismiss } = useToasts()
  const PAGE_SIZE = usePageSize()
  const t = useT()
  const linkedTab = useMemo(() => {
    const tab = new URLSearchParams(location.search).get('tab')
    return tab === 'HANDBACK' ? tab : null
  }, [location.search])

  useEffect(() => {
    if (linkedTab === 'HANDBACK') setTab('HANDBACK')
  }, [linkedTab])

  useEffect(() => {
    const controller = new AbortController()

    async function load() {
      try {
        const payload = await api<{ requests: StockRequest[] }>(
          '/api/requests',
          { signal: controller.signal },
        )

        setRequests(payload.requests ?? [])
        setError(null)
      } catch (caught) {
        if (controller.signal.aborted) return
        setError(
          caught instanceof Error ? caught.message : t('req.loadFailed'),
        )
      }
    }

    void load()

    return () => controller.abort()
  }, [reloadKey, t])

  useEffect(() => {
    if (!openMenu) return

    function onDown(event: MouseEvent) {
      if (!menuRef.current?.contains(event.target as Node)) setOpenMenu(null)
    }

    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') setOpenMenu(null)
    }

    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)

    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [openMenu])

  const rows = useMemo(
    () =>
      (requests ?? []).filter((request) =>
        scope === 'SALES'
          ? request.requestedBy.role === 'SALES'
          : scope === 'SUPERVISOR'
            ? request.requestedBy.role === 'SUPERVISOR'
            : scope === 'MINE'
              ? request.requestedBy.id === user?.id
              : true,
      ),
    [requests, scope, user?.id],
  )

  const branchList = useBranchList()
  const branches = useMemo(() => {
    const seen = new Map<string, string>(branchList)
    for (const request of rows) {
      const found = request.requestedBy.branch
      if (found) seen.set(found.id, found.name)
    }
    return [...seen.entries()].sort((a, b) => a[1].localeCompare(b[1]))
  }, [rows, branchList])

  // Four cards, each against the month before.
  const summary = useMemo(() => {
    const now = new Date()
    const thisMonth = (iso: string) => {
      const date = new Date(iso)
      return (
        date.getFullYear() === now.getFullYear() &&
        date.getMonth() === now.getMonth()
      )
    }
    const lastMonth = (iso: string) => {
      const date = new Date(iso)
      const prior = new Date(now.getFullYear(), now.getMonth() - 1, 1)
      return (
        date.getFullYear() === prior.getFullYear() &&
        date.getMonth() === prior.getMonth()
      )
    }

    const change = (nowCount: number, before: number) => {
      if (before === 0) return nowCount > 0 ? 100 : 0
      return Math.round(((nowCount - before) / before) * 1000) / 10
    }

    const tally = (
      pick: (request: StockRequest) => boolean,
      when: (iso: string) => boolean,
    ) => rows.filter((r) => pick(r) && when(r.createdAt)).length

    const all = (r: StockRequest) => Boolean(r)
    // Approved but not yet sent counts as approved, as the list shows it.
    const isPending = (r: StockRequest) => r.status === 'PENDING' && requestStage(r) !== 'WAITING_TO_SEND'
    const isApproved = (r: StockRequest) =>
      r.status === 'APPROVED' || r.status === 'FULFILLED' || requestStage(r) === 'WAITING_TO_SEND'
    const isRejected = (r: StockRequest) => r.status === 'REJECTED'

    return {
      total: rows.length,
      totalChange: change(tally(all, thisMonth), tally(all, lastMonth)),
      pending: rows.filter(isPending).length,
      pendingChange: change(
        tally(isPending, thisMonth),
        tally(isPending, lastMonth),
      ),
      approved: rows.filter(isApproved).length,
      approvedChange: change(
        tally(isApproved, thisMonth),
        tally(isApproved, lastMonth),
      ),
      rejected: rows.filter(isRejected).length,
      rejectedChange: change(
        tally(isRejected, thisMonth),
        tally(isRejected, lastMonth),
      ),
    }
  }, [rows])

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase()
    const today = new Date()
    const splitHandbacks = scope === 'SALES' && user?.role === 'SUPERVISOR'
    const isSameDay = (iso: string) => {
      const when = new Date(iso)
      return (
        when.getFullYear() === today.getFullYear() &&
        when.getMonth() === today.getMonth() &&
        when.getDate() === today.getDate()
      )
    }

    return rows.filter((request) => {
      if (splitHandbacks && tab === 'HANDBACK') {
        const happenedAt = request.reviewedAt ?? request.createdAt
        if (request.kind !== 'RETURN' || !isSameDay(happenedAt)) return false
      } else if (splitHandbacks) {
        // Daily handbacks live in their own tab, not under "All requests".
        if (request.kind === 'RETURN') return false
      }

      if (tab === 'MINE' && request.requestedBy.id !== user?.id) return false
      if (tab === 'PENDING' && request.status !== 'PENDING') return false
      if (
        tab === 'APPROVED' &&
        request.status !== 'APPROVED' &&
        request.status !== 'FULFILLED'
      ) {
        return false
      }
      if (tab === 'REJECTED' && request.status !== 'REJECTED') return false
      if (status !== 'ALL' && request.status !== status) return false
      if (branch !== 'ALL' && request.requestedBy.branch?.id !== branch) {
        return false
      }

      if (
        type !== 'ALL' &&
        !request.items.some((item) => item.product.category === type)
      ) {
        return false
      }

      if (term) {
        const hit =
          requestRef(request).toLowerCase().includes(term) ||
          request.requestedBy.name.toLowerCase().includes(term) ||
          (request.requestedBy.branch?.name ?? '')
            .toLowerCase()
            .includes(term) ||
          request.items.some(
            (item) =>
              item.product.name.toLowerCase().includes(term) ||
              item.product.sku.toLowerCase().includes(term),
          )

        if (!hit) return false
      }

      return true
    })
  }, [rows, tab, status, branch, type, search, scope, user?.id, user?.role])

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const safePage = Math.min(page, totalPages)
  const pageRows = filtered.slice(
    (safePage - 1) * PAGE_SIZE,
    safePage * PAGE_SIZE,
  )

  // Only a supervisor raises a request; only the Owner decides one.
  const isSupervisor = user?.role === 'SUPERVISOR'
  const isOwner = user?.role === 'OWNER'
  const isSales = user?.role === 'SALES'

  const filtersOn =
    tab !== 'ALL' ||
    search !== '' ||
    branch !== 'ALL' ||
    type !== 'ALL' ||
    status !== 'ALL'

  function reset() {
    setTab('ALL')
    setSearch('')
    setBranch('ALL')
    setType('ALL')
    setStatus('ALL')
    setPage(1)
  }

  function change<T>(setter: (value: T) => void) {
    return (value: T) => {
      setter(value)
      setPage(1)
    }
  }

  async function act(
    request: StockRequest,
    action: 'reject' | 'cancel',
    body?: unknown,
  ) {
    setPending(request.id)
    setOpenMenu(null)

    try {
      await api(`/api/requests/${request.id}/${action}`, {
        method: 'PATCH',
        ...(body !== undefined ? { body } : {}),
      })

      push(
        'success',
        t('toast.saleAction', {
          ref: requestRef(request),
          said: t(action === 'reject' ? 'toast.saidRejected' : 'toast.saidCancelled'),
        }),
      )

      setReloadKey((n) => n + 1)
    } catch (caught) {
      push(
        'error',
        caught instanceof Error ? caught.message : t('sales.actionFailed'),
      )
    } finally {
      setPending(null)
    }
  }

  // Goods the supervisor handed this salesperson, not yet confirmed: any
  // approved line not received, even while the rest is still being decided.
  const toReceive = (request: StockRequest) =>
    request.kind === 'ISSUE' &&
    (request.status === 'APPROVED' || request.status === 'PENDING') &&
    request.requestedBy.role === 'SALES' &&
    request.items.some((item) => (item.approvedQuantity ?? 0) > 0 && !item.receivedAt)

  async function receive(request: StockRequest) {
    setPending(request.id)
    try {
      await api(`/api/requests/${request.id}/receive`, { method: 'PATCH', body: {} })
      push('success', t('req.receivedToast', { ref: requestRef(request) }))
      setReloadKey((n) => n + 1)
    } catch (caught) {
      push('error', caught instanceof Error ? caught.message : t('sales.actionFailed'))
      // It may have been received elsewhere (the sale form's Receive now):
      // show the list as it stands.
      setReloadKey((n) => n + 1)
    } finally {
      setPending(null)
    }
  }

  const exportName = `stock-requests-${isoDay(new Date())}.csv`
  // The Owner deletes any request; anyone else only their own pending ones,
  // which the API enforces row by row.
  async function removeSelected() {
    const ids = [...selected]
    if (await deleteSelected(ids, (id) => `/api/requests/${id}`, t, push)) {
      setSelected(new Set())
      setReloadKey((n) => n + 1)
    }
  }

  const exportRows = selected.size > 0 ? selected.size : filtered.length

  function exportCsv() {
    const list =
      selected.size > 0
        ? filtered.filter((request) => selected.has(request.id))
        : filtered

    const header = [
      'Request ID',
      'Date',
      'Requested By',
      'Branch',
      'Items',
      'Units',
      'Products',
      'Status',
    ]

    const escape = (value: string) =>
      /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value

    const lines = [
      header.join(','),
      ...list.map((request) =>
        [
          requestRef(request),
          new Date(request.createdAt).toISOString(),
          request.requestedBy.name,
          request.requestedBy.branch?.name ?? '',
          String(request.items.length),
          String(requestUnitCount(request)),
          request.items
            .map((item) => `${item.product.name} ×${item.quantity}`)
            .join(' | '),
          REQUEST_STATUS_LABEL[request.status],
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
    link.download = exportName
    link.click()
    URL.revokeObjectURL(url)

    push('success', t('toast.savedToDownloads', { name: exportName }))
  }


  // A supervisor's requests are split in two; the plain link opens the
  // salespeople's list. The Owner has only the supervisors' list.
  if (scope === 'ALL' && (isSupervisor || isOwner)) {
    return <Navigate to={isOwner ? '/requests/supervisors' : '/requests/sales'} replace />
  }

  if (error) {
    return (
      <div className={styles.page}>
        <Card title={t("req.title")}>
          <Empty>{error}</Empty>
        </Card>
      </div>
    )
  }

  if (!requests) {
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
    {
      key: 'total',
      tone: 'blue',
      icon: 'clipboard' as const,
      label: t('req.totalRequests'),
      value: summary.total,
      change: summary.totalChange,
    },
    {
      key: 'pending',
      tone: 'amber',
      icon: 'box' as const,
      label: t('req.statusPending'),
      value: summary.pending,
      change: summary.pendingChange,
    },
    {
      key: 'approved',
      tone: 'green',
      icon: 'check' as const,
      label: t('req.statusApproved'),
      value: summary.approved,
      change: summary.approvedChange,
    },
    {
      key: 'rejected',
      tone: 'red',
      icon: 'more' as const,
      label: t('req.statusRejected'),
      value: summary.rejected,
      change: summary.rejectedChange,
    },
  ]

  return (
    <div className={styles.page}>
      <header className={styles.head}>
        <div className={styles.mobileHeading}>
          <h1 className={styles.title}>
            {t(
              scope === 'SALES'
                ? 'req.titleSales'
                : scope === 'SUPERVISOR'
                  ? 'req.titleSupervisor'
                  : scope === 'MINE'
                    ? 'req.titleMine'
                    : 'req.title',
            )}
          </h1>
          <p className={styles.subtitle}>
{isSales ? t('req.noteSales') : t('req.note')}
          </p>
        </div>

        <div className={styles.headActions}>
          {isSupervisor && scope !== 'SALES' ? (
            <button
              className={styles.primary}
              type="button"
              onClick={() => setCreating('RESTOCK')}
            >
              <Icon name="plus" size={15} />
              {t('req.new')}
            </button>
          ) : null}

          {/* A seller's day begins and ends with one of these two. */}
          {isSales ? (
            <>
              <button
                className={styles.primary}
                type="button"
                onClick={() => setCreating('ISSUE')}
              >
                <Icon name="plus" size={15} />
                {t('hold.takeItems')}
              </button>
              <button
                className={styles.ghost}
                type="button"
                onClick={() => setCreating('RETURN')}
              >
                {t('hold.handBack')}
              </button>
              <button
                className={styles.ghost}
                type="button"
                onClick={() => setSettingYadere(true)}
              >
                {t('rcpt.yadere')}
              </button>
            </>
          ) : null}
        </div>
      </header>

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
              <span
                className={styles.tileChange}
                data-dir={tile.change >= 0 ? 'up' : 'down'}
              >
                {tile.change >= 0 ? '↑' : '↓'} {Math.abs(tile.change)}%
                <em>from last month</em>
              </span>
            </div>
          </div>
        ))}
      </div>

      <Card>
        <div className={styles.tabs} role="tablist">
          <div className={styles.tabList}>
            {TABS.filter((option) => scope === 'ALL' || option.value !== 'MINE').map((option) => (
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
                onClick={() => change(setTab)(option.value)}
              >
                {t(option.labelKey)}
              </button>
            ))}
          </div>

          <DownloadButton
            filename={exportName}
            note={`${exportRows} request${exportRows === 1 ? '' : 's'}`}
            onConfirm={exportCsv}
            className={styles.ghost}
          >
            <Icon name="download" size={15} />
            Export{selected.size > 0 ? ` (${selected.size})` : ''}
          </DownloadButton>
        </div>

        <div className={styles.filters}>
          <label className={styles.search}>
            <span className={styles.searchIcon} aria-hidden="true">
              <svg viewBox="0 0 24 24" width="15" height="15" fill="none">
                <circle
                  cx="11"
                  cy="11"
                  r="7"
                  stroke="currentColor"
                  strokeWidth="1.8"
                />
                <path
                  d="m20 20-3.2-3.2"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                />
              </svg>
            </span>
            <input
              value={search}
              onChange={(event) => change(setSearch)(event.target.value)}
              placeholder={t("req.searchPlaceholder")}
              aria-label={t("req.searchLabel")}
            />
          </label>

          {isOwner ? (
            <select
              className={styles.select}
              value={branch}
              onChange={(event) => change(setBranch)(event.target.value)}
              aria-label={t("inv.branchFilter")}
            >
              <option value="ALL">{t("inv.allBranches")}</option>
              {branches.map(([id, name]) => (
                <option key={id} value={id}>
                  {name}
                </option>
              ))}
            </select>
          ) : null}

          <select
            className={styles.select}
            value={type}
            onChange={(event) => change(setType)(event.target.value)}
            aria-label={t("req.typeFilter")}
          >
            {TYPE_FILTERS.map((option) => (
              <option key={option.value} value={option.value}>
                {t(option.labelKey)}
              </option>
            ))}
          </select>

          <select
            className={styles.select}
            value={status}
            onChange={(event) =>
              change(setStatus)(event.target.value as RequestStatus | 'ALL')
            }
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
            {rows.length === 0
              ? isSales
                ? t('req.noneYetSales')
                : isSupervisor
                  ? t('req.noneYetSupervisor')
                  : t('req.noneYetOther')
              : t('req.noMatch')}
          </Empty>
        ) : (
          <>
            <div className={styles.scroll}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th className={styles.tick}>
                      <input
                        type="checkbox"
                        checked={
                          pageRows.length > 0 &&
                          pageRows.every((r) => selected.has(r.id))
                        }
                        onChange={() =>
                          setSelected((current) => {
                            const next = new Set(current)
                            const all = pageRows.every((r) => next.has(r.id))
                            for (const request of pageRows) {
                              if (all) next.delete(request.id)
                              else next.add(request.id)
                            }
                            return next
                          })
                        }
                        aria-label={t("common.selectAll")}
                      />
                    </th>
                    <th scope="col">{t('req.requestId')}</th>
                    <th scope="col">{t('req.date')}</th>
                    <th scope="col">{t('req.requestedBy')}</th>
                    {/* A salesperson only ever asks their own supervisor. */}
                    {isSales ? null : <th scope="col">{t('req.route')}</th>}
                    <th scope="col">{t('req.items')}</th>
                    <th scope="col">{t('req.quantity')}</th>
                    <th scope="col">{t('common.status')}</th>
                    <th scope="col" className={styles.actionsCol}>
                      <BulkDeleteButton
                        count={selected.size}
                        onClick={() => void removeSelected()}
                      />
                    </th>
                  </tr>
                </thead>

                <tbody>
                  {pageRows.map((request) => {
                    const when = new Date(request.createdAt)
                    const time = Number.isNaN(when.getTime())
                      ? ''
                      : when.toLocaleTimeString('en-GB', {
                          timeZone: BUSINESS_TZ,
                          hour: '2-digit',
                          minute: '2-digit',
                        })

                    return (
                      <tr
                        key={request.id}
                        data-busy={pending === request.id}
                        className={styles.clickableRow}
                        onClick={() => (isDispatchable(request) ? setDispatching(request) : setDetailsOf(request))}
                        data-meta={
                          isSales
                            ? `${shortDate(request.createdAt)} ${time}`
                            : `${requestRoute(request, t)} · ${shortDate(request.createdAt)} ${time}`
                        }
                      >
                        <td
                          className={styles.tick}
                          onClick={(event) => event.stopPropagation()}
                        >
                          <input
                            type="checkbox"
                            checked={selected.has(request.id)}
                            onChange={() =>
                              setSelected((current) => {
                                const next = new Set(current)
                                if (next.has(request.id)) next.delete(request.id)
                                else next.add(request.id)
                                return next
                              })
                            }
                            aria-label={t('a11y.selectRow', { name: requestRef(request) })}
                          />
                        </td>

                        <td data-label={t('req.requestId')} className={styles.ref}>
                          {requestRef(request)}
                        </td>

                        <td data-label={t('req.date')}>
                          {shortDate(request.createdAt)}
                          <span className={styles.time}> {time}</span>
                        </td>

                        <td data-label={t('req.requestedBy')}>
                          {request.requestedBy.name}
                          <span className={styles.sub}>
                            {request.requestedBy.role === 'SUPERVISOR'
                              ? t('role.SUPERVISOR')
                              : request.requestedBy.role}
                          </span>
                        </td>

                        {isSales ? null : (
                          <td data-label={t('req.route')} data-col="route">{requestRoute(request, t)}</td>
                        )}

                        <td data-label={t('req.items')} data-col="items">
                          {/* In a few words: SIM cards, airtime, phones. Each
                              item is listed in the details. */}
                          <ul className={styles.itemList}>
                            {requestSummary(request).lines.map((line) => (
                              <li key={line.key}>
                                <span>{t(line.labelKey)}</span>
                                <span className={`${styles.qtyInline} tabular`}>
                                  × {count(line.quantity)}
                                  {line.key === 'AIRTIME_VOUCHER' ? ' carta' : ''}
                                </span>
                              </li>
                            ))}
                          </ul>
                          {/* On a phone the Received button sits under the
                              items, full width, rather than squeezed into the
                              card's corner. */}
                          {toReceive(request) && request.requestedBy.id === user?.id ? (
                            <button
                              type="button"
                              className={`${styles.primary} ${styles.receivePhone}`}
                              disabled={pending === request.id}
                              onClick={(event) => {
                                event.stopPropagation()
                                void receive(request)
                              }}
                            >
                              {t('req.receive')}
                            </button>
                          ) : null}
                        </td>

                        <td data-label={t('req.quantity')} data-col="qty">
                          <ul className={styles.itemList}>
                            {requestSummary(request).lines.map((line) => (
                              <li key={line.key}>
                                <span className="tabular">{count(line.quantity)}</span>
                              </li>
                            ))}
                          </ul>
                        </td>

                        <td data-label={t('common.status')}>
                          <span
                            className={styles.status}
                            data-state={requestStage(request) === 'WAITING_TO_SEND' ? 'APPROVED' : request.status}
                          >
                            {t(REQUEST_STATUS_KEY[requestStage(request) === 'WAITING_TO_SEND' ? 'APPROVED' : request.status])}
                          </span>
                          {requestStage(request) === 'WAITING_TO_SEND' && request.requestedBy.role !== 'SALES' ? (
                            <span className={styles.sub}>{t('req.waitingToSend')}</span>
                          ) : null}
                          {toReceive(request) ? (
                            <span className={styles.sub}>{t('req.notReceivedYet')}</span>
                          ) : request.receivedAt && request.requestedBy.role === 'SALES' ? (
                            <span className={styles.sub}>
                              {t('req.receivedBy', {
                                name: request.receivedBy?.name ?? request.requestedBy.name,
                                when: shortDate(request.receivedAt),
                              })}
                            </span>
                          ) : null}
                        </td>

                        <td
                          className={styles.actionsCol}
                          onClick={(event) => event.stopPropagation()}
                        >
                          {isOwner && request.requestedBy.role !== 'SALES' &&
                          request.status === 'PENDING' &&
                          request.requestedTo?.id === user?.id ? (
                            <button
                              type="button"
                              className={styles.primary}
                              style={{ marginRight: 6 }}
                              onClick={() => setDispatching(request)}
                            >
                              {t(requestStage(request) === 'WAITING_TO_SEND' ? 'appr.send' : 'dispatch.open')}
                            </button>
                          ) : null}
                          {askedOfBranch(request, user) ? (
                            <>
                              <button
                                type="button"
                                className={styles.primary}
                                style={{ marginRight: 6 }}
                                onClick={() => setApproving(request)}
                              >
                                {t('dlg.approveAndTransfer')}
                              </button>
                              {request.items.every((item) => item.approvedQuantity === null) ? (
                                <button
                                  type="button"
                                  className={styles.ghost}
                                  style={{ marginRight: 6 }}
                                  onClick={() => setRejecting(request)}
                                >
                                  {t('appr.reject')}
                                </button>
                              ) : null}
                            </>
                          ) : null}
                          {toReceive(request) && request.requestedBy.id === user?.id ? (
                            <button
                              type="button"
                              className={`${styles.primary} ${styles.receiveDesk}`}
                              style={{ marginRight: 6 }}
                              disabled={pending === request.id}
                              onClick={() => void receive(request)}
                            >
                              {t('req.receive')}
                            </button>
                          ) : null}
                          <div className={rowStyles.actions}>
                                <button className={rowStyles.action}
                                  type="button"
                                  onClick={() => {
                                    if (isDispatchable(request)) setDispatching(request)
                                    else setDetailsOf(request)
                                    setOpenMenu(null)
                                  }}
                                >
                                  {t('req.viewDetails')}
                                </button>

                                {/* Approve and Reject are per category, in
                                    the Items column; this sends what was
                                    approved. */}
                                {isOwner && request.requestedBy.role !== 'SALES' &&
                                request.status === 'PENDING' &&
                                request.requestedTo?.id === user?.id ? (
                                  <button className={rowStyles.action}
                                    type="button"
                                    onClick={() => {
                                      setDispatching(request)
                                      setOpenMenu(null)
                                    }}
                                  >
                                    {t('dispatch.open')}
                                  </button>
                                ) : null}

                                {/* A salesperson's request: approved whole, from one
                                    page, or rejected. */}
                                {request.requestedBy.role === 'SALES' &&
                                request.status === 'PENDING' &&
                                request.requestedTo?.id === user?.id &&
                                request.items.some((item) => item.approvedQuantity === null) ? (
                                  <>
                                    <button className={rowStyles.action}
                                      type="button"
                                      onClick={() => {
                                        setApproving(request)
                                        setOpenMenu(null)
                                      }}
                                    >
                                      {t('appr.approve')}
                                    </button>
                                    {request.items.every((item) => item.approvedQuantity === null) ? (
                                      <button
                                        type="button"
                                        className={rowStyles.danger}
                                        onClick={() => {
                                          setRejecting(request)
                                          setOpenMenu(null)
                                        }}
                                      >
                                        {t('appr.reject')}
                                      </button>
                                    ) : null}
                                  </>
                                ) : null}

                                {request.requestedBy.role === 'SALES' && readyToSend(request, user?.id) ? (
                                  <button className={rowStyles.action}
                                    type="button"
                                    onClick={() => {
                                      setApproving(request)
                                      setOpenMenu(null)
                                    }}
                                  >
                                    {t('appr.send')}
                                  </button>
                                ) : null}

                                {/* The requester corrects it until anything is decided. */}
                                {request.status === 'PENDING' &&
                                request.requestedBy.id === user?.id &&
                                request.items.every((item) => item.approvedQuantity === null) ? (
                                  <button className={rowStyles.action}
                                    type="button"
                                    onClick={() => {
                                      setOpenMenu(null)
                                      setEditingRequest(request)
                                    }}
                                  >
                                    {t('load.edit')}
                                  </button>
                                ) : null}

                                {request.status === 'PENDING' &&
                                (isOwner ||
                                  request.requestedBy.id === user?.id) ? (
                                  <button
                                    type="button"
                                    className={rowStyles.danger}
                                    onClick={() => void act(request, 'cancel')}
                                  >
                                    {t('req.cancelAction')}
                                  </button>
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
                {count(filtered.length)} requests
                {selected.size > 0 ? ` · ${selected.size} selected` : ''}
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

                  {pageNumbers(safePage, totalPages).map((entry, index) =>
                    entry === '…' ? (
                      <span key={`gap-${index}`} className={styles.gap}>
                        …
                      </span>
                    ) : (
                      <button
                        key={entry}
                        type="button"
                        className={entry === safePage ? styles.pageOn : ''}
                        aria-current={entry === safePage ? 'page' : undefined}
                        onClick={() => setPage(entry)}
                      >
                        {entry}
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

      {detailsOf ? (
        <RequestDetails
          request={detailsOf}
          onClose={() => setDetailsOf(null)}
          onReceived={() => {
            push('success', t('tr.receivedToast'))
            setReloadKey((n) => n + 1)
          }}
          {...(isOwner && detailsOf.requestedBy.role !== 'SALES' &&
          detailsOf.status === 'PENDING' &&
          detailsOf.requestedTo?.id === user?.id
            ? {
                onDispatch: () => {
                  setDispatching(detailsOf)
                  setDetailsOf(null)
                },
              }
            : {})}
        />
      ) : null}

      {rejecting ? (
        <RejectDialog
          title={t('appr.rejectTitleRequest')}
          reference={requestRef(rejecting)}
          what={t('appr.rejectWhatOther')}
          onClose={() => setRejecting(null)}
          onConfirm={async (reason) => {
            await act(rejecting, 'reject', { rejectionReason: reason })
            setRejecting(null)
          }}
        />
      ) : null}

      {dispatching ? (
        <DispatchDialog
          request={dispatching}
          waiting={(requests ?? []).filter(
            (request) =>
              isOwner && request.requestedBy.role !== 'SALES' &&
              request.status === 'PENDING' &&
              request.requestedTo?.id === user?.id,
          )}
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

      {approving ? (
        <ApproveRequestDialog
          request={approving}
          onClose={() => setApproving(null)}
          onDone={(message) => {
            setApproving(null)
            push('success', message)
            setReloadKey((n) => n + 1)
          }}
        />
      ) : null}

      {editingRequest ? (
        <NewRequestDialog
          editing={editingRequest}
          onClose={() => setEditingRequest(null)}
          onDone={(message) => {
            setEditingRequest(null)
            push('success', message)
            setReloadKey((n) => n + 1)
          }}
        />
      ) : null}

      {creating ? (
        <NewRequestDialog
          kind={creating}
          onClose={() => setCreating(null)}
          onDone={(message) => {
            setCreating(null)
            push('success', message)
            setReloadKey((n) => n + 1)
          }}
        />
      ) : null}
      {settingYadere ? (
        <YadereDialog
          onClose={() => setSettingYadere(false)}
          onDone={(message) => {
            setSettingYadere(false)
            push('success', message)
            setReloadKey((n) => n + 1)
          }}
        />
      ) : null}
    </div>
  )
}

function pageNumbers(current: number, total: number): (number | '…')[] {
  if (total <= 7) {
    return Array.from({ length: total }, (_, index) => index + 1)
  }

  const out: (number | '…')[] = [1]
  const from = Math.max(2, current - 1)
  const to = Math.min(total - 1, current + 1)

  if (from > 2) out.push('…')
  for (let n = from; n <= to; n += 1) out.push(n)
  if (to < total - 1) out.push('…')

  out.push(total)
  return out
}

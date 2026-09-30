import { Navigate } from 'react-router-dom'
import { useEffect, useMemo, useRef, useState } from 'react'

import { useAuth } from '../auth/context'
import { Card, Empty } from '../components/Card'
import { DownloadButton } from '../components/DownloadButton'
import { icons } from '../components/icons'
import { ApproveRequestDialog } from '../components/requests/ApproveRequestDialog'
import { CategoryDecisions } from '../components/requests/CategoryDecisions'
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
  return `${date.getFullYear()}-${`${date.getMonth() + 1}`.padStart(2, '0')}-${`${date.getDate()}`.padStart(2, '0')}`
}

/**
 * A supervisor has two lists: what their salespeople asked them for
 * (scope SALES) and what they asked the Owner for (scope MINE). Everyone
 * else sees one list (ALL).
 */
export default function Requests({ scope = 'ALL' }: { scope?: 'ALL' | 'SALES' | 'MINE' }) {
  const { user } = useAuth()

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
  const [creating, setCreating] = useState<StockRequestKind | null>(null)
  const [pending, setPending] = useState<string | null>(null)

  const menuRef = useRef<HTMLDivElement | null>(null)
  const { toasts, push, dismiss } = useToasts()

  // A request is decided one category at a time by whoever it was sent to.
  // The Owner goes straight on to sending a restock once its last category
  // is decided.
  function onDecided(updated: StockRequest, message: string) {
    push('success', message)
    setReloadKey((n) => n + 1)
    setDetailsOf((current) => (current?.id === updated.id ? updated : current))
    if (readyToSend(updated, user?.id)) setApproving(updated)
  }
  const PAGE_SIZE = usePageSize()
  const t = useT()

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
    const isPending = (r: StockRequest) => r.status === 'PENDING'
    const isApproved = (r: StockRequest) =>
      r.status === 'APPROVED' || r.status === 'FULFILLED'
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

    return rows.filter((request) => {
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
  }, [rows, tab, status, branch, type, search, user?.id])

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

  const exportName = `stock-requests-${isoDay(new Date())}.csv`
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
  // salespeople's list.
  if (scope === 'ALL' && isSupervisor) {
    return <Navigate to="/requests/sales" replace />
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
            {t(scope === 'SALES' ? 'req.titleSales' : scope === 'MINE' ? 'req.titleMine' : 'req.title')}
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
                    <th scope="col">{t('req.route')}</th>
                    <th scope="col">{t('req.items')}</th>
                    <th scope="col">{t('common.status')}</th>
                    <th scope="col" className={styles.actionsCol}>
                      {t('common.actions')}
                    </th>
                  </tr>
                </thead>

                <tbody>
                  {pageRows.map((request) => {
                    const when = new Date(request.createdAt)
                    const time = Number.isNaN(when.getTime())
                      ? ''
                      : when.toLocaleTimeString('en-GB', {
                          hour: '2-digit',
                          minute: '2-digit',
                        })

                    return (
                      <tr
                        key={request.id}
                        data-busy={pending === request.id}
                        className={styles.clickableRow}
                        onClick={() => setDetailsOf(request)}
                        data-meta={`${requestRoute(request, t)} · ${shortDate(request.createdAt)} ${time}`}
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

                        <td data-label={t('req.route')} data-col="route">{requestRoute(request, t)}</td>

                        {/* Each category with its own Approve and Reject, or
                            how it was decided. */}
                        <td data-label={t('req.items')} data-col="items">
                          <CategoryDecisions
                            request={request}
                            onDecided={onDecided}
                            onError={(message) => push('error', message)}
                          />
                        </td>

                        <td data-label={t('common.status')}>
                          <span
                            className={styles.status}
                            data-state={request.status}
                          >
                            {t(REQUEST_STATUS_KEY[request.status])}
                          </span>
                        </td>

                        <td
                          className={styles.actionsCol}
                          onClick={(event) => event.stopPropagation()}
                        >
                          <div className={styles.menuWrap}>
                            <button
                              className={styles.iconButton}
                              type="button"
                              aria-label={t('a11y.actionsFor', { name: requestRef(request) })}
                              aria-haspopup="menu"
                              aria-expanded={openMenu === request.id}
                              disabled={pending === request.id}
                              onClick={() =>
                                setOpenMenu(
                                  openMenu === request.id ? null : request.id,
                                )
                              }
                            >
                              <Icon name="more" size={16} />
                            </button>

                            {openMenu === request.id ? (
                              <div
                                className={styles.menu}
                                role="menu"
                                ref={menuRef}
                              >
                                <button
                                  type="button"
                                  role="menuitem"
                                  onClick={() => {
                                    setDetailsOf(request)
                                    setOpenMenu(null)
                                  }}
                                >
                                  {t('req.viewDetails')}
                                </button>

                                {/* Approve and Reject are per category, in
                                    the Items column; this sends what was
                                    approved. */}
                                {readyToSend(request, user?.id) ? (
                                  <button
                                    type="button"
                                    role="menuitem"
                                    onClick={() => {
                                      setApproving(request)
                                      setOpenMenu(null)
                                    }}
                                  >
                                    {t('appr.send')}
                                  </button>
                                ) : null}

                                {request.status === 'PENDING' &&
                                (isOwner ||
                                  request.requestedBy.id === user?.id) ? (
                                  <button
                                    type="button"
                                    role="menuitem"
                                    className={styles.menuDanger}
                                    onClick={() => void act(request, 'cancel')}
                                  >
                                    {t('req.cancelAction')}
                                  </button>
                                ) : null}
                              </div>
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
          {...(detailsOf.status === 'PENDING' && detailsOf.requestedTo?.id === user?.id
            ? { onDecided, onError: (message: string) => push('error', message) }
            : {})}
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

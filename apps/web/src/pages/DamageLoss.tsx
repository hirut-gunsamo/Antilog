import { useEffect, useMemo, useState } from 'react'

import { useAuth } from '../auth/context'
import { RejectDialog } from '../components/approvals/RejectDialog'
import { Card, Empty } from '../components/Card'
import { DownloadButton } from '../components/DownloadButton'
import { icons } from '../components/icons'
import { ReportLossDialog } from '../components/inventory/ReportLossDialog'
import { Toasts } from '../components/Toasts'
import { api } from '../lib/api'
import { count, currency, shortDate } from '../lib/format'
import { useT, type TranslationKey } from '../lib/i18n'
import { LOSS_KIND_KEY, LOSS_STATUS_KEY, lossRef, unitLabel } from '../lib/loss'
import { usePageSize } from '../lib/prefs'
import { useToasts } from '../lib/toasts'
import type { StockLossReport } from '../lib/types'
import styles from './DamageLoss.module.css'

const KIND_FILTERS: { value: string; labelKey: TranslationKey }[] = [
  { value: 'ALL', labelKey: 'loss.allKinds' },
  { value: 'DAMAGED', labelKey: 'loss.damaged' },
  { value: 'LOST', labelKey: 'loss.lost' },
]

const STATUS_FILTERS: { value: string; labelKey: TranslationKey }[] = [
  { value: 'ALL', labelKey: 'inv.allStatus' },
  { value: 'PENDING', labelKey: 'loss.statusPending' },
  { value: 'APPROVED', labelKey: 'loss.statusApproved' },
  { value: 'REJECTED', labelKey: 'loss.statusRejected' },
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

function isThisMonth(iso: string) {
  const date = new Date(iso)
  const now = new Date()

  return (
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth()
  )
}

function reportValue(report: StockLossReport) {
  return Number(report.product.price ?? 0) * report.quantity
}

export default function DamageLoss() {
  const { user } = useAuth()
  const t = useT()
  const { toasts, push, dismiss } = useToasts()
  const PAGE_SIZE = usePageSize()

  const [reports, setReports] = useState<StockLossReport[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [reloadKey, setReloadKey] = useState(0)

  const [kind, setKind] = useState('ALL')
  const [status, setStatus] = useState('ALL')
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)

  const [reporting, setReporting] = useState(false)
  const [rejecting, setRejecting] = useState<StockLossReport | null>(null)
  const [pending, setPending] = useState<string | null>(null)

  const canReview = user?.role === 'SUPERVISOR' || user?.role === 'OWNER'

  useEffect(() => {
    const controller = new AbortController()

    async function load() {
      try {
        const payload = await api<{ reports: StockLossReport[] }>(
          '/api/stock-loss',
          { signal: controller.signal },
        )

        setReports(payload.reports ?? [])
        setError(null)
      } catch (caught) {
        if (controller.signal.aborted) return
        setError(caught instanceof Error ? caught.message : t('loss.loadFailed'))
      }
    }

    void load()

    return () => controller.abort()
  }, [reloadKey, t])

  const rows = useMemo(() => reports ?? [], [reports])

  const summary = useMemo(() => {
    const month = rows.filter((row) => isThisMonth(row.createdAt))

    return {
      pending: rows.filter((row) => row.status === 'PENDING').length,
      damaged: month
        .filter((row) => row.kind === 'DAMAGED' && row.status !== 'REJECTED')
        .reduce((sum, row) => sum + row.quantity, 0),
      lost: month
        .filter((row) => row.kind === 'LOST' && row.status !== 'REJECTED')
        .reduce((sum, row) => sum + row.quantity, 0),
      // A rejected report put its stock back, so it never counts as a cost.
      value: month
        .filter((row) => row.status !== 'REJECTED')
        .reduce((sum, row) => sum + reportValue(row), 0),
    }
  }, [rows])

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase()

    return rows.filter((row) => {
      if (kind !== 'ALL' && row.kind !== kind) return false
      if (status !== 'ALL' && row.status !== status) return false

      if (term) {
        const haystack = [
          lossRef(row),
          row.product.name,
          row.product.sku,
          row.reportedBy.name,
          row.reason,
          ...row.units.map(unitLabel),
        ]
          .join(' ')
          .toLowerCase()

        if (!haystack.includes(term)) return false
      }

      return true
    })
  }, [rows, kind, status, search])

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const safePage = Math.min(page, totalPages)
  const pageRows = filtered.slice(
    (safePage - 1) * PAGE_SIZE,
    safePage * PAGE_SIZE,
  )

  const filtersOn = kind !== 'ALL' || status !== 'ALL' || search !== ''

  function change<T>(setter: (value: T) => void) {
    return (value: T) => {
      setter(value)
      setPage(1)
    }
  }

  async function confirm(report: StockLossReport) {
    setPending(report.id)

    try {
      await api(`/api/stock-loss/${report.id}/approve`, { method: 'PATCH' })
      push('success', t('loss.confirmedRef', { ref: lossRef(report) }))
      setReloadKey((n) => n + 1)
    } catch (caught) {
      push(
        'error',
        caught instanceof Error ? caught.message : t('loss.actionFailed'),
      )
    } finally {
      setPending(null)
    }
  }

  async function reject(report: StockLossReport, reason: string) {
    setPending(report.id)

    try {
      await api(`/api/stock-loss/${report.id}/reject`, {
        method: 'PATCH',
        body: { reason },
      })

      push('success', t('loss.rejectedRef', { ref: lossRef(report) }))
      setRejecting(null)
      setReloadKey((n) => n + 1)
    } catch (caught) {
      push(
        'error',
        caught instanceof Error ? caught.message : t('loss.actionFailed'),
      )
    } finally {
      setPending(null)
    }
  }

  const exportName = `damage-loss-${new Date().toISOString().slice(0, 10)}.csv`

  function toCsv() {
    const header = [
      'Reference',
      'Kind',
      'Status',
      'Date',
      'Branch',
      'SKU',
      'Product',
      'Quantity',
      'Value',
      'Reported by',
      'Reason',
      'Reviewed by',
      'Units',
    ]

    const body = filtered.map((row) => [
      lossRef(row),
      row.kind,
      row.status,
      shortDate(row.createdAt),
      row.location.name,
      row.product.sku,
      row.product.name,
      String(row.quantity),
      String(reportValue(row)),
      row.reportedBy.name,
      row.reason,
      row.reviewedBy?.name ?? '',
      row.units.map(unitLabel).join(' '),
    ])

    return [header, ...body]
      .map((line) =>
        line.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(','),
      )
      .join('\n')
  }

  function download() {
    const blob = new Blob([toCsv()], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')

    link.href = url
    link.download = exportName
    link.click()
    URL.revokeObjectURL(url)

    push('success', t('toast.savedToDownloads', { name: exportName }))
  }

  if (error) {
    return (
      <div className={styles.page}>
        <Card title={t('loss.title')}>
          <Empty>{error}</Empty>
        </Card>
      </div>
    )
  }

  const tiles = [
    {
      key: 'pending',
      tone: 'amber',
      icon: 'clipboard' as const,
      label: t('loss.pendingValue'),
      value: count(summary.pending),
    },
    {
      key: 'damaged',
      tone: 'red',
      icon: 'box' as const,
      label: t('loss.damagedThisMonth'),
      value: count(summary.damaged),
    },
    {
      key: 'lost',
      tone: 'red',
      icon: 'more' as const,
      label: t('loss.lostThisMonth'),
      value: count(summary.lost),
    },
    {
      key: 'value',
      tone: 'blue',
      icon: 'cash' as const,
      label: t('loss.valueThisMonth'),
      value: currency(summary.value),
    },
  ]

  return (
    <div className={styles.page}>
      <header className={styles.head}>
        <div className={styles.mobileHeading}>
          <h1 className={styles.title}>{t('loss.title')}</h1>
          <p className={styles.subtitle}>{t('loss.subtitle')}</p>
        </div>

        <div className={styles.headActions}>
          <DownloadButton
            filename={exportName}
            note={t('sync.nItems', { n: count(filtered.length) })}
            className={styles.ghost}
            disabled={filtered.length === 0}
            onConfirm={download}
          >
            <Icon name="download" size={15} />
            {t('common.export')}
          </DownloadButton>

          {/* Branches report losses; the Owner reviews them. */}
          {user?.role !== 'OWNER' ? (
            <button
              type="button"
              className={styles.primary}
              onClick={() => setReporting(true)}
            >
              <Icon name="plus" size={15} />
              {t('loss.newReport')}
            </button>
          ) : null}
        </div>
      </header>

      <div className={styles.tiles}>
        {tiles.map((tile) => (
          <div key={tile.key} className={styles.tile} data-tone={tile.tone}>
            <span className={styles.tileIcon}>
              <Icon name={tile.icon} size={17} />
            </span>
            <span className={styles.tileText}>
              <span className={styles.tileLabel}>{tile.label}</span>
              <span className={styles.tileValue}>{tile.value}</span>
            </span>
          </div>
        ))}
      </div>

      <Card title={t('loss.title')} subtitle={t('loss.note')}>
        <div className={styles.filters}>
          <label className={styles.search}>
            <Icon name="box" size={15} />
            <input
              value={search}
              onChange={(event) => change(setSearch)(event.target.value)}
              placeholder={t('common.search')}
              spellCheck={false}
            />
          </label>

          <select
            value={kind}
            onChange={(event) => change(setKind)(event.target.value)}
          >
            {KIND_FILTERS.map((option) => (
              <option key={option.value} value={option.value}>
                {t(option.labelKey)}
              </option>
            ))}
          </select>

          <select
            value={status}
            onChange={(event) => change(setStatus)(event.target.value)}
          >
            {STATUS_FILTERS.map((option) => (
              <option key={option.value} value={option.value}>
                {t(option.labelKey)}
              </option>
            ))}
          </select>

          {filtersOn ? (
            <button
              type="button"
              className={styles.reset}
              onClick={() => {
                setKind('ALL')
                setStatus('ALL')
                setSearch('')
                setPage(1)
              }}
            >
              {t('common.reset')}
            </button>
          ) : null}
        </div>

        {!reports ? (
          <Empty>{t('common.loading')}</Empty>
        ) : filtered.length === 0 ? (
          <Empty>{filtersOn ? t('loss.noMatch') : t('loss.nothingYet')}</Empty>
        ) : (
          <>
            <div className={styles.tableWrap}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th scope="col">{t('loss.reference')}</th>
                    <th scope="col">{t('req.date')}</th>
                    <th scope="col">{t('loss.item')}</th>
                    <th scope="col">{t('common.branch')}</th>
                    <th scope="col">{t('loss.qty')}</th>
                    <th scope="col">{t('loss.value')}</th>
                    <th scope="col">{t('loss.reportedBy')}</th>
                    <th scope="col">{t('common.status')}</th>
                    <th scope="col" className={styles.actionsCol}>
                      {t('common.actions')}
                    </th>
                  </tr>
                </thead>

                <tbody>
                  {pageRows.map((row) => {
                    const mine = row.reportedBy.id === user?.id
                    const actionable =
                      canReview && row.status === 'PENDING' && !mine

                    return (
                      <tr key={row.id} data-busy={pending === row.id}>
                        <td data-label={t('loss.reference')} className="tabular">
                          <span className={styles.ref}>
                            <span
                              className={styles.kindDot}
                              data-kind={row.kind}
                              aria-hidden="true"
                            />
                            {lossRef(row)}
                          </span>
                        </td>

                        <td data-label={t('req.date')} className="tabular">
                          {shortDate(row.createdAt)}
                        </td>

                        <td data-label={t('loss.item')}>
                          <span className={styles.item}>
                            {row.product.name}
                            <em>
                              {row.units.length > 0
                                ? row.units.map(unitLabel).join(', ')
                                : row.product.sku}
                            </em>
                          </span>
                        </td>

                        <td data-label={t('common.branch')}>
                          {row.location.name}
                        </td>

                        <td data-label={t('loss.qty')} className="tabular">
                          {count(row.quantity)}
                        </td>

                        <td data-label={t('loss.value')} className="tabular">
                          {currency(reportValue(row))}
                        </td>

                        <td data-label={t('loss.reportedBy')}>
                          {row.reportedBy.name}
                        </td>

                        <td data-label={t('common.status')}>
                          <span
                            className={styles.state}
                            data-state={row.status}
                            title={row.reason}
                          >
                            {t(LOSS_STATUS_KEY[row.status])}
                          </span>
                          <span className={styles.kindTag}>
                            {t(LOSS_KIND_KEY[row.kind])}
                          </span>
                        </td>

                        <td
                          data-label={t('common.actions')}
                          className={styles.actionsCol}
                        >
                          {actionable ? (
                            <span className={styles.rowActions}>
                              <button
                                type="button"
                                className={styles.confirm}
                                disabled={pending === row.id}
                                onClick={() => void confirm(row)}
                              >
                                {t('loss.confirm')}
                              </button>
                              <button
                                type="button"
                                className={styles.rejectButton}
                                disabled={pending === row.id}
                                onClick={() => setRejecting(row)}
                              >
                                {t('appr.reject')}
                              </button>
                            </span>
                          ) : row.status === 'PENDING' ? (
                            <em className={styles.waiting}>
                              {mine ? t('loss.ownReport') : t('loss.awaitingReview')}
                            </em>
                          ) : (
                            <em className={styles.waiting}>
                              {row.reviewedBy?.name ?? '—'}
                            </em>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>

            <div className={styles.foot}>
              <span className={styles.showing}>
                {t('loss.showing', {
                  from: (safePage - 1) * PAGE_SIZE + 1,
                  to: Math.min(safePage * PAGE_SIZE, filtered.length),
                  total: filtered.length,
                })}
              </span>

              {totalPages > 1 ? (
                <div className={styles.pager} role="group">
                  <button
                    type="button"
                    onClick={() => setPage((n) => Math.max(1, n - 1))}
                    disabled={safePage === 1}
                    aria-label={t('common.prevPage')}
                  >
                    ‹
                  </button>
                  <span className="tabular">
                    {safePage} / {totalPages}
                  </span>
                  <button
                    type="button"
                    onClick={() => setPage((n) => Math.min(totalPages, n + 1))}
                    disabled={safePage === totalPages}
                    aria-label={t('common.nextPage')}
                  >
                    ›
                  </button>
                </div>
              ) : null}
            </div>
          </>
        )}
      </Card>

      {reporting ? (
        <ReportLossDialog
          onClose={() => setReporting(false)}
          onDone={(message) => {
            setReporting(false)
            push('success', message)
            setReloadKey((n) => n + 1)
          }}
        />
      ) : null}

      {rejecting ? (
        <RejectDialog
          title={t('loss.rejectTitle')}
          reference={lossRef(rejecting)}
          what={t('loss.rejectWhat', {
            n: count(rejecting.quantity),
            product: rejecting.product.name,
          })}
          onClose={() => setRejecting(null)}
          onConfirm={(reason) => reject(rejecting, reason)}
        />
      ) : null}

      <Toasts toasts={toasts} onDismiss={dismiss} />
    </div>
  )
}

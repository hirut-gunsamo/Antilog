import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'

import { useAuth } from '../auth/context'
import { Card, Empty } from '../components/Card'
import { BarList, ColumnChart } from '../components/charts/Charts'
import { DownloadButton } from '../components/DownloadButton'
import { icons } from '../components/icons'
import { RecordDialog } from '../components/nationalId/RecordDialog'
import { ReceiveBlanksDialog } from '../components/nationalId/ReceiveBlanksDialog'
import { Toasts } from '../components/Toasts'
import { api } from '../lib/api'
import { count, currency, shortDate } from '../lib/format'
import { useT, type TranslationKey } from '../lib/i18n'
import { usePageSize } from '../lib/prefs'
import { useSettings } from '../lib/settings'
import { useToasts } from '../lib/toasts'
import type {
  BranchRow,
  NationalIdBlankBalance,
  NationalIdRecord,
  NationalIdSummary,
} from '../lib/types'
import styles from './NationalId.module.css'

/** Below this a branch is close to running out. */
const LOW_BLANKS = 50

const RANGES: { value: string; labelKey: TranslationKey }[] = [
  { value: 'today', labelKey: 'dash.today' },
  { value: 'week', labelKey: 'nid.thisWeek' },
  { value: 'month', labelKey: 'nid.thisMonth' },
  { value: 'year', labelKey: 'nid.thisYear' },
  { value: 'custom', labelKey: 'nid.custom' },
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

export default function NationalId() {
  const { user } = useAuth()
  const t = useT()
  const { settings } = useSettings()
  const { toasts, push, dismiss } = useToasts()
  const PAGE_SIZE = usePageSize()

  const [records, setRecords] = useState<NationalIdRecord[] | null>(null)
  const [summary, setSummary] = useState<NationalIdSummary | null>(null)
  const [branches, setBranches] = useState<BranchRow[]>([])
  const [blanks, setBlanks] = useState<NationalIdBlankBalance[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [reloadKey, setReloadKey] = useState(0)

  const [range, setRange] = useState('month')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [branch, setBranch] = useState('ALL')
  const [employee, setEmployee] = useState('ALL')
  const [page, setPage] = useState(1)

  const [searchParams, setSearchParams] = useSearchParams()
  const [adding, setAdding] = useState(searchParams.get('new') === '1')
  const [receiving, setReceiving] = useState(false)
  const [editing, setEditing] = useState<NationalIdRecord | null>(null)
  const [openMenu, setOpenMenu] = useState<string | null>(null)
  const [pending, setPending] = useState<string | null>(null)

  const menuRef = useRef<HTMLDivElement | null>(null)
  const isOwner = user?.role === 'OWNER'

  // Arriving from the sidebar's "Add New Record" opens the dialog once; the
  // flag is cleared during render so a refresh does not reopen it.
  if (searchParams.get('new') === '1') {
    setSearchParams({}, { replace: true })
    if (!adding) setAdding(true)
  }

  // Custom only takes effect once both ends are set, so a half-typed date
  // never wipes the figures.
  const customReady = range !== 'custom' || (from !== '' && to !== '')

  useEffect(() => {
    const controller = new AbortController()

    async function load() {
      try {
        const params = new URLSearchParams({ range })

        if (range === 'custom' && from && to) {
          params.set('from', from)
          params.set('to', to)
        }

        if (branch !== 'ALL') params.set('locationId', branch)

        const [list, totals, stock] = await Promise.all([
          api<{ records: NationalIdRecord[] }>('/api/national-id', {
            signal: controller.signal,
          }),
          api<{ summary: NationalIdSummary }>(
            `/api/national-id/summary?${params.toString()}`,
            { signal: controller.signal },
          ),
          api<{ balances: NationalIdBlankBalance[] }>(
            '/api/national-id/blanks',
            { signal: controller.signal },
          ).catch(() => ({ balances: [] as NationalIdBlankBalance[] })),
        ])

        setRecords(list.records ?? [])
        setSummary(totals.summary)
        setBlanks(stock.balances ?? [])
        setError(null)
      } catch (caught) {
        if (controller.signal.aborted) return
        setError(caught instanceof Error ? caught.message : t('nid.loadFailed'))
      }
    }

    if (customReady) void load()

    return () => controller.abort()
  }, [reloadKey, range, from, to, branch, customReady, t])

  useEffect(() => {
    if (!isOwner) return

    const controller = new AbortController()

    api<{ branches: BranchRow[] }>('/api/branches', { signal: controller.signal })
      .then((payload) => setBranches(payload.branches ?? []))
      .catch(() => undefined)

    return () => controller.abort()
  }, [isOwner])

  useEffect(() => {
    if (!openMenu) return

    function onDown(event: MouseEvent) {
      if (!menuRef.current?.contains(event.target as Node)) setOpenMenu(null)
    }

    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [openMenu])

  const rows = useMemo(() => records ?? [], [records])

  const employees = useMemo(() => {
    const seen = new Map<string, string>()
    for (const row of rows) seen.set(row.recordedBy.id, row.recordedBy.name)
    return [...seen.entries()].sort((a, b) => a[1].localeCompare(b[1]))
  }, [rows])

  // The table follows the same window as the figures above it, so the two
  // never disagree about what period is being looked at.
  const filtered = useMemo(() => {
    if (!summary) return []

    return rows.filter((row) => {
      const day = row.date.slice(0, 10)

      if (day < summary.from || day > summary.to) return false
      if (branch !== 'ALL' && row.location.id !== branch) return false
      if (employee !== 'ALL' && row.recordedBy.id !== employee) return false

      return true
    })
  }, [rows, summary, branch, employee])

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const safePage = Math.min(page, totalPages)
  const pageRows = filtered.slice(
    (safePage - 1) * PAGE_SIZE,
    safePage * PAGE_SIZE,
  )

  function change<T>(setter: (value: T) => void) {
    return (value: T) => {
      setter(value)
      setPage(1)
    }
  }

  async function remove(row: NationalIdRecord) {
    setPending(row.id)
    setOpenMenu(null)

    try {
      await api(`/api/national-id/${row.id}`, { method: 'DELETE' })
      push('success', t('nid.deleted', { date: row.date.slice(0, 10) }))
      setReloadKey((n) => n + 1)
    } catch (caught) {
      push(
        'error',
        caught instanceof Error ? caught.message : t('nid.saveFailed'),
      )
    } finally {
      setPending(null)
    }
  }

  const exportName = `national-id-${summary?.from ?? ''}-to-${summary?.to ?? ''}.csv`

  function download() {
    const header = [
      'Date',
      'Branch',
      'Employee',
      'Original ID',
      'Copy ID',
      'Total',
      `Revenue (${settings.currency})`,
      'Notes',
    ]

    const body = filtered.map((row) => [
      row.date.slice(0, 10),
      row.location.name,
      row.recordedBy.name,
      String(row.originalCount),
      String(row.copyCount),
      String(row.originalCount + row.copyCount),
      String(row.revenue),
      row.notes ?? '',
    ])

    const csv = [header, ...body]
      .map((line) =>
        line.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(','),
      )
      .join('\n')

    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
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
        <Card title={t('nav.nationalId')}>
          <Empty>{error}</Empty>
        </Card>
      </div>
    )
  }

  const tiles = summary
    ? [
        {
          key: 'total',
          tone: 'blue',
          icon: 'sim' as const,
          label: t('nid.totalPrinted'),
          value: count(summary.totals.total),
        },
        {
          key: 'original',
          tone: 'green',
          icon: 'clipboard' as const,
          label: t('nid.originalIds'),
          value: count(summary.totals.original),
        },
        {
          key: 'copy',
          tone: 'amber',
          icon: 'receipt' as const,
          label: t('nid.copyIds'),
          value: count(summary.totals.copy),
        },
        {
          key: 'revenue',
          tone: 'purple',
          icon: 'cash' as const,
          label: t('nid.revenue'),
          value: currency(summary.totals.revenue),
        },
      ]
    : []

  return (
    <div className={styles.page}>
      <header className={styles.head}>
        <div className={styles.mobileHeading}>
          <h1 className={styles.title}>{t('nid.title')}</h1>
          <p className={styles.subtitle}>{t('nid.subtitle')}</p>
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

          <button
            type="button"
            className={styles.primary}
            onClick={() => setAdding(true)}
          >
            <Icon name="plus" size={15} />
            {t('nid.addRecord')}
          </button>
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
              <span className={styles.tileNote}>
                {summary ? `${summary.from} → ${summary.to}` : ''}
              </span>
            </span>
          </div>
        ))}
      </div>

      <Card title={t('nid.records')} subtitle={t('nid.recordsNote')}>
        <div className={styles.filters}>
          <select
            value={range}
            onChange={(event) => change(setRange)(event.target.value)}
          >
            {RANGES.map((option) => (
              <option key={option.value} value={option.value}>
                {t(option.labelKey)}
              </option>
            ))}
          </select>

          {range === 'custom' ? (
            <>
              <input
                type="date"
                value={from}
                onChange={(event) => change(setFrom)(event.target.value)}
                aria-label={t('nid.from')}
              />
              <input
                type="date"
                value={to}
                onChange={(event) => change(setTo)(event.target.value)}
                aria-label={t('nid.to')}
              />
            </>
          ) : null}

          {isOwner ? (
            <select
              value={branch}
              onChange={(event) => change(setBranch)(event.target.value)}
            >
              <option value="ALL">{t('inv.allBranches')}</option>
              {branches.map((entry) => (
                <option key={entry.id} value={entry.id}>
                  {entry.name}
                </option>
              ))}
            </select>
          ) : null}

          <select
            value={employee}
            onChange={(event) => change(setEmployee)(event.target.value)}
          >
            <option value="ALL">{t('nid.allEmployees')}</option>
            {employees.map(([id, name]) => (
              <option key={id} value={id}>
                {name}
              </option>
            ))}
          </select>
        </div>

        {!records || !summary ? (
          <Empty>{t('common.loading')}</Empty>
        ) : filtered.length === 0 ? (
          <Empty>{t('nid.nothingYet')}</Empty>
        ) : (
          <>
            <div className={styles.tableWrap}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th scope="col">{t('req.date')}</th>
                    <th scope="col">{t('common.branch')}</th>
                    <th scope="col">{t('nid.employee')}</th>
                    <th scope="col" className={styles.num}>
                      {t('nid.originalId')}
                    </th>
                    <th scope="col" className={styles.num}>
                      {t('nid.copyId')}
                    </th>
                    <th scope="col" className={styles.num}>
                      {t('nid.total')}
                    </th>
                    <th scope="col" className={styles.num}>
                      {t('nid.revenueShort', { currency: settings.currency })}
                    </th>
                    <th scope="col">{t('dlg.note')}</th>
                    <th scope="col" className={styles.actionsCol}>
                      {t('common.actions')}
                    </th>
                  </tr>
                </thead>

                <tbody>
                  {pageRows.map((row) => (
                    <tr key={row.id} data-busy={pending === row.id}>
                      <td data-label={t('req.date')} className="tabular">
                        {shortDate(row.date)}
                      </td>
                      <td data-label={t('common.branch')}>
                        {row.location.name}
                      </td>
                      <td data-label={t('nid.employee')}>
                        {row.recordedBy.name}
                      </td>
                      <td
                        data-label={t('nid.originalId')}
                        className={`${styles.num} tabular`}
                      >
                        {count(row.originalCount)}
                      </td>
                      <td
                        data-label={t('nid.copyId')}
                        className={`${styles.num} tabular`}
                      >
                        {count(row.copyCount)}
                      </td>
                      <td
                        data-label={t('nid.total')}
                        className={`${styles.num} ${styles.strong} tabular`}
                      >
                        {count(row.originalCount + row.copyCount)}
                      </td>
                      <td
                        data-label={t('nid.revenueShort', {
                          currency: settings.currency,
                        })}
                        className={`${styles.num} tabular`}
                      >
                        {currency(Number(row.revenue))}
                      </td>
                      <td data-label={t('dlg.note')}>
                        {row.notes ? (
                          <span className={styles.noteTag}>{row.notes}</span>
                        ) : (
                          <span className={styles.dash}>—</span>
                        )}
                      </td>

                      <td
                        data-label={t('common.actions')}
                        className={styles.actionsCol}
                      >
                        <div className={styles.menuWrap}>
                          <button
                            type="button"
                            className={styles.dots}
                            aria-haspopup="menu"
                            aria-expanded={openMenu === row.id}
                            aria-label={t('a11y.actionsFor', {
                              name: row.recordedBy.name,
                            })}
                            onClick={() =>
                              setOpenMenu(openMenu === row.id ? null : row.id)
                            }
                          >
                            <Icon name="more" size={16} />
                          </button>

                          {openMenu === row.id ? (
                            <div
                              className={styles.menu}
                              role="menu"
                              ref={menuRef}
                            >
                              <button
                                type="button"
                                role="menuitem"
                                onClick={() => {
                                  setEditing(row)
                                  setOpenMenu(null)
                                }}
                              >
                                {t('nid.editRecord')}
                              </button>
                              <button
                                type="button"
                                role="menuitem"
                                className={styles.menuDanger}
                                onClick={() => void remove(row)}
                              >
                                {t('common.delete')}
                              </button>
                            </div>
                          ) : null}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className={styles.foot}>
              <span className={styles.showing}>
                {t('nid.showing', {
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

      <div className={styles.charts}>
        {/* Blank stock sits beside the records rather than in Inventory:
            it is supply for this service, not stock the branch sells. */}
        <Card
          title={t('nid.blanksTitle')}
          subtitle={t('nid.blanksNote')}
          action={
            <button
              type="button"
              className={styles.linkButton}
              onClick={() => setReceiving(true)}
            >
              {t('nid.receiveBlanks')}
            </button>
          }
        >
          {!blanks ? (
            <Empty>{t('common.loading')}</Empty>
          ) : blanks.length === 0 ? (
            <Empty>{t('nid.noBranches')}</Empty>
          ) : (
            <ul className={styles.blankList}>
              {blanks.map((entry) => (
                <li key={entry.locationId}>
                  <span className={styles.blankBranch}>{entry.name}</span>

                  {entry.tracked ? (
                    <span className={styles.blankCounts}>
                      <span data-low={entry.originalRemaining <= LOW_BLANKS}>
                        <em>{t('nid.originalId')}</em>
                        <strong className="tabular">
                          {count(entry.originalRemaining)}
                        </strong>
                      </span>
                      <span data-low={entry.copyRemaining <= LOW_BLANKS}>
                        <em>{t('nid.copyId')}</em>
                        <strong className="tabular">
                          {count(entry.copyRemaining)}
                        </strong>
                      </span>
                    </span>
                  ) : (
                    <span className={styles.untracked}>
                      {t('nid.notTracked')}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )}

          <p className={styles.blankHint}>{t('nid.blanksDerived')}</p>
        </Card>

        <Card title={t('nid.rates')} subtitle={t('nid.ratesShortNote')}>
          <dl className={styles.rateFacts}>
            <div>
              <dt>{t('nid.originalId')}</dt>
              <dd className="tabular">
                {currency(Number(settings.nationalIdOriginalRate))}
                <em>{t('nid.perPrint')}</em>
              </dd>
            </div>
            <div>
              <dt>{t('nid.copyId')}</dt>
              <dd className="tabular">
                {currency(Number(settings.nationalIdCopyRate))}
                <em>{t('nid.perPrint')}</em>
              </dd>
            </div>
          </dl>

          {user?.role === 'OWNER' ? (
            <Link className={styles.linkButton} to="/settings">
              {t('nid.editRates')}
            </Link>
          ) : null}
        </Card>
      </div>

      {summary && summary.byBranch.length > 0 ? (
        <div className={styles.charts}>
          <Card
            title={t('nid.byBranch')}
            subtitle={`${summary.from} → ${summary.to}`}
          >
            {/* The note keeps the original/copy split visible per branch, so
                the breakdown never collapses into a single number. */}
            <BarList
              data={summary.byBranch.map((entry) => ({
                key: entry.locationId,
                label: entry.name,
                value: entry.total,
                note: t('nid.splitOf', {
                  original: count(entry.original),
                  copy: count(entry.copy),
                }),
              }))}
              valueFormat={(value) => count(value)}
              emptyMessage={t('nid.nothingYet')}
            />
          </Card>

          <Card
            title={t('nid.dailyTrend')}
            subtitle={`${summary.from} → ${summary.to}`}
          >
            <ColumnChart
              data={summary.trend.map((point) => ({
                key: point.date,
                label: point.date.slice(5),
                value: point.original + point.copy,
              }))}
              valueFormat={(value) => count(value)}
            />
          </Card>
        </div>
      ) : null}

      {receiving ? (
        <ReceiveBlanksDialog
          balances={blanks ?? []}
          onClose={() => setReceiving(false)}
          onDone={(message) => {
            setReceiving(false)
            push('success', message)
            setReloadKey((n) => n + 1)
          }}
        />
      ) : null}

      {adding ? (
        <RecordDialog
          onClose={() => setAdding(false)}
          onDone={(message) => {
            setAdding(false)
            push('success', message)
            setReloadKey((n) => n + 1)
          }}
        />
      ) : null}

      {editing ? (
        <RecordDialog
          record={editing}
          onClose={() => setEditing(null)}
          onDone={(message) => {
            setEditing(null)
            push('success', message)
            setReloadKey((n) => n + 1)
          }}
        />
      ) : null}

      <Toasts toasts={toasts} onDismiss={dismiss} />
    </div>
  )
}

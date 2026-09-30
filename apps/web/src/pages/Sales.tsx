import { useEffect, useMemo, useRef, useState } from 'react'

import { useAuth } from '../auth/context'
import { Card, Empty } from '../components/Card'
import { DownloadButton } from '../components/DownloadButton'
import { icons } from '../components/icons'
import { NewSaleDialog } from '../components/sales/NewSaleDialog'
import { SaleDetails } from '../components/sales/SaleDetails'
import { Toasts } from '../components/Toasts'
import { api } from '../lib/api'
import { useBranchList } from '../lib/branches'
import { count, currency, getCurrency, shortDate } from '../lib/format'
import {
  isSameDay,
  saleItemCount,
  saleItemSummary,
  saleRef,
  STATUS_KEY,
} from '../lib/sales'
import { useT, type TranslationKey } from '../lib/i18n'
import { usePageSize } from '../lib/prefs'
import { useToasts } from '../lib/toasts'
import type { Sale } from '../lib/types'
import styles from './Sales.module.css'

const TABS = [
  { value: 'ALL', labelKey: 'sales.tabAll' },
  { value: 'MINE', labelKey: 'sales.tabMine' },
] as const satisfies readonly { value: string; labelKey: TranslationKey }[]

type TabValue = (typeof TABS)[number]['value']

const CATEGORY_FILTERS: { value: string; labelKey: TranslationKey }[] = [
  { value: 'ALL', labelKey: 'inv.allCategories' },
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

export default function Sales() {
  const { user } = useAuth()

  const [sales, setSales] = useState<Sale[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [reloadKey, setReloadKey] = useState(0)

  const [tab, setTab] = useState<TabValue>('ALL')
  const [search, setSearch] = useState('')
  const [branch, setBranch] = useState('ALL')
  const [employee, setEmployee] = useState('ALL')
  const [category, setCategory] = useState('ALL')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [page, setPage] = useState(1)

  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [openMenu, setOpenMenu] = useState<string | null>(null)
  const [detailsOf, setDetailsOf] = useState<Sale | null>(null)
  const [creating, setCreating] = useState(false)

  const menuRef = useRef<HTMLDivElement | null>(null)
  const { toasts, push, dismiss } = useToasts()
  const PAGE_SIZE = usePageSize()
  const t = useT()

  useEffect(() => {
    const controller = new AbortController()

    async function load() {
      try {
        const payload = await api<{ sales: Sale[] }>('/api/sales', {
          signal: controller.signal,
        })

        setSales(payload.sales ?? [])
        setError(null)
      } catch (caught) {
        if (controller.signal.aborted) return
        setError(
          caught instanceof Error ? caught.message : t('sales.loadFailed'),
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

  const rows = useMemo(() => sales ?? [], [sales])

  // Branch and employee lists come from the rows themselves, so they can never
  // offer someone this viewer is not allowed to see.
  const branchList = useBranchList()
  const branches = useMemo(() => {
    const seen = new Map<string, string>(branchList)
    for (const sale of rows) seen.set(sale.location.id, sale.location.name)
    return [...seen.entries()].sort((a, b) => a[1].localeCompare(b[1]))
  }, [rows, branchList])

  const employees = useMemo(() => {
    const seen = new Map<string, string>()
    for (const sale of rows) seen.set(sale.salesperson.id, sale.salesperson.name)
    return [...seen.entries()].sort((a, b) => a[1].localeCompare(b[1]))
  }, [rows])

  // The four cards, and their change against the day before.
  const summary = useMemo(() => {
    const today = new Date()
    const yesterday = new Date(today)
    yesterday.setDate(today.getDate() - 1)

    const counted = rows.filter((sale) => sale.status === 'APPROVED')
    const todays = counted.filter((sale) => isSameDay(sale.saleDate, today))
    const prior = counted.filter((sale) => isSameDay(sale.saleDate, yesterday))

    const sum = (list: Sale[], pick: (sale: Sale) => number) =>
      list.reduce((total, sale) => total + pick(sale), 0)

    const change = (now: number, before: number) => {
      if (before === 0) return now > 0 ? 100 : 0
      return Math.round(((now - before) / before) * 1000) / 10
    }

    const revenue = sum(todays, (s) => Number(s.totalAmount))
    const items = sum(todays, saleItemCount)
    const cash = sum(todays, (s) => Number(s.cashReceived))

    return {
      revenue,
      revenueChange: change(revenue, sum(prior, (s) => Number(s.totalAmount))),
      items,
      itemsChange: change(items, sum(prior, saleItemCount)),
      cash,
      cashChange: change(cash, sum(prior, (s) => Number(s.cashReceived))),
      transactions: todays.length,
    }
  }, [rows])

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase()
    const fromTime = from ? new Date(`${from}T00:00:00`).getTime() : null
    const toTime = to ? new Date(`${to}T23:59:59`).getTime() : null

    return rows.filter((sale) => {
      if (tab === 'MINE' && sale.salesperson.id !== user?.id) return false

      if (branch !== 'ALL' && sale.location.id !== branch) return false
      if (employee !== 'ALL' && sale.salesperson.id !== employee) return false

      if (
        category !== 'ALL' &&
        !sale.items.some((item) => item.product.category === category)
      ) {
        return false
      }

      const when = new Date(sale.saleDate).getTime()
      if (fromTime !== null && when < fromTime) return false
      if (toTime !== null && when > toTime) return false

      if (term) {
        const hit =
          saleRef(sale).toLowerCase().includes(term) ||
          sale.salesperson.name.toLowerCase().includes(term) ||
          sale.location.name.toLowerCase().includes(term) ||
          sale.items.some(
            (item) =>
              item.product.name.toLowerCase().includes(term) ||
              item.product.sku.toLowerCase().includes(term),
          )

        if (!hit) return false
      }

      return true
    })
  }, [rows, tab, branch, employee, category, from, to, search, user?.id])

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const safePage = Math.min(page, totalPages)
  const pageRows = filtered.slice(
    (safePage - 1) * PAGE_SIZE,
    safePage * PAGE_SIZE,
  )

  const isSales = user?.role === 'SALES'
  const isOwner = user?.role === 'OWNER'

  const filtersOn =
    tab !== 'ALL' ||
    search !== '' ||
    branch !== 'ALL' ||
    employee !== 'ALL' ||
    category !== 'ALL' ||
    from !== '' ||
    to !== ''

  function reset() {
    setTab('ALL')
    setSearch('')
    setBranch('ALL')
    setEmployee('ALL')
    setCategory('ALL')
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

  const exportName = `sales-${isoDay(new Date())}.csv`
  const exportRows = selected.size > 0 ? selected.size : filtered.length

  function exportCsv() {
    const list =
      selected.size > 0
        ? filtered.filter((sale) => selected.has(sale.id))
        : filtered

    const header = [
      'Sale ID',
      'Date',
      'Employee',
      'Branch',
      'Items',
      'Qty',
      'Total (ETB)',
      'Received',
      'Payment',
      'Bank',
      'Status',
    ]

    const escape = (value: string) =>
      /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value

    const lines = [
      header.join(','),
      ...list.map((sale) =>
        [
          saleRef(sale),
          new Date(sale.saleDate).toISOString(),
          sale.salesperson.name,
          sale.location.name,
          sale.items.map((i) => i.product.name).join(' | '),
          String(saleItemCount(sale)),
          String(Number(sale.totalAmount)),
          String(Number(sale.cashReceived) + Number(sale.transferReceived)),
          sale.paymentMethod === 'TRANSFER' ? 'Transfer' : 'Cash',
          sale.bankName ?? '',
          t(STATUS_KEY[sale.status]),
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

  if (error) {
    return (
      <div className={styles.page}>
        <Card title={t("sales.title")}>
          <Empty>{error}</Empty>
        </Card>
      </div>
    )
  }

  if (!sales) {
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
      key: 'revenue',
      tone: 'green',
      icon: 'cart' as const,
      label: t('sales.todaysSales'),
      value: currency(summary.revenue),
      change: summary.revenueChange,
    },
    {
      key: 'items',
      tone: 'blue',
      icon: 'box' as const,
      label: t('dash.itemsSold'),
      value: count(summary.items),
      change: summary.itemsChange,
    },
    {
      key: 'cash',
      tone: 'amber',
      icon: 'cash' as const,
      label: t('dlg.cashReceived'),
      value: currency(summary.cash),
      change: summary.cashChange,
    },
    {
      key: 'transactions',
      tone: 'red',
      icon: 'clipboard' as const,
      label: t('dash.transactions'),
      value: count(summary.transactions),
      change: null,
    },
  ]

  return (
    <div className={styles.page}>
      <header className={styles.head}>
        <div className={styles.mobileHeading}>
          <h1 className={styles.title}>{t('sales.title')}</h1>
          <p className={styles.subtitle}>
{t('sales.note')}
          </p>
        </div>

        <div className={styles.headActions}>
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

          {/* Everyone below the Owner sees one branch's sales, so there is no
              choice to offer — the branch is stated instead of being a filter
              whose options all show the same list. */}
          {!isOwner && user?.branch ? (
            <span className={styles.branchTag}>{user.branch.name}</span>
          ) : null}

          {isOwner ? (
            <select
              className={styles.select}
              value={branch}
              onChange={(event) => change(setBranch)(event.target.value)}
              aria-label={t("inv.branchLabel")}
            >
              <option value="ALL">{t("inv.allBranches")}</option>
              {branches.map(([id, name]) => (
                <option key={id} value={id}>
                  {name}
                </option>
              ))}
            </select>
          ) : null}

          {/* The API lets only a SALES user create a sale, so the button is
              theirs alone rather than a 403 waiting to happen. */}
          {isSales ? (
            <button
              className={styles.primary}
              type="button"
              onClick={() => setCreating(true)}
            >
              <Icon name="plus" size={15} />
              {t('sales.newSale')}
            </button>
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
                {tile.value}
              </strong>
              {tile.change !== null ? (
                <span
                  className={styles.tileChange}
                  data-dir={tile.change >= 0 ? 'up' : 'down'}
                >
                  {tile.change >= 0 ? '↑' : '↓'} {Math.abs(tile.change)}%
                  <em>from yesterday</em>
                </span>
              ) : null}
            </div>
          </div>
        ))}
      </div>

      <Card>
        <div className={styles.tabs} role="tablist">
          <div className={styles.tabList}>
            {/* "All" and "mine" are the same list for a seller, who only ever
                sees their own sales. */}
            {(isSales ? TABS.filter((option) => option.value === 'ALL') : TABS).map((option) => (
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
            note={`${exportRows} sale${exportRows === 1 ? '' : 's'}`}
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
              placeholder={t("sales.searchPlaceholder")}
              aria-label={t("sales.searchLabel")}
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

          {!isSales ? (
            <select
              className={styles.select}
              value={employee}
              onChange={(event) => change(setEmployee)(event.target.value)}
              aria-label={t("sales.employeeFilter")}
            >
              <option value="ALL">{t("sales.allEmployees")}</option>
              {employees.map(([id, name]) => (
                <option key={id} value={id}>
                  {name}
                </option>
              ))}
            </select>
          ) : null}

          <select
            className={styles.select}
            value={category}
            onChange={(event) => change(setCategory)(event.target.value)}
            aria-label={t("sales.categoryFilter")}
          >
            {CATEGORY_FILTERS.map((option) => (
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
              ? t('sales.noneYet')
              : t('sales.noMatch')}
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
                          pageRows.every((sale) => selected.has(sale.id))
                        }
                        onChange={() =>
                          setSelected((current) => {
                            const next = new Set(current)
                            const all = pageRows.every((s) => next.has(s.id))
                            for (const sale of pageRows) {
                              if (all) next.delete(sale.id)
                              else next.add(sale.id)
                            }
                            return next
                          })
                        }
                        aria-label={t("common.selectAll")}
                      />
                    </th>
                    <th scope="col">{t('sales.saleId')}</th>
                    <th scope="col">{t('sales.dateTime')}</th>
                    <th scope="col">{t('sales.employee')}</th>
                    <th scope="col">{t('common.branch')}</th>
                    <th scope="col">{t('sales.items')}</th>
                    <th scope="col">{t('sales.qty')}</th>
                    <th scope="col">{t('sales.total', { currency: getCurrency() })}</th>
                    <th scope="col">{t('pay.received')}</th>
                    <th scope="col">{t('common.status')}</th>
                    <th scope="col" className={styles.actionsCol}>
                      {t('common.actions')}
                    </th>
                  </tr>
                </thead>

                <tbody>
                  {pageRows.map((sale) => {
                    const when = new Date(sale.saleDate)
                    const time = Number.isNaN(when.getTime())
                      ? ''
                      : when.toLocaleTimeString('en-GB', {
                          hour: '2-digit',
                          minute: '2-digit',
                        })

                    return (
                      <tr
                        key={sale.id}
                        className={styles.clickableRow}
                        onClick={() => setDetailsOf(sale)}
                        data-meta={`${sale.location.name} · ${shortDate(sale.saleDate)} ${time}`}
                      >
                        <td
                          className={styles.tick}
                          onClick={(event) => event.stopPropagation()}
                        >
                          <input
                            type="checkbox"
                            checked={selected.has(sale.id)}
                            onChange={() =>
                              setSelected((current) => {
                                const next = new Set(current)
                                if (next.has(sale.id)) next.delete(sale.id)
                                else next.add(sale.id)
                                return next
                              })
                            }
                            aria-label={t('a11y.selectRow', { name: saleRef(sale) })}
                          />
                        </td>

                        <td data-label={t('sales.saleId')} className={styles.ref}>
                          {saleRef(sale)}
                        </td>

                        <td data-label={t('sales.dateTime')}>
                          {shortDate(sale.saleDate)}
                          <span className={styles.time}> {time}</span>
                        </td>

                        <td data-label={t('sales.employee')}>{sale.salesperson.name}</td>
                        <td data-label={t('common.branch')}>{sale.location.name}</td>
                        <td data-label={t('sales.items')}>{saleItemSummary(sale)}</td>

                        <td data-label={t('sales.qty')} className="tabular">
                          {count(saleItemCount(sale))}
                        </td>

                        <td data-label={t('det.total')} className={`${styles.strong} tabular`}>
                          {currency(Number(sale.totalAmount))}
                        </td>

                        <td data-label={t('pay.received')} className="tabular">
                          {currency(Number(sale.cashReceived) + Number(sale.transferReceived))}
                          <small style={{ display: 'block', opacity: 0.7 }}>
                            {sale.paymentMethod === 'TRANSFER'
                              ? `${t('pay.transfer')} · ${sale.bankName ?? ''}`
                              : t('pay.cash')}
                          </small>
                        </td>

                        <td data-label={t('common.status')}>
                          <span
                            className={styles.status}
                            data-state={sale.status}
                          >
                            {t(STATUS_KEY[sale.status])}
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
                              aria-label={t('a11y.actionsFor', { name: saleRef(sale) })}
                              aria-haspopup="menu"
                              aria-expanded={openMenu === sale.id}
                              onClick={() =>
                                setOpenMenu(
                                  openMenu === sale.id ? null : sale.id,
                                )
                              }
                            >
                              <Icon name="more" size={16} />
                            </button>

                            {openMenu === sale.id ? (
                              <div
                                className={styles.menu}
                                role="menu"
                                ref={menuRef}
                              >
                                <button
                                  type="button"
                                  role="menuitem"
                                  onClick={() => {
                                    setDetailsOf(sale)
                                    setOpenMenu(null)
                                  }}
                                >
                                  {t('sales.viewDetails')}
                                </button>

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
                {count(filtered.length)} sales
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
        <SaleDetails sale={detailsOf} onClose={() => setDetailsOf(null)} />
      ) : null}


      {creating ? (
        <NewSaleDialog
          onClose={() => setCreating(false)}
          onDone={(message) => {
            setCreating(false)
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

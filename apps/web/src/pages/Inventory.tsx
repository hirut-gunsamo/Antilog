import { useEffect, useMemo, useRef, useState } from 'react'

import { useAuth } from '../auth/context'
import { Card, Empty } from '../components/Card'
import { DownloadButton } from '../components/DownloadButton'
import { icons } from '../components/icons'
import { DeleteRowDialog } from '../components/inventory/DeleteRowDialog'
import { EditRowDialog } from '../components/inventory/EditRowDialog'
import { ReportLossDialog } from '../components/inventory/ReportLossDialog'
import { StockInDialog } from '../components/inventory/StockInDialog'
import { Toasts } from '../components/Toasts'
import { UnitDetails } from '../components/inventory/UnitDetails'
import { api } from '../lib/api'
import { useBranchList } from '../lib/branches'
import { useT, type TranslationKey } from '../lib/i18n'
import { usePageSize } from '../lib/prefs'
import { useToasts } from '../lib/toasts'
import { currency, count } from '../lib/format'
import {
  LOW_STOCK_THRESHOLD,
  stockStatus,
  type StockStatus,
} from '../lib/stock'
import type {
  InventoryBalance,
  InventorySummary,
  InventoryUnit,
  StockMovement,
} from '../lib/types'
import styles from './Inventory.module.css'

const TABS = [
  { value: 'ALL', labelKey: 'inv.tabAll' },
  { value: 'SIM_CARD', labelKey: 'inv.simCards' },
  { value: 'PHONE', labelKey: 'inv.phones' },
  { value: 'AIRTIME_VOUCHER', labelKey: 'inv.vouchers' },
  // Everything in the categories the Owner added (Accessories and the like).
  { value: 'OTHER', labelKey: 'inv.otherItems' },
] as const satisfies readonly { value: string; labelKey: TranslationKey }[]

type TabValue = (typeof TABS)[number]['value']

const CATEGORY_PILL: Record<string, TranslationKey> = {
  SIM_CARD: 'inv.catSim',
  PHONE: 'inv.catPhone',
  AIRTIME_VOUCHER: 'inv.catVoucher',
}

const CATEGORY_ICON: Record<string, keyof typeof icons> = {
  SIM_CARD: 'sim',
  PHONE: 'phone',
  AIRTIME_VOUCHER: 'ticket',
}

const STATUS_FILTERS: {
  value: StockStatus | 'ALL'
  labelKey: TranslationKey
}[] = [
  { value: 'ALL', labelKey: 'inv.allStatus' },
  { value: 'IN_STOCK', labelKey: 'inv.inStock' },
  { value: 'LOW_STOCK', labelKey: 'inv.lowStock' },
  { value: 'OUT_OF_STOCK', labelKey: 'inv.outOfStock' },
]

function Icon({
  name,
  size = 16,
}: {
  name: keyof typeof icons
  size?: number
}) {
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

export default function Inventory() {
  const { user } = useAuth()
  const isSales = user?.role === 'SALES'

  const [summary, setSummary] = useState<InventorySummary | null>(null)
  const [units, setUnits] = useState<InventoryUnit[]>([])
  const [movements, setMovements] = useState<StockMovement[]>([])
  const [error, setError] = useState<string | null>(null)
  const [reloadKey, setReloadKey] = useState(0)

  // Filters
  const [tab, setTab] = useState<TabValue>('ALL')
  const [search, setSearch] = useState('')
  const [branch, setBranch] = useState('ALL')
  const [status, setStatus] = useState<StockStatus | 'ALL'>('ALL')
  const [page, setPage] = useState(1)

  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [openMenu, setOpenMenu] = useState<string | null>(null)
  const [detailsOf, setDetailsOf] = useState<InventoryBalance | null>(null)
  const [editOf, setEditOf] = useState<InventoryBalance | null>(null)
  const [deleteOf, setDeleteOf] = useState<InventoryBalance | null>(null)
  const [lossOf, setLossOf] = useState<InventoryBalance | null>(null)
  const [addOpen, setAddOpen] = useState(false)

  const menuRef = useRef<HTMLDivElement | null>(null)

  const { toasts, push, dismiss } = useToasts()
  const PAGE_SIZE = usePageSize()
  const t = useT()

  useEffect(() => {
    const controller = new AbortController()

    async function load() {
      try {
        const [summaryRes, unitsRes, movementsRes] = await Promise.all([
          // A salesperson sees only what was issued to them.
          api<{ summary: InventorySummary }>(
            `/api/inventory/summary${isSales ? '?mine=1' : ''}`,
            { signal: controller.signal },
          ),
          api<{ units: InventoryUnit[] }>('/api/inventory/units', {
            signal: controller.signal,
          }),
          api<{ movements: StockMovement[] }>('/api/inventory/movements', {
            signal: controller.signal,
          }),
        ])

        setSummary(summaryRes.summary)
        setUnits(unitsRes.units ?? [])
        setMovements(movementsRes.movements ?? [])
        setError(null)
      } catch (caught) {
        if (controller.signal.aborted) return
        setError(
          caught instanceof Error ? caught.message : t('inv.loadFailed'),
        )
      }
    }

    void load()

    return () => controller.abort()
  }, [reloadKey, t, isSales])

  // Close the row menu on an outside click.
  useEffect(() => {
    if (!openMenu) return

    function onDown(event: MouseEvent) {
      if (!menuRef.current?.contains(event.target as Node)) setOpenMenu(null)
    }

    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [openMenu])

  // Memoised so the filter/branch derivations below are not recomputed on
  // every render by a fresh empty array.
  const items = useMemo(() => summary?.items ?? [], [summary])

  // Branch list comes from the rows themselves, so it can never offer a branch
  // this viewer is not allowed to see.
  const branchList = useBranchList()
  const branches = useMemo(() => {
    const seen = new Map<string, string>(branchList)
    for (const item of items) seen.set(item.location.id, item.location.name)
    return [...seen.entries()].sort((a, b) => a[1].localeCompare(b[1]))
  }, [items, branchList])

  // Serial/IMEI/ICCID search resolves to the products carrying that unit.
  const serialMatches = useMemo(() => {
    const term = search.trim().toLowerCase()
    if (term.length < 3) return null

    const hits = new Set<string>()

    for (const unit of units) {
      const haystack = [
        unit.serialNumber,
        unit.simNumber,
        unit.iccid,
        unit.imei,
      ]
      if (haystack.some((v) => v?.toLowerCase().includes(term))) {
        hits.add(`${unit.productId}:${unit.locationId}`)
      }
    }

    return hits
  }, [search, units])

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase()

    return items.filter((item) => {
      if (tab !== 'ALL' && item.product.category !== tab) return false
      if (branch !== 'ALL' && item.location.id !== branch) return false

      if (status !== 'ALL') {
        if (stockStatus(item.product.category, item.onShelf) !== status) {
          return false
        }
      }

      if (term) {
        const textHit =
          item.product.name.toLowerCase().includes(term) ||
          item.product.sku.toLowerCase().includes(term)

        const serialHit =
          serialMatches?.has(`${item.productId}:${item.locationId}`) ?? false

        if (!textHit && !serialHit) return false
      }

      return true
    })
  }, [items, tab, branch, status, search, serialMatches])

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const safePage = Math.min(page, totalPages)
  const pageRows = filtered.slice(
    (safePage - 1) * PAGE_SIZE,
    safePage * PAGE_SIZE,
  )

  const isOwner = user?.role === 'OWNER'
  const filtersOn =
    tab !== 'ALL' || branch !== 'ALL' || status !== 'ALL' || search !== ''

  // Changing any filter returns you to page one, otherwise a narrower result
  // set would leave you stranded on a page that no longer exists.
  function applyTab(value: TabValue) {
    setTab(value)
    setPage(1)
  }

  function applySearch(value: string) {
    setSearch(value)
    setPage(1)
  }

  function applyBranch(value: string) {
    setBranch(value)
    setPage(1)
  }

  function applyStatus(value: StockStatus | 'ALL') {
    setStatus(value)
    setPage(1)
  }

  function resetFilters() {
    setTab('ALL')
    setSearch('')
    setBranch('ALL')
    setStatus('ALL')
    setPage(1)
  }

  function toggleRow(id: string) {
    setSelected((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const pageAllSelected =
    pageRows.length > 0 && pageRows.every((row) => selected.has(row.id))

  function togglePage() {
    setSelected((current) => {
      const next = new Set(current)
      if (pageAllSelected) for (const row of pageRows) next.delete(row.id)
      else for (const row of pageRows) next.add(row.id)
      return next
    })
  }

  // Export what is on screen, or just the ticked rows when there are any.
  const exportName = `inventory-${new Date().toISOString().slice(0, 10)}.csv`
  const exportRows = selected.size > 0 ? selected.size : filtered.length

  function exportCsv() {
    const rows = selected.size > 0
      ? filtered.filter((row) => selected.has(row.id))
      : filtered

    const header = [
      'SKU',
      'Product',
      'Category',
      'Branch',
      'On shelf',
      'With salespeople',
      'Total',
      'Status',
      `Price (ETB)`,
    ]

    const escape = (value: string) =>
      /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value

    const lines = [
      header.join(','),
      ...rows.map((row) =>
        [
          row.product.sku,
          row.product.name,
          CATEGORY_PILL[row.product.category]
            ? t(CATEGORY_PILL[row.product.category])
            : row.product.category,
          row.location.name,
          String(row.onShelf),
          String(row.withSellers),
          String(row.quantity),
          t(
            STATUS_FILTERS.find(
              (s) =>
                s.value === stockStatus(row.product.category, row.onShelf),
            )?.labelKey ?? 'inv.inStock',
          ),
          String(Number(row.product.price ?? 0)),
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
        <Card title={t("inv.title")}>
          <Empty>{error}</Empty>
        </Card>
      </div>
    )
  }

  if (!summary) {
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

  const stat = [
    {
      key: 'total',
      tone: 'green',
      icon: 'box' as const,
      label: t(isSales ? 'inv.left' : 'inv.onShelf'),
      value: summary.totalUnits,
    },
    {
      key: 'sim',
      tone: 'blue',
      icon: 'sim' as const,
      label: t('inv.simCards'),
      value: summary.byCategory.SIM_CARD,
    },
    {
      key: 'phone',
      tone: 'amber',
      icon: 'phone' as const,
      label: t('inv.phones'),
      value: summary.byCategory.PHONE,
    },
    {
      key: 'voucher',
      tone: 'red',
      icon: 'ticket' as const,
      label: t('inv.vouchers'),
      value: summary.byCategory.AIRTIME_VOUCHER,
    },
  ]

  return (
    <div className={styles.page}>
      <header className={styles.head}>
        {/* The shell's header carries the title on desktop, so this only
            appears where that header is hidden. */}
        <div className={styles.mobileHeading}>
          <h1 className={styles.title}>{t('inv.title')}</h1>
          <p className={styles.subtitle}>
            {isOwner ? t('inv.noteAll') : t('inv.noteBranch')}
          </p>
        </div>

        <div className={styles.headActions}>
          {/* Everyone below the Owner sees one branch — their own — so a
              picker offering "All branches" and that same branch would be
              two names for one list. */}
          {isOwner ? (
            <select
              className={styles.select}
              value={branch}
              onChange={(event) => applyBranch(event.target.value)}
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

          {isOwner ? (
            <button
              className={styles.primary}
              type="button"
              onClick={() => setAddOpen(true)}
            >
              <Icon name="plus" size={15} />
              {t('inv.add')}
            </button>
          ) : null}
        </div>
      </header>

      <div className={styles.tiles}>
        {stat.map((tile) => (
          <div
            key={tile.key}
            className={styles.tile}
            data-tone={tile.tone}
          >
            <span className={styles.tileIcon}>
              <Icon name={tile.icon} size={19} />
            </span>
            <div>
              <span className={styles.tileLabel}>{tile.label}</span>
              <strong className={`${styles.tileValue} tabular`}>
                {count(tile.value)}
              </strong>
              {tile.key === 'total' && summary.withSellers > 0 ? (
                <small style={{ display: 'block', opacity: 0.7 }}>
                  {t('inv.plusWithSales', { n: count(summary.withSellers) })}
                </small>
              ) : null}
            </div>
          </div>
        ))}
      </div>

      <Card>
        <div className={styles.tabs} role="tablist">
          <div className={styles.tabList}>
            {TABS.map((option) => (
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
                onClick={() => applyTab(option.value)}
              >
                {t(option.labelKey)}
              </button>
            ))}
          </div>

          <DownloadButton
            filename={exportName}
            note={`${exportRows} row${exportRows === 1 ? '' : 's'}`}
            onConfirm={exportCsv}
            className={styles.ghost}
            title={
              selected.size > 0
                ? `Export ${selected.size} selected`
                : 'Export what is on screen'
            }
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
              onChange={(event) => applySearch(event.target.value)}
              placeholder={t("inv.searchPlaceholder")}
              aria-label={t("inv.searchLabel")}
            />
          </label>

          <select
            className={styles.select}
            value={tab}
            onChange={(event) => applyTab(event.target.value as TabValue)}
            aria-label={t("inv.categoryLabel")}
          >
            <option value="ALL">{t("inv.allCategories")}</option>
            <option value="SIM_CARD">{t("inv.simCards")}</option>
            <option value="PHONE">{t("inv.phones")}</option>
            <option value="AIRTIME_VOUCHER">{t("inv.vouchers")}</option>
          </select>

          {isOwner ? (
            <select
              className={styles.select}
              value={branch}
              onChange={(event) => applyBranch(event.target.value)}
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
            value={status}
            onChange={(event) =>
              applyStatus(event.target.value as StockStatus | 'ALL')
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
            onClick={resetFilters}
            disabled={!filtersOn}
          >
            {t('common.reset')}
          </button>
        </div>

        {filtered.length === 0 ? (
          <Empty>
            {items.length === 0
              ? t('inv.noneYet')
              : t('inv.noMatch')}
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
                        checked={pageAllSelected}
                        onChange={togglePage}
                        aria-label={t("common.selectAll")}
                      />
                    </th>
                    <th scope="col">{t('inv.sku')}</th>
                    <th scope="col">{t('inv.product')}</th>
                    <th scope="col">{t('inv.category')}</th>
                    <th scope="col">{t('common.branch')}</th>
                    <th scope="col">{t(isSales ? 'inv.left' : 'inv.onShelf')}</th>
                    <th scope="col">{t('common.status')}</th>
                    <th scope="col">{t('inv.price')}</th>
                    <th scope="col" className={styles.actionsCol}>
                      {t('common.actions')}
                    </th>
                  </tr>
                </thead>

                <tbody>
                  {pageRows.map((row) => {
                    const state = stockStatus(
                      row.product.category,
                      row.onShelf,
                    )
                    const unitCount = units.filter(
                      (unit) =>
                        unit.productId === row.productId &&
                        unit.locationId === row.locationId,
                    ).length

                    return (
                      <tr
                        key={row.id}
                        // Read by the phone layout's ::after to rebuild the
                        // "SKU · Branch · N in stock" line without extra markup.
                        data-meta={`${row.product.sku} · ${row.location.name} · ${t('inv.nInStock', { n: count(row.onShelf) })}`}
                        className={styles.clickableRow}
                        onClick={() => setDetailsOf(row)}
                      >
                        <td
                          className={styles.tick}
                          onClick={(event) => event.stopPropagation()}
                        >
                          <input
                            type="checkbox"
                            checked={selected.has(row.id)}
                            onChange={() => toggleRow(row.id)}
                            aria-label={t('a11y.selectRow', { name: row.product.name })}
                          />
                        </td>

                        <td data-label={t('inv.sku')}>
                          <span className={styles.sku}>
                            <span
                              className={styles.skuIcon}
                              data-category={row.product.category}
                            >
                              <Icon
                                name={
                                  CATEGORY_ICON[row.product.category] ?? 'box'
                                }
                                size={13}
                              />
                            </span>
                            <span className="tabular">{row.product.sku}</span>
                          </span>
                        </td>

                        <td data-label={t('inv.product')} className={styles.strong}>
                          {row.product.name}
                        </td>

                        <td data-label={t('inv.category')}>
                          <span
                            className={styles.pill}
                            data-category={row.product.category}
                          >
                            {CATEGORY_PILL[row.product.category]
                              ? t(CATEGORY_PILL[row.product.category])
                              : row.product.category}
                          </span>
                        </td>

                        <td data-label={t('common.branch')}>{row.location.name}</td>

                        <td data-label={t(isSales ? 'inv.left' : 'inv.onShelf')} className="tabular">
                          {count(row.onShelf)}
                          {/* A salesperson's own stock: where it came from and went. */}
                          {row.mine ? (
                            <small style={{ display: 'block', opacity: 0.7 }}>
                              {t('inv.mineLine', {
                                received: count(row.mine.received),
                                sold: count(row.mine.sold),
                              })}
                              {row.mine.returned > 0
                                ? ` · ${t('inv.mineReturned', { n: count(row.mine.returned) })}`
                                : ''}
                            </small>
                          ) : null}
                          {/* Issued goods stay the branch's until sold. */}
                          {row.withSellers > 0 ? (
                            <small style={{ display: 'block', opacity: 0.7 }}>
                              {t('inv.withSalesTotal', {
                                n: count(row.withSellers),
                                total: count(row.quantity),
                              })}
                            </small>
                          ) : null}
                        </td>

                        <td data-label={t('common.status')}>
                          <span className={styles.status} data-state={state}>
                            {t(
                              STATUS_FILTERS.find((s) => s.value === state)
                                ?.labelKey ?? 'inv.inStock',
                            )}
                          </span>
                        </td>

                        <td data-label={t('inv.price')} className="tabular">
                          {currency(Number(row.product.price ?? 0))}
                        </td>

                        <td
                          className={styles.actionsCol}
                          onClick={(event) => event.stopPropagation()}
                        >
                          <div className={styles.menuWrap}>
                            <button
                              className={styles.iconButton}
                              type="button"
                              aria-label={t('a11y.actionsFor', { name: row.product.name })}
                              aria-haspopup="menu"
                              aria-expanded={openMenu === row.id}
                              onClick={() =>
                                setOpenMenu(
                                  openMenu === row.id ? null : row.id,
                                )
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
                                    setDetailsOf(row)
                                    setOpenMenu(null)
                                  }}
                                >
                                  {t('inv.viewDetails')}
                                  {unitCount > 0 ? (
                                    <em>{t('inv.nSerialised', { n: unitCount })}</em>
                                  ) : null}
                                </button>

                                {!isOwner ? (
                                  <button
                                    type="button"
                                    role="menuitem"
                                    onClick={() => {
                                      setLossOf(row)
                                      setOpenMenu(null)
                                    }}
                                  >
                                    {t('inv.reportLoss')}
                                  </button>
                                ) : null}

                                {isOwner ? (
                                  <>
                                    <button
                                      type="button"
                                      role="menuitem"
                                      onClick={() => {
                                        setEditOf(row)
                                        setOpenMenu(null)
                                      }}
                                    >
                                      {t('inv.editItem')}
                                    </button>

                                    <button
                                      type="button"
                                      role="menuitem"
                                      className={styles.menuDanger}
                                      onClick={() => {
                                        setDeleteOf(row)
                                        setOpenMenu(null)
                                      }}
                                    >
                                      {t('inv.deleteRow')}
                                    </button>
                                  </>
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
                {count(filtered.length)} items
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

      {detailsOf ? (
        <UnitDetails
          balance={detailsOf}
          units={units.filter(
            (unit) =>
              unit.productId === detailsOf.productId &&
              unit.locationId === detailsOf.locationId,
          )}
          movements={movements.filter(
            (move) => move.productId === detailsOf.productId,
          )}
          threshold={LOW_STOCK_THRESHOLD[detailsOf.product.category] ?? 0}
          onClose={() => setDetailsOf(null)}
        />
      ) : null}

      {editOf ? (
        <EditRowDialog
          balance={editOf}
          onClose={() => setEditOf(null)}
          onDone={(message) => {
            setEditOf(null)
            setReloadKey((n) => n + 1)
            push('success', message)
          }}
        />
      ) : null}

      {lossOf ? (
        <ReportLossDialog
          balance={lossOf}
          onClose={() => setLossOf(null)}
          onDone={(message) => {
            setLossOf(null)
            push('success', message)
            setReloadKey((n) => n + 1)
          }}
        />
      ) : null}

      {deleteOf ? (
        <DeleteRowDialog
          balance={deleteOf}
          onClose={() => setDeleteOf(null)}
          onDone={(message) => {
            setDeleteOf(null)
            setSelected(new Set())
            setReloadKey((n) => n + 1)
            push('success', message)
          }}
        />
      ) : null}

      <Toasts toasts={toasts} onDismiss={dismiss} />

      {addOpen ? (
        <StockInDialog
          onClose={() => setAddOpen(false)}
          onDone={(message) => {
            setAddOpen(false)
            setReloadKey((n) => n + 1)
            push('success', message)
          }}
        />
      ) : null}
    </div>
  )
}

// 1 … 4 5 [6] 7 8 … 207
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

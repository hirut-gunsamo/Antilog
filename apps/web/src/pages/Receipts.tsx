import { AuthImg, AuthLink } from '../components/AuthFile'
import rowStyles from '../components/RowMenu.module.css'
import { businessDay } from '../lib/tz'
import { useSavedState } from '../lib/savedState'
import { useEffect, useMemo, useRef, useState } from 'react'

import { useAuth } from '../auth/context'
import { RejectDialog } from '../components/approvals/RejectDialog'
import { Card, Empty } from '../components/Card'
import { DownloadButton } from '../components/DownloadButton'
import { icons } from '../components/icons'
import { ReceiptDetails } from '../components/receipts/ReceiptDetails'
import { UploadReceiptDialog } from '../components/receipts/UploadReceiptDialog'
import { Toasts } from '../components/Toasts'
import { api } from '../lib/api'
import { useBranchList } from '../lib/branches'
import { count, currency, getCurrency, shortDate } from '../lib/format'
import {
  isPdf,
  receiptRef,
  RECEIPT_STATUS_KEY,
  RECEIPT_STATUS_LABEL,
} from '../lib/receipts'
import { useT, type TranslationKey } from '../lib/i18n'
import { usePageSize } from '../lib/prefs'
import { useToasts } from '../lib/toasts'
import type { BankReceipt } from '../lib/types'
import styles from './Receipts.module.css'

const TABS = [
  { value: 'ALL', labelKey: 'rcpt.tabAll' },
  { value: 'PENDING', labelKey: 'rcpt.tabPending' },
  { value: 'VERIFIED', labelKey: 'rcpt.tabVerified' },
  { value: 'REJECTED', labelKey: 'rcpt.tabRejected' },
] as const satisfies readonly { value: string; labelKey: TranslationKey }[]

type TabValue = (typeof TABS)[number]['value']

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

export default function Receipts() {
  const { user } = useAuth()

  const [receipts, setReceipts] = useState<BankReceipt[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [reloadKey, setReloadKey] = useState(0)

  const [tab, setTab] = useState<TabValue>('ALL')
  const [search, setSearch] = useState('')
  const [branch, setBranch] = useState('ALL')
  const [status, setStatus] = useState('ALL')
  const [from, setFrom] = useSavedState('receipts:from', '')
  const [to, setTo] = useSavedState('receipts:to', '')
  const [page, setPage] = useState(1)

  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [openMenu, setOpenMenu] = useState<string | null>(null)
  const [detailsOf, setDetailsOf] = useState<BankReceipt | null>(null)
  const [rejecting, setRejecting] = useState<BankReceipt | null>(null)
  const [uploading, setUploading] = useState(false)
  const [editingReceipt, setEditingReceipt] = useState<BankReceipt | null>(null)
  const [pending, setPending] = useState<string | null>(null)

  const menuRef = useRef<HTMLDivElement | null>(null)
  const { toasts, push, dismiss } = useToasts()
  const PAGE_SIZE = usePageSize()
  const t = useT()

  useEffect(() => {
    const controller = new AbortController()

    async function load() {
      try {
        const payload = await api<{ receipts: BankReceipt[] }>(
          '/api/receipts',
          { signal: controller.signal },
        )

        setReceipts(payload.receipts ?? [])
        setError(null)
      } catch (caught) {
        if (controller.signal.aborted) return
        setError(
          caught instanceof Error ? caught.message : t('rcpt.loadFailed'),
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

  const rows = useMemo(() => receipts ?? [], [receipts])

  const branchList = useBranchList()
  const branches = useMemo(() => {
    const seen = new Set<string>(branchList.map(([, name]) => name))
    for (const receipt of rows) {
      const name = (receipt.location ?? receipt.uploadedBy.branch)?.name
      if (name) seen.add(name)
    }
    return [...seen].sort()
  }, [rows, branchList])

  const summary = useMemo(() => {
    const now = new Date()
    const inMonth = (iso: string, offset: number) => {
      const date = new Date(iso)
      const target = new Date(now.getFullYear(), now.getMonth() - offset, 1)
      return (
        date.getFullYear() === target.getFullYear() &&
        date.getMonth() === target.getMonth()
      )
    }

    const change = (nowValue: number, before: number) => {
      if (before === 0) return nowValue > 0 ? 100 : 0
      return Math.round(((nowValue - before) / before) * 1000) / 10
    }

    const thisMonth = rows.filter((r) => inMonth(r.createdAt, 0))
    const lastMonth = rows.filter((r) => inMonth(r.createdAt, 1))
    const sum = (list: BankReceipt[]) =>
      list.reduce((total, r) => total + Number(r.amount), 0)

    return {
      total: rows.length,
      totalChange: change(thisMonth.length, lastMonth.length),
      amount: rows.reduce((total, r) => total + Number(r.amount), 0),
      amountChange: change(sum(thisMonth), sum(lastMonth)),
      pending: rows.filter((r) => r.status === 'PENDING').length,
      pendingChange: change(
        thisMonth.filter((r) => r.status === 'PENDING').length,
        lastMonth.filter((r) => r.status === 'PENDING').length,
      ),
      rejected: rows.filter((r) => r.status === 'REJECTED').length,
      rejectedChange: change(
        thisMonth.filter((r) => r.status === 'REJECTED').length,
        lastMonth.filter((r) => r.status === 'REJECTED').length,
      ),
    }
  }, [rows])

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase()
    const fromTime = from ? new Date(`${from}T00:00:00`).getTime() : null
    const toTime = to ? new Date(`${to}T23:59:59`).getTime() : null

    return rows
      .filter((receipt) => {
        if (tab !== 'ALL' && receipt.status !== tab) return false
        if (status !== 'ALL' && receipt.status !== status) return false
        if (branch !== 'ALL' && (receipt.location ?? receipt.uploadedBy.branch)?.name !== branch) {
          return false
        }

        const when = new Date(receipt.receiptDate).getTime()
        if (fromTime !== null && when < fromTime) return false
        if (toTime !== null && when > toTime) return false

        if (term) {
          const hit =
            receiptRef(receipt).toLowerCase().includes(term) ||
            (receipt.referenceNumber ?? '').toLowerCase().includes(term) ||
            (receipt.bankName ?? '').toLowerCase().includes(term) ||
            (receipt.notes ?? '').toLowerCase().includes(term)

          if (!hit) return false
        }

        return true
      })
      .sort((a, b) => +new Date(b.receiptDate) - +new Date(a.receiptDate))
  }, [rows, tab, status, branch, from, to, search])

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const safePage = Math.min(page, totalPages)
  const pageRows = filtered.slice(
    (safePage - 1) * PAGE_SIZE,
    safePage * PAGE_SIZE,
  )

  // Salespeople bank their own takings and upload the slip; the supervisor
  // (or the Owner) verifies it before it counts as banked.
  const canUpload = user?.role === 'SALES' || user?.role === 'SUPERVISOR' || user?.role === 'OWNER'
  const canVerify = user?.role === 'SUPERVISOR' || user?.role === 'OWNER'

  const filtersOn =
    tab !== 'ALL' ||
    search !== '' ||
    branch !== 'ALL' ||
    status !== 'ALL' ||
    from !== '' ||
    to !== ''

  function reset() {
    setTab('ALL')
    setSearch('')
    setBranch('ALL')
    setStatus('ALL')
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

  async function verify(receipt: BankReceipt) {
    setPending(receipt.id)
    setOpenMenu(null)

    try {
      await api(`/api/receipts/${receipt.id}/verify`, { method: 'PATCH' })
      push('success', t('toast.verifiedRef', { ref: receiptRef(receipt) }))
      setReloadKey((n) => n + 1)
    } catch (caught) {
      push(
        'error',
        caught instanceof Error ? caught.message : t('rcpt.verifyFailed'),
      )
    } finally {
      setPending(null)
    }
  }

  // Sales and supervisors delete their own: before it is verified, or while
  // the Owner has allowed changes to it (24 hours).
  const canDelete = (receipt: BankReceipt) =>
    user?.role === 'OWNER' ||
    (receipt.uploadedBy.id === user?.id &&
      (receipt.status !== 'VERIFIED' ||
        (receipt.editAllowedUntil != null && new Date(receipt.editAllowedUntil) > new Date())))

  async function remove(receipt: BankReceipt) {
    setOpenMenu(null)
    if (!window.confirm(t('rcpt.deleteConfirm', { ref: receiptRef(receipt) }))) return
    setPending(receipt.id)

    try {
      await api(`/api/receipts/${receipt.id}`, { method: 'DELETE' })
      push('success', t('rcpt.deleted', { ref: receiptRef(receipt) }))
      setSelected((current) => {
        const next = new Set(current)
        next.delete(receipt.id)
        return next
      })
      setReloadKey((n) => n + 1)
    } catch (caught) {
      push('error', caught instanceof Error ? caught.message : t('rcpt.deleteFailed'))
    } finally {
      setPending(null)
    }
  }

  async function reject(receipt: BankReceipt, reason: string) {
    setPending(receipt.id)

    try {
      await api(`/api/receipts/${receipt.id}/reject`, {
        method: 'PATCH',
        body: { notes: reason },
      })

      push('success', t('toast.rejectedRef', { ref: receiptRef(receipt) }))
      setRejecting(null)
      setReloadKey((n) => n + 1)
    } finally {
      setPending(null)
    }
  }

  const exportName = `receipts-${isoDay(new Date())}.csv`
  const exportRows = selected.size > 0 ? selected.size : filtered.length

  function exportCsv() {
    const list =
      selected.size > 0
        ? filtered.filter((receipt) => selected.has(receipt.id))
        : filtered

    const header = [
      'Receipt ID',
      'Date',
      'Branch',
      'Amount (ETB)',
      'Bank',
      'Reference',
      'Status',
      'Verified By',
    ]

    const escape = (value: string) =>
      /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value

    const lines = [
      header.join(','),
      ...list.map((receipt) =>
        [
          receiptRef(receipt),
          new Date(receipt.receiptDate).toISOString().slice(0, 10),
          (receipt.location ?? receipt.uploadedBy.branch)?.name ?? '',
          String(Number(receipt.amount)),
          receipt.bankName ?? '',
          receipt.referenceNumber ?? '',
          RECEIPT_STATUS_LABEL[receipt.status],
          receipt.verifiedBy?.name ?? '',
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
        <Card title={t("rcpt.title")}>
          <Empty>{error}</Empty>
        </Card>
      </div>
    )
  }

  if (!receipts) {
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
      tone: 'green',
      icon: 'receipt' as const,
      label: t('rcpt.totalReceipts'),
      value: count(summary.total),
      change: summary.totalChange,
    },
    {
      key: 'amount',
      tone: 'blue',
      icon: 'cash' as const,
      label: t('rcpt.totalAmount'),
      value: currency(summary.amount),
      change: summary.amountChange,
    },
    {
      key: 'pending',
      tone: 'amber',
      icon: 'clipboard' as const,
      label: t('rcpt.pendingVerification'),
      value: count(summary.pending),
      change: summary.pendingChange,
    },
    {
      key: 'rejected',
      tone: 'red',
      icon: 'more' as const,
      label: t('rcpt.statusRejected'),
      value: count(summary.rejected),
      change: summary.rejectedChange,
    },
  ]

  return (
    <div className={styles.page}>
      <header className={styles.head}>
        <div className={styles.mobileHeading}>
          <h1 className={styles.title}>{t('rcpt.title')}</h1>
          <p className={styles.subtitle}>
{t('rcpt.note')}
          </p>
        </div>

        <div className={styles.headActions}>
          {/* Uploading is for the people who bank the cash: salespeople bank
              their own takings, and the supervisor verifies each slip. */}
          {canUpload ? (
            <button
              className={styles.primary}
              type="button"
              onClick={() => setUploading(true)}
            >
              <Icon name="plus" size={15} />
              {t(user?.role === 'SALES' ? 'rcpt.uploadBank' : 'rcpt.upload')}
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
                onClick={() => change(setTab)(option.value)}
              >
                {t(option.labelKey)}
              </button>
            ))}
          </div>

          <DownloadButton
            filename={exportName}
            note={`${exportRows} receipt${exportRows === 1 ? '' : 's'}`}
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
              placeholder={t("rcpt.searchPlaceholder")}
              aria-label={t("rcpt.searchLabel")}
            />
          </label>

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
            <option value="ALL">{t("inv.allStatus")}</option>
            <option value="PENDING">{t("rcpt.statusPending")}</option>
            <option value="VERIFIED">{t("rcpt.statusVerified")}</option>
            <option value="REJECTED">{t("rcpt.statusRejected")}</option>
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
              ? canUpload
                ? t('rcpt.noneYetUploader')
                : t('rcpt.noneYet')
              : t('rcpt.noMatch')}
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
                            for (const receipt of pageRows) {
                              if (all) next.delete(receipt.id)
                              else next.add(receipt.id)
                            }
                            return next
                          })
                        }
                        aria-label={t("common.selectAll")}
                      />
                    </th>
                    <th scope="col">{t('rcpt.receiptId')}</th>
                    <th scope="col">{t('req.date')}</th>
                    <th scope="col">{t('common.branch')}</th>
                    <th scope="col">{t('rcpt.amount', { currency: getCurrency() })}</th>
                    <th scope="col">{t('rcpt.yadere')}</th>
                    <th scope="col">{t('rcpt.slip')}</th>
                    <th scope="col">{t('rcpt.reference')}</th>
                    <th scope="col">{t('common.status')}</th>
                    <th scope="col">{t('rcpt.verifiedBy')}</th>
                    <th scope="col" className={styles.actionsCol}>
                      {t('common.actions')}
                    </th>
                  </tr>
                </thead>

                <tbody>
                  {pageRows.map((receipt) => (
                    <tr
                      key={receipt.id}
                      data-busy={pending === receipt.id}
                      data-meta={`${(receipt.location ?? receipt.uploadedBy.branch)?.name ?? '—'} · ${shortDate(receipt.receiptDate)}`}
                      className={styles.clickableRow}
                      onClick={() => setDetailsOf(receipt)}
                    >
                      <td
                        className={styles.tick}
                        onClick={(event) => event.stopPropagation()}
                      >
                        <input
                          type="checkbox"
                          checked={selected.has(receipt.id)}
                          onChange={() =>
                            setSelected((current) => {
                              const next = new Set(current)
                              if (next.has(receipt.id)) next.delete(receipt.id)
                              else next.add(receipt.id)
                              return next
                            })
                          }
                          aria-label={t('a11y.selectRow', { name: receiptRef(receipt) })}
                        />
                      </td>

                      <td data-label={t('rcpt.receiptId')} className={styles.ref}>
                        {receiptRef(receipt)}
                      </td>

                      <td data-label={t('req.date')}>{shortDate(receipt.receiptDate)}</td>

                      <td data-label={t('common.branch')}>
                        {(receipt.location ?? receipt.uploadedBy.branch)?.name ?? '—'}
                      </td>

                      <td
                        data-label={t('rep.amount')}
                        className={`${styles.strong} tabular`}
                      >
                        {currency(Number(receipt.amount))}
                      </td>

                      <td data-label={t('rcpt.yadere')} className="tabular">
                        {receipt.daySales != null
                          ? currency(Number(receipt.daySales))
                          : receipt.yadere != null
                            ? currency(Number(receipt.yadere))
                            : '—'}
                        {receipt.daySales != null ? (
                          <span className={styles.sub}>
                            {t('dlg.yadereAfter')}: {currency(Number(receipt.yadere ?? 0))}
                          </span>
                        ) : null}
                      </td>

                      <td data-label={t('rcpt.slip')}>
                        <button
                          type="button"
                          className={styles.thumb}
                          onClick={(event) => {
                            event.stopPropagation()
                            setDetailsOf(receipt)
                          }}
                          aria-label={t('a11y.viewSlip', { ref: receiptRef(receipt) })}
                        >
                          {!receipt.fileUrl ? (
                            <span className={styles.pdfTag}>—</span>
                          ) : isPdf(receipt) ? (
                            <span className={styles.pdfTag}>PDF</span>
                          ) : (
                            <AuthImg src={receipt.fileUrl} alt="" loading="lazy" />
                          )}
                        </button>
                      </td>

                      <td data-label={t('rcpt.reference')}>
                        {receipt.bankName ?? t('rcpt.creditedNoSlip')}
                        {receipt.notes ? (
                          <span className={styles.sub}>{receipt.notes}</span>
                        ) : null}
                      </td>

                      <td data-label={t('common.status')}>
                        <span
                          className={styles.status}
                          data-state={receipt.status}
                        >
                          {t(RECEIPT_STATUS_KEY[receipt.status])}
                        </span>
                      </td>

                      <td data-label={t('rcpt.verifiedBy')}>
                        {receipt.verifiedBy?.name ?? '–'}
                      </td>

                      <td
                        className={styles.actionsCol}
                        onClick={(event) => event.stopPropagation()}
                      >
                        <div className={rowStyles.actions}>
                              <button className={rowStyles.action}
                                type="button"
                                onClick={() => {
                                  setDetailsOf(receipt)
                                  setOpenMenu(null)
                                }}
                              >
                                {t('rcpt.viewSlip')}
                              </button>

                              {receipt.fileUrl ? (
                                <AuthLink
                                  href={receipt.fileUrl}
                                  download
                                  onClick={() => setOpenMenu(null)}
                                >
                                  {t('rcpt.download')}
                                </AuthLink>
                              ) : null}

                              {canVerify && receipt.status === 'PENDING' ? (
                                <>
                                  <button className={rowStyles.action}
                                    type="button"
                                    onClick={() => void verify(receipt)}
                                  >
                                    {t('rcpt.verify')}
                                  </button>
                                  <button
                                    type="button"
                                    className={rowStyles.danger}
                                    onClick={() => {
                                      setRejecting(receipt)
                                      setOpenMenu(null)
                                    }}
                                  >
                                    {t('rcpt.rejectAction')}
                                  </button>
                                </>
                              ) : null}

                              {/* The uploader changes a receipt only while the Owner
                                  has allowed it (24 hours); otherwise they ask. */}
                              {user?.role === 'OWNER' ||
                              (receipt.uploadedBy.id === user?.id &&
                                receipt.editAllowedUntil != null &&
                                new Date(receipt.editAllowedUntil) > new Date()) ? (
                                <button className={rowStyles.action}
                                  type="button"
                                  onClick={() => {
                                    setOpenMenu(null)
                                    setEditingReceipt(receipt)
                                  }}
                                >
                                  {t('load.edit')}
                                </button>
                              ) : receipt.uploadedBy.id === user?.id ? (
                                <button className={rowStyles.action}
                                  type="button"
                                  disabled={Boolean(receipt.editRequestedAt)}
                                  onClick={async () => {
                                    setOpenMenu(null)
                                    try {
                                      await api(`/api/receipts/${receipt.id}/request-edit`, { method: 'POST', body: {} })
                                      push('success', t('sales.requestSent'))
                                      setReloadKey((n) => n + 1)
                                    } catch (caught) {
                                      push('error', caught instanceof Error ? caught.message : 'Could not send it.')
                                    }
                                  }}
                                >
                                  {t(receipt.editRequestedAt ? 'sales.editRequested' : 'sales.requestEdit')}
                                </button>
                              ) : null}

                              {canDelete(receipt) ? (
                                <button
                                  type="button"
                                  className={rowStyles.danger}
                                  onClick={() => void remove(receipt)}
                                >
                                  {t('prod.delete')}
                                </button>
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
                Showing {(safePage - 1) * PAGE_SIZE + 1}–
                {Math.min(safePage * PAGE_SIZE, filtered.length)} of{' '}
                {count(filtered.length)} receipts
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

      {detailsOf ? (
        <ReceiptDetails
          receipt={detailsOf}
          onClose={() => setDetailsOf(null)}
        />
      ) : null}

      {rejecting ? (
        <RejectDialog
          title={t("rcpt.rejectTitle")}
          reference={receiptRef(rejecting)}
          what={t('rcpt.rejectWhat')}
          onClose={() => setRejecting(null)}
          onConfirm={(reason) => reject(rejecting, reason)}
        />
      ) : null}

      {uploading ? (
        <UploadReceiptDialog
          onClose={() => setUploading(false)}
          onDone={(message) => {
            setUploading(false)
            push('success', message)
            setReloadKey((n) => n + 1)
          }}
        />
      ) : null}
      {editingReceipt ? (
        <UploadReceiptDialog
          editing={editingReceipt}
          onClose={() => setEditingReceipt(null)}
          onDone={(message) => {
            setEditingReceipt(null)
            push('success', message)
            setReloadKey((n) => n + 1)
          }}
        />
      ) : null}
    </div>
  )
}

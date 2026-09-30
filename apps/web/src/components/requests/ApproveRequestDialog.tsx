import { useEffect, useMemo, useState, type FormEvent } from 'react'

import { api } from '../../lib/api'
import { useT } from '../../lib/i18n'
import { count } from '../../lib/format'
import { requestRef, requestUnitCount } from '../../lib/requests'
import type { BranchRow, InventoryBalance, StockRequest } from '../../lib/types'
import styles from '../inventory/Panel.module.css'

/**
 * Approving is not a single click: the reviewer decides how much of each line
 * to send (50 requested, 40 approved), and for a supervisor's request the API
 * also needs `sourceBranchId`, because several branches may hold main stock
 * and the Owner decides which one ships. Approval creates the transfer, so
 * neither choice can be deferred.
 */
export function ApproveRequestDialog({
  request,
  onClose,
  onDone,
}: {
  request: StockRequest
  onClose: () => void
  onDone: (message: string) => void
}) {
  const t = useT()

  // A salesperson's request is handed over inside the branch, so nothing
  // ships and there is no source to name.
  const needsSource = request.requestedBy.role !== 'SALES'

  // Items already approved or rejected one by one: only the approved ones are
  // sent, at the amount asked for, and none of it is edited here.
  const decided = request.items.some((item) => item.approvedQuantity !== null)
  const items = decided
    ? request.items.filter((item) => (item.approvedQuantity ?? 0) > 0)
    : request.items

  const [branches, setBranches] = useState<BranchRow[] | null>(null)
  const [sourceBranchId, setSourceBranchId] = useState('')
  // Restock from the main warehouse, or transfer from another branch.
  const [sourceMode, setSourceMode] = useState<'MAIN' | 'BRANCH'>('MAIN')
  const [note, setNote] = useState('')

  // Who is driving it over. Asked for here because the branch waiting for the
  // goods is told before the van leaves, not after it arrives.
  const [driverName, setDriverName] = useState('')
  const [driverPhone, setDriverPhone] = useState('')
  const [vehiclePlate, setVehiclePlate] = useState('')

  // Starts at what was asked for, so approving in full is still one click.
  const [quantities, setQuantities] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      request.items.map((item) => [item.id, String(item.quantity)]),
    ),
  )

  // Tagged with the branch it belongs to, so a slow answer for a branch the
  // Owner has since moved away from is never shown against the new one.
  const [stockOf, setStockOf] = useState<{
    branchId: string
    byProduct: Map<string, number>
  } | null>(null)

  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose()
    }

    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  useEffect(() => {
    if (!needsSource) return

    const controller = new AbortController()

    async function load() {
      try {
        const payload = await api<{ branches: BranchRow[] }>('/api/branches', {
          signal: controller.signal,
        })

        setBranches(payload.branches ?? [])
      } catch (caught) {
        if (controller.signal.aborted) return
        setError(
          caught instanceof Error ? caught.message : 'Could not load branches.',
        )
      }
    }

    void load()

    return () => controller.abort()
  }, [needsSource])

  // What the chosen branch holds, so the Owner can see why they might
  // approve less before the API refuses a shipment it cannot cover.
  useEffect(() => {
    if (sourceBranchId === '') return

    const controller = new AbortController()

    async function load() {
      try {
        const payload = await api<{ inventory: InventoryBalance[] }>(
          `/api/inventory?locationId=${encodeURIComponent(sourceBranchId)}`,
          { signal: controller.signal },
        )

        setStockOf({
          branchId: sourceBranchId,
          byProduct: new Map(
            (payload.inventory ?? []).map((row) => [row.productId, row.onShelf]),
          ),
        })
      } catch {
        // Stock figures are a guide only; the API still checks on submit.
      }
    }

    void load()

    return () => controller.abort()
  }, [sourceBranchId])

  // Restock ships from an active main warehouse; a transfer from any other
  // active branch. Never from the branch that raised the request.
  const sources = useMemo(
    () =>
      (branches ?? []).filter(
        (entry) =>
          entry.isActive &&
          entry.id !== request.requestedBy.branch?.id &&
          (sourceMode === 'MAIN' ? entry.isMainStock : !entry.isMainStock),
      ),
    [branches, request.requestedBy.branch?.id, sourceMode],
  )

  const sourceName = sources.find((entry) => entry.id === sourceBranchId)?.name
  const stock =
    stockOf !== null && stockOf.branchId === sourceBranchId
      ? stockOf.byProduct
      : null

  const lines = items.map((item) => {
    const raw = quantities[item.id] ?? ''
    const qty = Number(raw)
    const valid =
      raw.trim() !== '' && Number.isInteger(qty) && qty >= 0 && qty <= item.quantity
    const inStock = stock ? (stock.get(item.product.id) ?? 0) : null

    return {
      item,
      raw,
      qty: valid ? qty : 0,
      valid,
      inStock,
      overStock: valid && inStock !== null && qty > inStock,
    }
  })

  const requested = requestUnitCount(request)
  const approving = lines.reduce((sum, line) => sum + line.qty, 0)
  const allValid = lines.every((line) => line.valid)
  const anyOverStock = lines.some((line) => line.overStock)

  // Same rule the API applies, so the button disables rather than the request
  // failing.
  const phoneOk =
    /^[+()\d][\d\s()+-]*$/.test(driverPhone.trim()) &&
    driverPhone.trim().length >= 7

  const driverOk =
    !needsSource ||
    (driverName.trim().length >= 2 && phoneOk && vehiclePlate.trim().length >= 2)

  const canSubmit =
    !busy &&
    allValid &&
    approving > 0 &&
    !anyOverStock &&
    driverOk &&
    (!needsSource || sourceBranchId !== '')

  function setQuantity(itemId: string, value: string) {
    setQuantities((current) => ({ ...current, [itemId]: value }))
  }

  function fillFromStock() {
    if (!stock) return

    setQuantities(
      Object.fromEntries(
        request.items.map((item) => [
          item.id,
          String(Math.min(item.quantity, stock.get(item.product.id) ?? 0)),
        ]),
      ),
    )
  }

  function approveAll() {
    setQuantities(
      Object.fromEntries(
        request.items.map((item) => [item.id, String(item.quantity)]),
      ),
    )
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    if (!canSubmit) return

    setBusy(true)
    setError(null)

    try {
      await api(`/api/requests/${request.id}/approve`, {
        method: 'PATCH',
        body: {
          ...(needsSource
            ? {
                sourceBranchId,
                driverName: driverName.trim(),
                driverPhone: driverPhone.trim(),
                vehiclePlate: vehiclePlate.trim(),
              }
            : {}),
          ...(note.trim() ? { notes: note.trim() } : {}),
          // Decided one by one: the server sends what was approved.
          ...(decided
            ? {}
            : {
                items: lines.map((line) => ({
                  itemId: line.item.id,
                  approvedQuantity: line.qty,
                })),
              }),
        },
      })

      const vars = {
        ref: requestRef(request),
        from: sourceName ?? t('done.sourceBranch'),
        approved: count(approving),
        requested: count(requested),
      }

      const partial = approving < requested

      onDone(
        needsSource
          ? t(partial ? 'done.requestApprovedPartial' : 'done.requestApproved', vars)
          : t(partial ? 'done.requestApprovedPartialLocal' : 'done.requestApprovedLocal', vars),
      )
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : 'Could not approve the request.',
      )
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className={styles.scrim} onClick={onClose}>
      <aside
        className={styles.panel}
        role="dialog"
        aria-modal="true"
        aria-label={t('a11y.approveRef', { ref: requestRef(request) })}
        onClick={(event) => event.stopPropagation()}
      >
        <header className={styles.head}>
          <div>
            <h2>{t(decided ? 'dlg.sendApproved' : 'dlg.approveRequest')}</h2>
            <p className="tabular">{requestRef(request)}</p>
          </div>
          <button type="button" onClick={onClose} aria-label={t('common.close')}>
            ✕
          </button>
        </header>

        <form className={styles.body} onSubmit={handleSubmit}>
          <p className={styles.warn}>
            {t(decided ? 'dlg.sendIntro' : 'dlg.approveIntro', {
              branch: request.requestedBy.branch?.name ?? t('req.unknownBranch'),
              units: count(decided ? lines.reduce((sum, line) => sum + line.qty, 0) : requested),
            })}
          </p>

          {needsSource ? (
            <>
              <label className={styles.field}>
                <span>{t('dlg.sendHow')}</span>
                <select
                  value={sourceMode}
                  onChange={(event) => {
                    setSourceMode(event.target.value as 'MAIN' | 'BRANCH')
                    setSourceBranchId('')
                  }}
                >
                  <option value="MAIN">{t('dlg.fromMain')}</option>
                  <option value="BRANCH">{t('dlg.fromBranch')}</option>
                </select>
              </label>

              <label className={styles.field}>
                <span>
                  {t('dlg.shipFrom')}<em>{t('common.required')}</em>
                </span>
                <select
                  value={sourceBranchId}
                  onChange={(event) => setSourceBranchId(event.target.value)}
                  required
                >
                  <option value="">{t('dlg.selectSource')}</option>
                  {sources.map((entry) => (
                    <option key={entry.id} value={entry.id}>
                      {entry.name}
                    </option>
                  ))}
                </select>
              </label>

              {branches !== null && sources.length === 0 ? (
                <p className={styles.blocked}>{t('dlg.noSource')}</p>
              ) : null}
            </>
          ) : null}

          {lines.map((line) => (
            <div key={line.item.id} className={styles.approveLine}>
              {/* Decided item by item: the amount is fixed. */}
              <div className={styles.approveProduct}>
                <strong>{line.item.product.name}</strong>
                <em className={styles.sub}>
                  {line.item.product.sku} ·{' '}
                  {t('dlg.requestedN', { n: count(line.item.quantity) })}
                </em>
              </div>

              <label className={styles.qtyField}>
                <span>{t('dlg.approveQty')}</span>
                <input
                  type="number"
                  inputMode="numeric"
                  min="0"
                  max={line.item.quantity}
                  step="1"
                  value={line.raw}
                  onChange={(event) =>
                    setQuantity(line.item.id, event.target.value)
                  }
                  aria-label={t('dlg.approveQtyFor', {
                    product: line.item.product.name,
                  })}
                  readOnly={decided}
                  required
                />
              </label>

              {!line.valid ? (
                <p className={styles.lineWarn}>
                  {t('dlg.approveRange', { n: count(line.item.quantity) })}
                </p>
              ) : line.overStock ? (
                <p className={styles.lineWarn}>
                  {t('dlg.onlyInStockAt', {
                    n: count(line.inStock ?? 0),
                    branch: sourceName ?? '',
                  })}
                </p>
              ) : line.inStock !== null ? (
                <p className={styles.lineNote}>
                  {t('dlg.inStockAt', {
                    n: count(line.inStock),
                    branch: sourceName ?? '',
                  })}
                </p>
              ) : null}
            </div>
          ))}

          {!decided ? (
            <div className={styles.approveShortcuts}>
              {stock ? (
                <button type="button" className={styles.addLine} onClick={fillFromStock}>
                  {t('dlg.matchStock')}
                </button>
              ) : null}
              {approving !== requested ? (
                <button type="button" className={styles.addLine} onClick={approveAll}>
                  {t('dlg.approveAll')}
                </button>
              ) : null}
            </div>
          ) : null}

          <div className={styles.saleTotal}>
            <span>{t('dlg.approvingLabel')}</span>
            <strong className="tabular">
              {t('dlg.approvingOf', {
                approved: count(approving),
                requested: count(requested),
              })}
            </strong>
          </div>

          {allValid && approving === 0 ? (
            <p className={styles.blocked}>{t('dlg.nothingApproved')}</p>
          ) : null}

          {needsSource ? (
            <section className={styles.gridGroup}>
              <h3 className={styles.gridHead}>{t('dlg.driver')}</h3>

              <div className={styles.driverFields}>
                <label className={styles.field}>
                  <span>
                    {t('dlg.driverName')}<em>{t('common.required')}</em>
                  </span>
                  <input
                    value={driverName}
                    onChange={(event) => setDriverName(event.target.value)}
                    maxLength={120}
                    placeholder={t('dlg.phDriverName')}
                    required
                  />
                </label>

                <label className={styles.field}>
                  <span>
                    {t('dlg.driverPhone')}<em>{t('common.required')}</em>
                  </span>
                  <input
                    type="tel"
                    inputMode="tel"
                    value={driverPhone}
                    onChange={(event) => setDriverPhone(event.target.value)}
                    maxLength={24}
                    placeholder="0911 111 111"
                    required
                  />
                </label>

                <label className={styles.field}>
                  <span>
                    {t('dlg.vehiclePlate')}<em>{t('common.required')}</em>
                  </span>
                  <input
                    value={vehiclePlate}
                    onChange={(event) => setVehiclePlate(event.target.value)}
                    maxLength={40}
                    placeholder={t('dlg.phPlate')}
                    required
                  />
                </label>
              </div>

              {driverPhone.trim() !== '' && !phoneOk ? (
                <p className={styles.lineWarn}>{t('dlg.phoneInvalid')}</p>
              ) : null}
            </section>
          ) : null}

          <label className={styles.field}>
            <span>{t('dlg.note')}</span>
            <input
              value={note}
              onChange={(event) => setNote(event.target.value)}
              maxLength={500}
              placeholder={
                approving < requested
                  ? t('dlg.phPartialNote')
                  : t('dlg.phApproveNote')
              }
            />
          </label>

          {error ? <p className={styles.error}>{error}</p> : null}

          <div className={styles.actions}>
            <button type="button" className={styles.cancel} onClick={onClose}>
              {t('common.cancel')}
            </button>
            <button type="submit" className={styles.submit} disabled={!canSubmit}>
              {busy
                ? t('dlg.approving')
                : needsSource
                  ? t('dlg.approveAndTransfer')
                  : t('appr.approve')}
            </button>
          </div>
        </form>
      </aside>
    </div>
  )
}

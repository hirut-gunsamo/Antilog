import { useEffect, useMemo, useState, type FormEvent } from 'react'

import { api } from '../../lib/api'
import { sendOrQueue } from '../../lib/sync'
import { BANKS } from '../../lib/banks'
import { useCategories } from '../../lib/categories'
import { useT, type TranslationKey } from '../../lib/i18n'
import { count, currency } from '../../lib/format'
import { saleRef } from '../../lib/sales'
import { useSettings } from '../../lib/settings'
import type { InventoryProduct, InventorySummary, Sale, StockRequest } from '../../lib/types'
import styles from '../inventory/Panel.module.css'

// Which categories the API requires one serial per unit for. A voucher line
// must NOT send serials at all, so it is left out of this map entirely.
const SERIAL_HINT: Record<string, TranslationKey> = {
  PHONE: 'sale.serialsImei',
}

type SaleOption = {
  id: string
  name: string
  sku: string
  category: string
  categoryId: string
  /** The Owner's top-level type: a phone's brand, a SIM or airtime type. */
  typeId: string
  typeName: string
  /** What the list shows: "Voucher-10" for airtime, else the name. */
  label: string
  price: number
  qty: number
}

function saleOption(product: InventoryProduct, qty: number): SaleOption {
  return {
    id: product.id,
    name: product.name,
    sku: product.sku,
    category: product.category,
    categoryId: product.categoryId ?? '',
    typeId: product.type?.parent?.id ?? product.type?.parentId ?? product.type?.id ?? '',
    typeName: product.type?.parent?.name ?? product.type?.name ?? '—',
    label: product.voucherDetails
      ? `${product.type?.name ?? 'Voucher'}-${Number(product.voucherDetails.denomination)}`
      : product.name,
    price: Number(product.price ?? 0),
    qty,
  }
}

// Same parsing StockInDialog used before its serial box was removed: split on
// newline and comma, trim, drop empties.
function parseSerials(raw: string): string[] {
  return raw
    .split(/[\n,]/)
    .map((line) => line.trim())
    .filter(Boolean)
}

/**
 * Records a sale against the salesperson's own branch.
 *
 * Prices are never sent: the API takes them from the product catalogue so a
 * sale cannot be under-reported. The total shown here is therefore a preview
 * of what the server will calculate, not an input to it.
 */
export function NewSaleDialog({
  onClose,
  onDone,
  editing,
}: {
  onClose: () => void
  onDone: (message: string) => void
  /** A sale being corrected: the form opens filled in with it. */
  editing?: Sale
}) {
  const [stock, setStock] = useState<InventorySummary | null>(null)
  const t = useT()
  // How many of each held product is being sold, and a phone's IMEIs.
  const [grid, setGrid] = useState<Record<string, string>>(() => {
    if (!editing) return {}
    const out: Record<string, string> = {}
    for (const item of editing.items) out[item.product.id] = String(Number(out[item.product.id] ?? 0) + item.quantity)
    return out
  })
  const [serialsBy, setSerialsBy] = useState<Record<string, string>>(() => {
    if (!editing) return {}
    const out: Record<string, string> = {}
    for (const item of editing.items) {
      const imeis = item.inventoryUnits.map((unit) => unit.imei).filter(Boolean)
      if (imeis.length > 0) out[item.product.id] = [...(out[item.product.id]?.split('\n') ?? []), ...imeis].filter(Boolean).join('\n')
    }
    return out
  })
  const [cash, setCash] = useState(() =>
    !editing
      ? ''
      : editing.paymentMethod === 'TRANSFER'
        ? String(Number(editing.transferReceived))
        : String(Number(editing.cashReceived)),
  )
  const [method, setMethod] = useState<'CASH' | 'TRANSFER' | 'MIXED'>(editing?.paymentMethod ?? 'CASH')
  // Cash + Transfer: `cash` is the cash part, this the part sent to the bank.
  const [transferPart, setTransferPart] = useState(
    editing?.paymentMethod === 'MIXED' ? String(Number(editing.transferReceived)) : '',
  )
  const [bank, setBank] = useState(editing?.bankName ?? '')
  // Offline, the built-in list still lets a transfer sale be recorded.
  const [banks, setBanks] = useState<string[]>([...BANKS])
  const [newBank, setNewBank] = useState<string | null>(null)
  const [bankBusy, setBankBusy] = useState(false)

  useEffect(() => {
    const controller = new AbortController()
    api<{ banks: { id: string; name: string }[] }>('/api/banks', { signal: controller.signal })
      .then((payload) => {
        if (payload.banks?.length) setBanks(payload.banks.map((row) => row.name))
      })
      .catch(() => undefined)
    return () => controller.abort()
  }, [])

  async function addBank() {
    const name = (newBank ?? '').trim()
    if (name.length < 2 || bankBusy) return
    setBankBusy(true)
    setError(null)
    try {
      const payload = await api<{ bank: { name: string } }>('/api/banks', {
        method: 'POST',
        body: { name },
      })
      const added = payload.bank.name
      setBanks((current) => (current.includes(added) ? current : [...current, added]))
      setBank(added)
      setNewBank(null)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not add the bank.')
    } finally {
      setBankBusy(false)
    }
  }
  const [note, setNote] = useState(editing?.notes ?? '')
  // SIM transfers: a number moved to a new owner, at the Owner's fixed price.
  // A service, so it is always offered, held stock or not.
  const { settings } = useSettings()
  const transferPrice = Number(settings.simTransferPrice ?? 0)
  // Only how many: the transfer details are kept in Ethio telecom's system.
  const [transferCount, setTransferCount] = useState(() => {
    const done = (editing?.simTransfers ?? []).reduce((sum, row) => sum + (row.quantity ?? 1), 0)
    return done > 0 ? String(done) : ''
  })
  const transfers = transferCount.trim() === '' ? 0 : Number(transferCount)
  const transfersValid = Number.isInteger(transfers) && transfers >= 0 && transfers <= 10_000

  // Bills the customer pays here (WiFi, electricity, water...), at what they paid.
  const [bills, setBills] = useState<{ type: string; account: string; amount: string }[]>(() =>
    (editing?.billPayments ?? []).map((bill) => ({
      type: bill.billType,
      account: bill.account ?? '',
      amount: String(Number(bill.amount)),
    })),
  )
  const billLines = bills.filter((bill) => bill.type.trim() !== '' || bill.amount.trim() !== '')
  const billsValid = billLines.every((bill) => bill.type.trim() !== '' && Number(bill.amount) > 0)
  const billsTotal = billsValid ? billLines.reduce((sum, bill) => sum + Number(bill.amount), 0) : 0

  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Goods the supervisor handed over that this salesperson has not pressed
  // Received for: they cannot be sold until then, so the form offers it.
  const [toReceive, setToReceive] = useState<StockRequest[]>([])
  const [receiving, setReceiving] = useState(false)
  const [loadKey, setLoadKey] = useState(0)

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose()
    }

    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  useEffect(() => {
    const controller = new AbortController()

    async function load() {
      try {
        // The summary is already branch-scoped, so it doubles as the list of
        // what this salesperson can actually sell.
        // Only what was issued to this salesperson can be sold.
        const [payload, requestRes] = await Promise.all([
          api<{ summary: InventorySummary }>('/api/inventory/summary?mine=1', {
            signal: controller.signal,
          }),
          api<{ requests: StockRequest[] }>('/api/requests', {
            signal: controller.signal,
          }).catch(() => ({ requests: [] as StockRequest[] })),
        ])

        setStock(payload.summary)
        setToReceive(
          (requestRes.requests ?? []).filter(
            (request) =>
              request.kind === 'ISSUE' &&
              (request.status === 'APPROVED' || request.status === 'PENDING') &&
              request.items.some((item) => (item.approvedQuantity ?? 0) > 0 && !item.receivedAt),
          ),
        )
      } catch (caught) {
        if (controller.signal.aborted) return
        setError(
          caught instanceof Error ? caught.message : 'Could not load stock.',
        )
      }
    }

    void load()

    return () => controller.abort()
  }, [loadKey])

  // Receives every handed-over request at once, then reloads what can be sold.
  async function receiveAll() {
    setReceiving(true)
    setError(null)
    try {
      for (const request of toReceive) {
        await api(`/api/requests/${request.id}/receive`, { method: 'PATCH', body: {} })
      }
      setLoadKey((n) => n + 1)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not receive them.')
    } finally {
      setReceiving(false)
    }
  }

  // One entry per product, carrying what is on the shelf and its price.
  const available = useMemo(() => {
    const byProduct = new Map<string, SaleOption>()

    for (const row of stock?.items ?? []) {
      const found = byProduct.get(row.productId)

      if (found) found.qty += row.quantity
      else byProduct.set(row.productId, saleOption({ ...row.product, id: row.productId }, row.quantity))
    }

    // Correcting a sale: what it already took counts as held again, since it
    // goes back before the corrected sale is taken out.
    for (const item of editing?.items ?? []) {
      const found = byProduct.get(item.product.id)
      if (found) {
        found.qty += item.quantity
        // It keeps the price it was sold at.
        found.price = Number(item.unitPrice)
      } else
        byProduct.set(item.product.id, {
          id: item.product.id,
          name: item.product.name,
          sku: item.product.sku,
          category: item.product.category,
          categoryId: '',
          typeId: '',
          typeName: '—',
          label: item.product.name,
          price: Number(item.unitPrice),
          qty: item.quantity,
        })
    }

    return [...byProduct.values()].filter((entry) => entry.qty > 0)
  }, [stock, editing])

  // What this person holds, grouped under the Owner's categories in the
  // Owner's order; anything without a known category goes last.
  const { categories } = useCategories()
  const groups = useMemo(() => {
    const sorted = [...available].sort((a, b) =>
      a.label.localeCompare(b.label, undefined, { numeric: true }),
    )
    const known = categories
      .map((entry) => ({
        id: entry.id,
        name: entry.name,
        items: sorted.filter((product) => product.categoryId === entry.id),
      }))
      .filter((group) => group.items.length > 0)
    const placed = new Set(known.flatMap((group) => group.items.map((item) => item.id)))
    const rest = sorted.filter((product) => !placed.has(product.id))
    return rest.length > 0
      ? [...known, { id: 'other', name: t('inv.otherItems'), items: rest }]
      : known
  }, [available, categories, t])

  // Every held product is a row; a blank box means none of it in this sale.
  const rows = available.map((product) => {
    const raw = grid[product.id] ?? ''
    const qty = Number(raw)
    const blank = raw.trim() === '' || qty === 0
    const valid = raw.trim() === '' || (Number.isInteger(qty) && qty >= 0)

    // Only phones are handed over as a specific unit; nothing else may send
    // serials, or the API refuses it.
    const hintKey = SERIAL_HINT[product.category]
    const needsSerials = hintKey != null && !blank
    const serialList = needsSerials ? parseSerials(serialsBy[product.id] ?? '') : []
    const serialsMatch = !needsSerials || (valid && serialList.length === qty)

    return {
      product,
      raw,
      qty: blank ? 0 : qty,
      blank,
      valid,
      overStock: valid && !blank && qty > product.qty,
      total: valid && !blank ? product.price * qty : 0,
      needsSerials,
      hintKey,
      serialList,
      serialsMatch,
    }
  })
  const priced = rows.filter((row) => !row.blank)
  const rowOf = new Map(rows.map((row) => [row.product.id, row]))

  // The API checks for a repeated serial across the WHOLE request, not per
  // line, so a serial re-typed on a second line must be caught here too.
  const duplicateSerials = new Set<string>()
  {
    const seen = new Set<string>()
    for (const line of priced) {
      for (const value of line.serialList) {
        if (seen.has(value)) duplicateSerials.add(value)
        seen.add(value)
      }
    }
  }

  const total =
    priced.reduce((sum, line) => sum + line.total, 0) + (transfersValid ? transfers : 0) * transferPrice + billsTotal
  const anyOverStock = priced.some((line) => line.overStock)
  const allValid =
    rows.every((line) => line.valid) && transfersValid && billsValid && priced.length + transfers + billLines.length > 0
  const allSerialsMatch = priced.every((line) => line.serialsMatch)
  const transferValue = Number(transferPart)
  // Cash + Transfer: only the transferred amount is typed; the rest of the
  // total is the cash part.
  const cashValue = method === 'MIXED' ? Math.max(0, Math.round((total - transferValue) * 100) / 100) : Number(cash)
  const cashValid =
    method === 'MIXED'
      ? transferPart.trim() !== '' && transferValue > 0 && transferValue < total
      : cash.trim() !== '' && cashValue >= 0
  // What the customer handed over in all, however it was split.
  const paidValue = method === 'MIXED' ? cashValue + transferValue : cashValue

  const canSubmit =
    !busy &&
    allValid &&
    !anyOverStock &&
    cashValid &&
    (method === 'CASH' || bank !== '') &&
    allSerialsMatch &&
    duplicateSerials.size === 0

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    if (!canSubmit) return

    setBusy(true)
    setError(null)

    try {
      // A shop that loses its connection mid-sale must still be able to
      // serve the customer: the sale is kept on the device and sent when the
      // connection returns, carrying an id so it cannot be recorded twice.
      const body = {
        items: priced.map((line) => ({
          productId: line.product.id,
          quantity: line.qty,
          ...(line.needsSerials ? { serials: line.serialList } : {}),
        })),
        simTransferCount: transfersValid ? transfers : 0,
        bills: billLines.map((bill) => ({
          type: bill.type.trim(),
          amount: Number(bill.amount),
          ...(bill.account.trim() ? { account: bill.account.trim() } : {}),
        })),
        cashReceived: cashValue,
        paymentMethod: method,
        ...(method !== 'CASH' ? { bankName: bank } : {}),
        ...(method === 'MIXED' ? { transferReceived: transferValue } : {}),
        ...(note.trim() ? { customerNote: note.trim() } : {}),
      }

      // A correction goes straight to the server: it has to see the sale as
      // it stands now.
      if (editing) {
        await api(`/api/sales/${editing.id}`, { method: 'PUT', body })
        onDone(t('done.saleUpdated', { amount: currency(total) }))
        return
      }

      const sent = await sendOrQueue({
        method: 'POST',
        path: '/api/sales',
        labelKey: 'sync.saleOffline',
        entity: 'sales',
        body,
      })

      onDone(
        sent === null
          ? t('sync.savedOffline')
          : t('done.saleRecorded', { amount: currency(total) }),
      )
    } catch (caught) {
      // The server counts what this person holds right now; reload it so the
      // form shows the same numbers and marks the line that is too high.
      setLoadKey((n) => n + 1)
      setError(
        caught instanceof Error ? caught.message : 'Could not record the sale.',
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
        aria-label={t(editing ? 'dlg.editSale' : 'dlg.newSale')}
        onClick={(event) => event.stopPropagation()}
      >
        <header className={styles.head}>
          <div>
            <h2>{editing ? `${t('dlg.editSale')} · ${saleRef(editing)}` : t('dlg.newSale')}</h2>
            <p>{t(editing ? 'dlg.editSaleNote' : 'dlg.newSaleNote')}</p>
          </div>
          <button type="button" onClick={onClose} aria-label={t('common.close')}>
            ✕
          </button>
        </header>

        <form className={styles.body} onSubmit={handleSubmit}>
          {toReceive.length > 0 ? (
            <div className={styles.receiveBox}>
              <p>
                <strong>{t('sale.toReceiveTitle')}</strong>
                {t('sale.toReceiveNote')}
              </p>
              <ul>
                {toReceive.flatMap((request) =>
                  request.items
                    .filter((item) => (item.approvedQuantity ?? 0) > 0 && !item.receivedAt)
                    .map((item) => (
                      <li key={item.id}>
                        {item.product.name} × {count(item.approvedQuantity ?? 0)}
                      </li>
                    )),
                )}
              </ul>
              <button type="button" className={styles.submit} disabled={receiving} onClick={() => void receiveAll()}>
                {receiving ? t('common.saving') : t('sale.receiveNow')}
              </button>
            </div>
          ) : null}

          {/* SIM transfer comes first: a service, always offered. */}
          <label className={styles.field}>
            <span>
              {t('st.title')} · {currency(transferPrice)} {t('st.perTransfer')}
            </span>
            <input
              type="number"
              inputMode="numeric"
              min={0}
              step={1}
              value={transferCount}
              onChange={(event) => setTransferCount(event.target.value)}
              placeholder="0"
            />
            {transfers > 0 && transfersValid ? (
              <small className="tabular">
                {transfers} × {currency(transferPrice)} = {currency(transfers * transferPrice)}
              </small>
            ) : null}
          </label>

          {/* Bills paid here: WiFi, electricity, water or any other. */}
          <details className={styles.gridGroup} open={bills.length > 0}>
            <summary className={styles.gridHead}>
              {t('bill.title')}
              {billsTotal > 0 ? ` · ${currency(billsTotal)}` : ''}
            </summary>
            <datalist id="bill-types">
              <option value="WiFi" />
              <option value="Electricity" />
              <option value="Water" />
              <option value="DSTV" />
            </datalist>
            {bills.map((bill, index) => (
              <div key={index} className={styles.billRow}>
                <input
                  list="bill-types"
                  value={bill.type}
                  onChange={(event) =>
                    setBills((list) => list.map((row, at) => (at === index ? { ...row, type: event.target.value } : row)))
                  }
                  placeholder={t('bill.type')}
                  aria-label={t('bill.type')}
                />
                <input
                  value={bill.account}
                  onChange={(event) =>
                    setBills((list) => list.map((row, at) => (at === index ? { ...row, account: event.target.value } : row)))
                  }
                  placeholder={t('bill.account')}
                  aria-label={t('bill.account')}
                />
                <input
                  type="number"
                  inputMode="decimal"
                  min={0}
                  step="any"
                  value={bill.amount}
                  onChange={(event) =>
                    setBills((list) => list.map((row, at) => (at === index ? { ...row, amount: event.target.value } : row)))
                  }
                  placeholder={t('bill.amount')}
                  aria-label={t('bill.amount')}
                />
                <button
                  type="button"
                  className={styles.removeLine}
                  onClick={() => setBills((list) => list.filter((_, at) => at !== index))}
                  aria-label={t('bill.remove')}
                >
                  ✕
                </button>
              </div>
            ))}
            <button
              type="button"
              className={styles.addLine}
              onClick={() => setBills((list) => [...list, { type: '', account: '', amount: '' }])}
            >
              + {t('bill.add')}
            </button>
          </details>

          {stock && available.length === 0 ? (
            <p className={styles.none}>{t('sale.nothingHeld')}</p>
          ) : null}

          {groups.map((group) => (
            // Each category folds open and shut, so a long list stays short.
            <details key={group.id} className={styles.gridGroup} open>
              <summary className={styles.gridHead}>{group.name}</summary>

              {group.items.map((product) => {
                const line = rowOf.get(product.id)!
                return (
                  <div key={product.id} style={{ background: 'var(--surface)' }}>
                    <label className={styles.gridRow}>
                      <span className={styles.gridName}>
                        {product.label}
                        <em className={styles.sub}>
                          {t('dlg.youHold', { n: count(product.qty) })} · {currency(product.price)}
                        </em>
                      </span>
                      <input
                        type="number"
                        inputMode="numeric"
                        min="0"
                        max={product.qty}
                        step="1"
                        value={line.raw}
                        onChange={(event) =>
                          setGrid((current) => ({ ...current, [product.id]: event.target.value }))
                        }
                        placeholder="0"
                        aria-label={product.label}
                        data-bad={!line.valid || line.overStock ? '' : undefined}
                      />
                    </label>

                    {line.overStock ? (
                      <p className={styles.lineWarn} style={{ padding: '0 12px 8px' }}>
                        {t('dlg.onlyInStock', { n: count(product.qty) })}
                      </p>
                    ) : null}

                    {line.needsSerials && line.hintKey ? (
                      <label className={styles.field} style={{ padding: '0 12px 12px' }}>
                        <span>
                          {t('sale.serials')}
                          <em>{t(line.hintKey)}</em>
                        </span>
                        <textarea
                          rows={Math.min(Math.max(line.qty, 2), 6)}
                          value={serialsBy[product.id] ?? ''}
                          onChange={(event) =>
                            setSerialsBy((current) => ({ ...current, [product.id]: event.target.value }))
                          }
                          placeholder={`356938035643809\n356938035643817`}
                          spellCheck={false}
                        />
                        <p
                          className={styles.tally}
                          data-bad={
                            (!line.serialsMatch ||
                              line.serialList.some((value) => duplicateSerials.has(value))) &&
                            line.serialList.length > 0
                              ? ''
                              : undefined
                          }
                        >
                          {t('sale.serialsCount', {
                            entered: line.serialList.length,
                            needed: line.qty || 0,
                          })}
                        </p>
                      </label>
                    ) : null}
                  </div>
                )
              })}
            </details>
          ))}

          {duplicateSerials.size > 0 ? (
            <p className={styles.error}>
              {t('sale.duplicateSerial', {
                list: [...duplicateSerials].slice(0, 3).join(', '),
              })}
            </p>
          ) : null}

          <div className={styles.saleTotal}>
            <span>{t('dlg.total')}</span>
            <strong className="tabular">{currency(total)}</strong>
          </div>

          {/* How the customer paid. A transfer names the bank it went to. */}
          <div className={styles.field}>
            <span>
              {t('pay.method')}<em>{t('common.required')}</em>
            </span>
            <div className={styles.lineGrid} style={{ gridTemplateColumns: 'repeat(3, minmax(0, 1fr))' }}>
              {(['CASH', 'TRANSFER', 'MIXED'] as const).map((option) => (
                <button
                  key={option}
                  type="button"
                  className={method === option ? styles.submit : styles.cancel}
                  aria-pressed={method === option}
                  onClick={() => setMethod(option)}
                >
                  {t(option === 'CASH' ? 'pay.cash' : option === 'TRANSFER' ? 'pay.transfer' : 'pay.mixed')}
                </button>
              ))}
            </div>
          </div>

          {method !== 'CASH' ? (
            <label className={styles.field}>
              <span>
                {t('pay.bank')}<em>{t('common.required')}</em>
              </span>
              <select value={bank} onChange={(event) => setBank(event.target.value)} required>
                <option value="">{t('pay.chooseBank')}</option>
                {banks.map((name) => (
                  <option key={name} value={name}>
                    {name}
                  </option>
                ))}
              </select>
            </label>
          ) : null}

          {method !== 'CASH' ? (
            newBank === null ? (
              <button type="button" className={styles.addLine} onClick={() => setNewBank('')}>
                {t('pay.addBank')}
              </button>
            ) : (
              <div className={styles.lineGrid} style={{ gridTemplateColumns: 'minmax(0, 1fr) auto auto' }}>
                <input
                  value={newBank}
                  onChange={(event) => setNewBank(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      event.preventDefault()
                      void addBank()
                    }
                  }}
                  placeholder={t('pay.bankName')}
                  maxLength={80}
                  aria-label={t('pay.bankName')}
                  autoFocus
                />
                <button
                  type="button"
                  className={styles.submit}
                  onClick={() => void addBank()}
                  disabled={bankBusy || newBank.trim().length < 2}
                >
                  {t('pay.add')}
                </button>
                <button type="button" className={styles.cancel} onClick={() => setNewBank(null)}>
                  {t('common.cancel')}
                </button>
              </div>
            )
          ) : null}

          {method === 'MIXED' ? (
            <>
              <label className={styles.field}>
                <span>
                  {t('pay.transferPart')}<em>{t('common.required')}</em>
                </span>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={transferPart}
                  onChange={(event) => setTransferPart(event.target.value)}
                  required
                />
              </label>

              {/* The rest is cash, filled in from the total: shown in a box like
                  the others, but not one that can be typed in. */}
              <label className={styles.field}>
                <span>{t('pay.cashPart')}</span>
                <input
                  type="text"
                  value={currency(cashValue)}
                  readOnly
                  disabled
                  tabIndex={-1}
                  aria-readonly="true"
                />
              </label>

              {/* Cash part + transfer part: the sale's total, as a plain line. */}
              <p className={styles.mixedTotal}>
                <span>{t('dlg.total')}</span>
                <strong className="tabular">{currency(total)}</strong>
              </p>

              {transferPart.trim() !== '' && transferValue >= total && total > 0 ? (
                <p className={styles.tally} data-bad="">
                  {t('pay.transferTooMuch')}
                </p>
              ) : null}
            </>
          ) : (
            <label className={styles.field}>
              <span>
                {t(method === 'CASH' ? 'dlg.cashReceived' : 'pay.transferReceived')}
                <em>{t('common.required')}</em>
              </span>
              <input
                type="number"
                min="0"
                step="0.01"
                value={cash}
                onChange={(event) => setCash(event.target.value)}
                placeholder={String(total || '')}
                required
              />
            </label>
          )}

          {cashValid && paidValue < total ? (
            <p className={styles.tally} data-bad="">
              {t('dlg.shortBy', { amount: currency(total - paidValue) })}
            </p>
          ) : null}

          <label className={styles.field}>
            <span>
              {t('dlg.note')}<em>{t('prod.optional')}</em>
            </span>
            <input
              value={note}
              onChange={(event) => setNote(event.target.value)}
              maxLength={500}
              placeholder={t('dlg.phSaleNote')}
            />
          </label>

          {error ? <p className={styles.error}>{error}</p> : null}

          <div className={styles.actions}>
            <button type="button" className={styles.cancel} onClick={onClose}>
              {t('common.cancel')}
            </button>
            <button
              type="submit"
              className={styles.submit}
              disabled={!canSubmit}
            >
              {busy ? t('common.saving') : t(editing ? 'dlg.saveChanges' : 'dlg.recordSale')}
            </button>
          </div>
        </form>
      </aside>
    </div>
  )
}

import { useEffect, useMemo, useState, type FormEvent } from 'react'

import { api } from '../../lib/api'
import { sendOrQueue } from '../../lib/sync'
import { BANKS } from '../../lib/banks'
import { useCategories } from '../../lib/categories'
import { useT, type TranslationKey } from '../../lib/i18n'
import { count, currency } from '../../lib/format'
import type { InventorySummary } from '../../lib/types'
import styles from '../inventory/Panel.module.css'

type Line = { categoryId: string; typeId: string; productId: string; quantity: string; serials: string }

// Which categories the API requires one serial per unit for. A voucher line
// must NOT send serials at all, so it is left out of this map entirely.
const SERIAL_HINT: Record<string, TranslationKey> = {
  SIM_CARD: 'sale.serialsIccid',
  PHONE: 'sale.serialsImei',
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
}: {
  onClose: () => void
  onDone: (message: string) => void
}) {
  const [stock, setStock] = useState<InventorySummary | null>(null)
  const t = useT()
  const [lines, setLines] = useState<Line[]>([
    { categoryId: '', typeId: '', productId: '', quantity: '1', serials: '' },
  ])
  const [cash, setCash] = useState('')
  const [method, setMethod] = useState<'CASH' | 'TRANSFER'>('CASH')
  const [bank, setBank] = useState('')
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
  const [note, setNote] = useState('')

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
    const controller = new AbortController()

    async function load() {
      try {
        // The summary is already branch-scoped, so it doubles as the list of
        // what this salesperson can actually sell.
        // Only what was issued to this salesperson can be sold.
        const payload = await api<{ summary: InventorySummary }>(
          '/api/inventory/summary?mine=1',
          { signal: controller.signal },
        )

        setStock(payload.summary)
      } catch (caught) {
        if (controller.signal.aborted) return
        setError(
          caught instanceof Error ? caught.message : 'Could not load stock.',
        )
      }
    }

    void load()

    return () => controller.abort()
  }, [])

  // One entry per product, carrying what is on the shelf and its price.
  const available = useMemo(() => {
    const byProduct = new Map<
      string,
      {
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
    >()

    for (const row of stock?.items ?? []) {
      const found = byProduct.get(row.productId)

      if (found) found.qty += row.quantity
      else
        byProduct.set(row.productId, {
          id: row.productId,
          name: row.product.name,
          sku: row.product.sku,
          category: row.product.category,
          categoryId: row.product.categoryId ?? '',
          typeId: row.product.type?.parent?.id ?? row.product.type?.id ?? '',
          typeName: row.product.type?.parent?.name ?? row.product.type?.name ?? '—',
          label: row.product.voucherDetails
            ? `${row.product.type?.name ?? 'Voucher'}-${Number(row.product.voucherDetails.denomination)}`
            : row.product.name,
          price: Number(row.product.price ?? 0),
          qty: row.quantity,
        })
    }

    return [...byProduct.values()]
      .filter((entry) => entry.qty > 0)
      // Numbers in order: Voucher-10, -15, -25, -50, -100.
      .sort((a, b) => a.label.localeCompare(b.label, undefined, { numeric: true }))
  }, [stock])

  // Categories the salesperson has something in, in the Owner's order.
  const { categories } = useCategories()
  const saleCategories = categories.filter((entry) =>
    available.some((product) => product.categoryId === entry.id),
  )

  const priced = lines.map((line) => {
    const product = available.find((entry) => entry.id === line.productId)
    const qty = Number(line.quantity)
    const valid = product != null && Number.isInteger(qty) && qty > 0

    // Only SIM cards and phones are handed over as a specific physical unit;
    // a voucher line must not send serials at all, or the API refuses it.
    const hintKey = product ? SERIAL_HINT[product.category] : undefined
    const needsSerials = hintKey != null
    const serialList = needsSerials ? parseSerials(line.serials) : []
    const serialsMatch = !needsSerials || (valid && serialList.length === qty)

    return {
      ...line,
      product,
      qty,
      valid,
      overStock: product != null && qty > product.qty,
      total: valid ? product.price * qty : 0,
      needsSerials,
      hintKey,
      serialList,
      serialsMatch,
    }
  })

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

  const total = priced.reduce((sum, line) => sum + line.total, 0)
  const anyOverStock = priced.some((line) => line.overStock)
  const allValid = priced.every((line) => line.valid) && priced.length > 0
  const allSerialsMatch = priced.every((line) => line.serialsMatch)
  const cashValue = Number(cash)
  const cashValid = cash.trim() !== '' && cashValue >= 0

  const canSubmit =
    !busy &&
    allValid &&
    !anyOverStock &&
    cashValid &&
    (method === 'CASH' || bank !== '') &&
    allSerialsMatch &&
    duplicateSerials.size === 0

  function setLine(index: number, patch: Partial<Line>) {
    setLines((current) =>
      current.map((line, i) => (i === index ? { ...line, ...patch } : line)),
    )
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    if (!canSubmit) return

    setBusy(true)
    setError(null)

    try {
      // A shop that loses its connection mid-sale must still be able to
      // serve the customer: the sale is kept on the device and sent when the
      // connection returns, carrying an id so it cannot be recorded twice.
      const sent = await sendOrQueue({
        method: 'POST',
        path: '/api/sales',
        labelKey: 'sync.saleOffline',
        entity: 'sales',
        body: {
          items: priced.map((line) => ({
            productId: line.productId,
            quantity: line.qty,
            ...(line.needsSerials ? { serials: line.serialList } : {}),
          })),
          cashReceived: cashValue,
          paymentMethod: method,
          ...(method === 'TRANSFER' ? { bankName: bank } : {}),
          ...(note.trim() ? { customerNote: note.trim() } : {}),
        },
      })

      onDone(
        sent === null
          ? t('sync.savedOffline')
          : t('done.saleRecorded', { amount: currency(total) }),
      )
    } catch (caught) {
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
        aria-label={t('dlg.newSale')}
        onClick={(event) => event.stopPropagation()}
      >
        <header className={styles.head}>
          <div>
            <h2>{t('dlg.newSale')}</h2>
            <p>{t('dlg.newSaleNote')}</p>
          </div>
          <button type="button" onClick={onClose} aria-label={t('common.close')}>
            ✕
          </button>
        </header>

        <form className={styles.body} onSubmit={handleSubmit}>
          {priced.map((line, index) => (
            <div key={index} className={styles.saleLine}>
              {/* Category first, on its own row; then the product within it
                  and how many. */}
              <label className={styles.field} style={{ gridColumn: '1 / -1' }}>
                <span>
                  {t('dlg.item', { n: index + 1 })} · {t('prod.category')}
                </span>
                <select
                  value={line.categoryId}
                  onChange={(event) =>
                    setLine(index, { categoryId: event.target.value, typeId: '', productId: '' })
                  }
                >
                  <option value="">{t('sale.allCategories')}</option>
                  {saleCategories.map((entry) => (
                    <option key={entry.id} value={entry.id}>
                      {entry.name}
                    </option>
                  ))}
                </select>
              </label>

              {/* Then the Owner's type within it: a phone's brand, the SIM
                  or airtime type. */}
              <label className={styles.field} style={{ gridColumn: '1 / -1' }}>
                <span>
                  {t(
                    categories.find((entry) => entry.id === line.categoryId)?.kind === 'PHONE'
                      ? 'prod.brand'
                      : 'prod.type',
                  )}
                </span>
                <select
                  value={line.typeId}
                  onChange={(event) => setLine(index, { typeId: event.target.value, productId: '' })}
                >
                  <option value="">{t('dlg.allTypes')}</option>
                  {[
                    ...new Map(
                      available
                        .filter((entry) => !line.categoryId || entry.categoryId === line.categoryId)
                        .filter((entry) => entry.typeId)
                        .map((entry) => [entry.typeId, entry.typeName] as const),
                    ),
                  ]
                    .sort((a, b) => a[1].localeCompare(b[1]))
                    .map(([id, name]) => (
                      <option key={id} value={id}>
                        {name}
                      </option>
                    ))}
                </select>
              </label>

              <label className={styles.field}>
                <span>{t('dlg.product')}</span>
                <select
                  value={line.productId}
                  onChange={(event) =>
                    setLine(index, { productId: event.target.value })
                  }
                  required
                >
                  <option value="">{t("dlg.selectProduct")}</option>
                  {available
                    .filter((entry) => !line.categoryId || entry.categoryId === line.categoryId)
                    .filter((entry) => !line.typeId || entry.typeId === line.typeId)
                    .map((entry) => (
                    <option key={entry.id} value={entry.id}>
                      {entry.label}
                    </option>
                  ))}
                </select>
              </label>

              <label className={styles.qtyField}>
                {/* Airtime is sold by the carta at its fixed price. */}
                <span>
                  {t(line.product?.category === 'AIRTIME_VOUCHER' ? 'sale.cartas' : 'dlg.qty')}
                </span>
                <input
                  type="number"
                  min="1"
                  step="1"
                  value={line.quantity}
                  onChange={(event) =>
                    setLine(index, { quantity: event.target.value })
                  }
                  required
                />
              </label>

              {lines.length > 1 ? (
                <button
                  type="button"
                  className={styles.removeLine}
                  onClick={() =>
                    setLines((current) =>
                      current.filter((_, i) => i !== index),
                    )
                  }
                  aria-label={t('a11y.removeItem', { n: index + 1 })}
                >
                  ✕
                </button>
              ) : null}

              {line.overStock && line.product ? (
                <p className={styles.lineWarn}>
                  {t('dlg.onlyInStock', { n: count(line.product.qty) })}
                </p>
              ) : null}

              {line.needsSerials && line.hintKey ? (
                <label className={styles.field} style={{ gridColumn: '1 / -1' }}>
                  <span>
                    {t('sale.serials')}
                    <em>{t(line.hintKey)}</em>
                  </span>
                  <textarea
                    rows={4}
                    value={line.serials}
                    onChange={(event) =>
                      setLine(index, { serials: event.target.value })
                    }
                    placeholder={`8925101234567890123\n8925101234567890124`}
                    spellCheck={false}
                  />
                  <p
                    className={styles.tally}
                    data-bad={
                      (!line.serialsMatch ||
                        line.serialList.some((value) =>
                          duplicateSerials.has(value),
                        )) &&
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
          ))}

          {duplicateSerials.size > 0 ? (
            <p className={styles.error}>
              {t('sale.duplicateSerial', {
                list: [...duplicateSerials].slice(0, 3).join(', '),
              })}
            </p>
          ) : null}

          <button
            type="button"
            className={styles.addLine}
            onClick={() =>
              setLines((current) => [
                ...current,
                { categoryId: '', typeId: '', productId: '', quantity: '1', serials: '' },
              ])
            }
          >
            {t('dlg.addAnother')}
          </button>

          <div className={styles.saleTotal}>
            <span>{t('dlg.total')}</span>
            <strong className="tabular">{currency(total)}</strong>
          </div>

          {/* How the customer paid. A transfer names the bank it went to. */}
          <div className={styles.field}>
            <span>
              {t('pay.method')}<em>{t('common.required')}</em>
            </span>
            <div className={styles.lineGrid} style={{ gridTemplateColumns: 'repeat(2, minmax(0, 1fr))' }}>
              {(['CASH', 'TRANSFER'] as const).map((option) => (
                <button
                  key={option}
                  type="button"
                  className={method === option ? styles.submit : styles.cancel}
                  aria-pressed={method === option}
                  onClick={() => setMethod(option)}
                >
                  {t(option === 'CASH' ? 'pay.cash' : 'pay.transfer')}
                </button>
              ))}
            </div>
          </div>

          {method === 'TRANSFER' ? (
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

          {method === 'TRANSFER' ? (
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

          <label className={styles.field}>
            <span>
              {t(method === 'CASH' ? 'dlg.cashReceived' : 'pay.transferReceived')}<em>{t('common.required')}</em>
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

          {cashValid && cashValue < total ? (
            <p className={styles.tally} data-bad="">
              {t('dlg.shortBy', { amount: currency(total - cashValue) })}
            </p>
          ) : null}

          <label className={styles.field}>
            <span>{t('dlg.note')}</span>
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
              {busy ? t('common.saving') : t('dlg.recordSale')}
            </button>
          </div>
        </form>
      </aside>
    </div>
  )
}

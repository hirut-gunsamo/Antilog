import { useEffect, useMemo, useState, type FormEvent } from 'react'

import { api } from '../../lib/api'
import { count, currency } from '../../lib/format'
import { useT } from '../../lib/i18n'
import type { InventoryBalance, InventorySummary, StockLossKind } from '../../lib/types'
import styles from './Panel.module.css'

/**
 * Reports damaged or lost stock.
 *
 * Stock is a plain count for every category, so a write-off is always a
 * quantity — there is nothing left to pick unit by unit, for a SIM, a
 * phone, or a voucher alike.
 *
 * `balance` pre-fills the product when the dialog is opened from an inventory
 * row, which is the path most reports will take.
 */
export function ReportLossDialog({
  balance,
  onClose,
  onDone,
}: {
  balance?: InventoryBalance | null
  onClose: () => void
  onDone: (message: string) => void
}) {
  const t = useT()

  const [stock, setStock] = useState<InventorySummary | null>(null)
  const [kind, setKind] = useState<StockLossKind>('DAMAGED')
  const [productId, setProductId] = useState(balance?.productId ?? '')
  const [quantity, setQuantity] = useState('1')
  const [reason, setReason] = useState('')

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
        // Already branch-scoped, so it doubles as the list of what this
        // person could possibly be holding.
        const payload = await api<{ summary: InventorySummary }>(
          '/api/inventory/summary',
          { signal: controller.signal },
        )

        setStock(payload.summary)
      } catch (caught) {
        if (controller.signal.aborted) return
        setError(
          caught instanceof Error ? caught.message : t('loss.loadFailed'),
        )
      }
    }

    void load()

    return () => controller.abort()
  }, [t])

  // One entry per product that actually has stock to write off.
  const available = useMemo(() => {
    const byProduct = new Map<
      string,
      {
        id: string
        name: string
        sku: string
        category: string
        price: number
        qty: number
        locationId: string
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
          price: Number(row.product.price ?? 0),
          qty: row.quantity,
          locationId: row.locationId,
        })
    }

    return [...byProduct.values()]
      .filter((entry) => entry.qty > 0)
      .sort((a, b) => a.name.localeCompare(b.name))
  }, [stock])

  const product = available.find((entry) => entry.id === productId)

  const qtyValue = Number(quantity)

  const qtyValid =
    Number.isInteger(qtyValue) &&
    qtyValue > 0 &&
    (product ? qtyValue <= product.qty : false)

  const canSubmit = !busy && product != null && reason.trim().length >= 3 && qtyValid

  // What it will actually cost, so the person reporting — and the supervisor
  // reviewing — sees the size of what is being written off.
  const affected = qtyValid ? qtyValue : 0
  const value = product ? product.price * affected : 0

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    if (!canSubmit || !product) return

    setBusy(true)
    setError(null)

    try {
      await api('/api/stock-loss', {
        method: 'POST',
        body: {
          kind,
          productId,
          reason: reason.trim(),
          quantity: qtyValue,
        },
      })

      onDone(
        t(kind === 'DAMAGED' ? 'loss.reportedDamaged' : 'loss.reportedLost', {
          n: count(affected),
          product: product.name,
        }),
      )
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : t('loss.reportFailed'),
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
        aria-label={t('loss.reportTitle')}
        onClick={(event) => event.stopPropagation()}
      >
        <header className={styles.head}>
          <div>
            <h2>{t('loss.reportTitle')}</h2>
            <p>{t('loss.reportNote')}</p>
          </div>
          <button type="button" onClick={onClose} aria-label={t('common.close')}>
            ✕
          </button>
        </header>

        <form className={styles.body} onSubmit={handleSubmit}>
          {/* What happened comes first: it is the thing the person already
              knows before they open this form. */}
          <div className={styles.field}>
            <span>{t('loss.whatHappened')}</span>
            <div className={styles.kindRow}>
              <button
                type="button"
                className={
                  kind === 'DAMAGED'
                    ? `${styles.kindCard} ${styles.kindOn}`
                    : styles.kindCard
                }
                aria-pressed={kind === 'DAMAGED'}
                data-kind="damaged"
                onClick={() => setKind('DAMAGED')}
              >
                <strong>{t('loss.damaged')}</strong>
                <em>{t('loss.damagedNote')}</em>
              </button>

              <button
                type="button"
                className={
                  kind === 'LOST'
                    ? `${styles.kindCard} ${styles.kindOn}`
                    : styles.kindCard
                }
                aria-pressed={kind === 'LOST'}
                data-kind="lost"
                onClick={() => setKind('LOST')}
              >
                <strong>{t('loss.lost')}</strong>
                <em>{t('loss.lostNote')}</em>
              </button>
            </div>
          </div>

          <label className={styles.field}>
            <span>
              {t('dlg.product')}
              <em>{t('common.required')}</em>
            </span>
            <select
              value={productId}
              onChange={(event) => setProductId(event.target.value)}
              required
            >
              <option value="">{t('dlg.selectProduct')}</option>
              {available.map((entry) => (
                <option key={entry.id} value={entry.id}>
                  {entry.name} · {t('dlg.onHand', { n: count(entry.qty) })}
                </option>
              ))}
            </select>
          </label>

          {/* Every category: a plain count. */}
          {product ? (
            <label className={styles.field}>
              <span>
                {t('loss.howMany')}
                <em>{t('dlg.onHand', { n: count(product.qty) })}</em>
              </span>
              <input
                type="number"
                min="1"
                max={product.qty}
                step="1"
                value={quantity}
                onChange={(event) => setQuantity(event.target.value)}
                required
              />
            </label>
          ) : null}

          {product && quantity.trim() !== '' && !qtyValid ? (
            <p className={styles.lineWarn}>
              {t('loss.tooMany', { n: count(product.qty) })}
            </p>
          ) : null}

          <label className={styles.field}>
            <span>
              {t('loss.reason')}
              <em>{t('loss.reasonNote')}</em>
            </span>
            <textarea
              rows={3}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              maxLength={500}
              required
            />
          </label>

          {affected > 0 && product ? (
            <div className={styles.saleTotal}>
              <span>{t('loss.writeOffValue')}</span>
              <strong className="tabular">{currency(value)}</strong>
            </div>
          ) : null}

          <p className={styles.hint}>{t('loss.reviewNote')}</p>

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
              {busy ? t('loss.submitting') : t('loss.submitReport')}
            </button>
          </div>
        </form>
      </aside>
    </div>
  )
}

import { useEffect, useState, type FormEvent } from 'react'

import { api } from '../../lib/api'
import { sendOrQueue } from '../../lib/sync'
import { useT } from '../../lib/i18n'
import { CATEGORY_KEY, CATEGORY_ORDER, count } from '../../lib/format'
import type {
  CatalogueProduct,
  Holding,
  InventorySummary,
  StockRequestKind,
} from '../../lib/types'
import styles from '../inventory/Panel.module.css'

type Line = { productId: string; quantity: string }

const TITLE_KEY = {
  RESTOCK: 'dlg.newRequest',
  ISSUE: 'dlg.takeItems',
  RETURN: 'dlg.handBack',
} as const

const NOTE_KEY = {
  RESTOCK: 'dlg.newRequestNote',
  ISSUE: 'dlg.takeItemsNote',
  RETURN: 'dlg.handBackNote',
} as const

/**
 * One dialog for the three requests in the chain.
 *
 * RESTOCK is a supervisor asking the Owner to refill the branch. ISSUE is a
 * salesperson taking goods out to sell in the morning, and RETURN is the same
 * person handing back what is left at night — which opens filled in with
 * exactly what they are still holding, because that is the answer nine times
 * out of ten and typing it again invites mistakes.
 */
export function NewRequestDialog({
  kind = 'RESTOCK',
  onClose,
  onDone,
}: {
  kind?: StockRequestKind
  onClose: () => void
  onDone: (message: string) => void
}) {
  const isReturn = kind === 'RETURN'

  // A salesperson works from a fixed list: every item the branch sells, with a
  // box against each. They are asking for "100 SIM cards, 50 of that phone, 10
  // of the 15-birr voucher" and reading it back at a glance matters more than
  // saving a few rows — picking products one by one from a menu is slower and
  // easier to get wrong when it is done every morning.
  const asGrid = kind !== 'RESTOCK'
  const [products, setProducts] = useState<CatalogueProduct[]>([])
  const t = useT()
  const [onHand, setOnHand] = useState<Map<string, number>>(new Map())
  const [lines, setLines] = useState<Line[]>([{ productId: '', quantity: '' }])
  const [grid, setGrid] = useState<Record<string, string>>({})
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
        if (isReturn) {
          // The whole catalogue, not just what they hold: SIM cards and
          // phones belong on the sheet even when the answer is none, so the
          // count reads as a checklist of everything they could be carrying.
          const [{ holdings }, productRes] = await Promise.all([
            api<{ holdings: Holding[] }>('/api/inventory/holdings', {
              signal: controller.signal,
            }),
            api<{ products: CatalogueProduct[] }>('/api/products', {
              signal: controller.signal,
            }),
          ])

          const mine = holdings[0]
          const held = (mine?.items ?? []).filter((item) => item.remaining > 0)

          setProducts(
            (productRes.products ?? []).filter(
              (entry) => entry.status === 'ACTIVE',
            ),
          )

          setOnHand(new Map(held.map((item) => [item.productId, item.remaining])))

          // What is left is what they hand back, so the boxes open filled in.
          setGrid(
            Object.fromEntries(
              held.map((item) => [item.productId, String(item.remaining)]),
            ),
          )

          return
        }

        const [productRes, stockRes] = await Promise.all([
          api<{ products: CatalogueProduct[] }>('/api/products', {
            signal: controller.signal,
          }),
          api<{ summary: InventorySummary }>('/api/inventory/summary', {
            signal: controller.signal,
          }),
        ])

        setProducts(
          (productRes.products ?? []).filter(
            (entry) => entry.status === 'ACTIVE',
          ),
        )

        // Showing what is already on the shelf makes the request a decision
        // rather than a guess.
        const held = new Map<string, number>()
        for (const row of stockRes.summary.items) {
          held.set(row.productId, (held.get(row.productId) ?? 0) + row.onShelf)
        }
        setOnHand(held)
      } catch (caught) {
        if (controller.signal.aborted) return
        setError(
          caught instanceof Error ? caught.message : 'Could not load products.',
        )
      }
    }

    void load()

    return () => controller.abort()
  }, [isReturn])

  const priced = lines.map((line) => {
    const product = products.find((entry) => entry.id === line.productId)
    const qty = Number(line.quantity)

    return {
      ...line,
      product,
      qty,
      valid: product != null && Number.isInteger(qty) && qty > 0,
    }
  })

  const totalUnits = priced.reduce(
    (sum, line) => sum + (line.valid ? line.qty : 0),
    0,
  )

  // The same product twice would be two lines the Owner has to reconcile.
  const chosen = new Set<string>()
  const duplicated = priced.some((line) => {
    if (line.productId === '') return false
    if (chosen.has(line.productId)) return true
    chosen.add(line.productId)
    return false
  })

  // Grid entries: a blank box means "none of that today", not an error, so
  // only the filled ones count and only they are sent.
  const gridLines = products
    .map((product) => {
      const raw = grid[product.id] ?? ''
      const qty = Number(raw)
      const limit = isReturn ? (onHand.get(product.id) ?? 0) : null

      return {
        product,
        raw,
        qty,
        blank: raw.trim() === '',
        valid:
          raw.trim() === '' ||
          (Number.isInteger(qty) &&
            qty >= 0 &&
            (limit === null || qty <= limit)),
      }
    })


  const gridTotal = gridLines.reduce(
    (sum, line) => sum + (line.valid && !line.blank ? line.qty : 0),
    0,
  )

  const gridValid =
    gridLines.every((line) => line.valid) && gridTotal > 0

  const canSubmit = asGrid
    ? !busy && gridValid
    : !busy && priced.length > 0 && priced.every((l) => l.valid) && !duplicated

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
      // Same reasoning as a sale: a branch that has run out should be able to
      // ask for stock whether or not the link is up at that moment.
      const sent = await sendOrQueue({
        method: 'POST',
        path: '/api/requests',
        labelKey: 'sync.requestOffline',
        entity: 'requests',
        body: {
          kind,
          items: asGrid
            ? gridLines
                .filter((line) => !line.blank && line.qty > 0)
                .map((line) => ({
                  productId: line.product.id,
                  quantity: line.qty,
                }))
            : priced.map((line) => ({
                productId: line.productId,
                quantity: line.qty,
              })),
          ...(note.trim() ? { notes: note.trim() } : {}),
        },
      })

      onDone(
        sent === null
          ? t('sync.savedOffline')
          : isReturn
            ? t('done.handedBack', {
                units: t('dlg.units', { n: count(gridTotal) }),
              })
          : asGrid
            ? t('done.requested', {
                units: t('dlg.units', { n: count(gridTotal) }),
                n: gridLines.filter((line) => !line.blank && line.qty > 0)
                  .length,
              })
          : priced.length === 1
            ? t('done.requestedOne', {
                units: t('dlg.units', { n: count(totalUnits) }),
              })
            : t('done.requested', {
                units: t('dlg.units', { n: count(totalUnits) }),
                n: priced.length,
              }),
      )
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : 'Could not send the request.',
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
        aria-label={t(TITLE_KEY[kind])}
        onClick={(event) => event.stopPropagation()}
      >
        <header className={styles.head}>
          <div>
            <h2>{t(TITLE_KEY[kind])}</h2>
            <p>{t(NOTE_KEY[kind])}</p>
          </div>
          <button type="button" onClick={onClose} aria-label={t('common.close')}>
            ✕
          </button>
        </header>

        <form className={styles.body} onSubmit={handleSubmit}>
          {asGrid ? (
            <>
              {products.length === 0 ? (
                <p className={styles.none}>
                  {isReturn ? t('hold.nothing') : t('common.loading')}
                </p>
              ) : null}

              {CATEGORY_ORDER.filter((category) =>
                gridLines.some((line) => line.product.category === category),
              ).map((category) => (
                <section key={category} className={styles.gridGroup}>
                  <h3 className={styles.gridHead}>{t(CATEGORY_KEY[category])}</h3>

                  {gridLines
                    .filter((line) => line.product.category === category)
                    .map((line) => (
                      <label key={line.product.id} className={styles.gridRow}>
                        <span className={styles.gridName}>
                          {line.product.name}
                          <em className={styles.sub}>
                            {t(isReturn ? 'dlg.youHold' : 'dlg.onHand', {
                              n: count(onHand.get(line.product.id) ?? 0),
                            })}
                          </em>
                        </span>

                        <input
                          type="number"
                          inputMode="numeric"
                          min="0"
                          step="1"
                          {...(isReturn
                            ? {
                                max: onHand.get(line.product.id) ?? 0,
                                // Nothing held means nothing to hand back;
                                // the row stays for the count, greyed out.
                                disabled: (onHand.get(line.product.id) ?? 0) === 0,
                              }
                            : {})}
                          value={line.raw}
                          onChange={(event) =>
                            setGrid((current) => ({
                              ...current,
                              [line.product.id]: event.target.value,
                            }))
                          }
                          placeholder="0"
                          aria-label={line.product.name}
                          data-bad={!line.valid ? '' : undefined}
                        />
                      </label>
                    ))}
                </section>
              ))}

              <div className={styles.saleTotal}>
                <span>
                  {t(isReturn ? 'dlg.totalReturned' : 'dlg.totalRequested')}
                </span>
                <strong className="tabular">
                  {t('dlg.units', { n: count(gridTotal) })}
                </strong>
              </div>
            </>
          ) : (
            <>
            {priced.map((line, index) => (
              <div key={index} className={styles.saleLine}>
                <label className={styles.field}>
                  <span>{t('dlg.item', { n: index + 1 })}</span>
                  <select
                    value={line.productId}
                    onChange={(event) =>
                      setLine(index, { productId: event.target.value })
                    }
                    required
                  >
                    <option value="">{t("dlg.selectProduct")}</option>
                    {products.map((entry) => (
                      <option key={entry.id} value={entry.id}>
                        {entry.name} ·{' '}
                        {t(isReturn ? 'dlg.youHold' : 'dlg.onHand', {
                          n: count(onHand.get(entry.id) ?? 0),
                        })}
                      </option>
                    ))}
                  </select>
                </label>

                <label className={styles.qtyField}>
                  <span>{t('dlg.qty')}</span>
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
                      setLines((current) => current.filter((_, i) => i !== index))
                    }
                    aria-label={t('a11y.removeItem', { n: index + 1 })}
                  >
                    ✕
                  </button>
                ) : null}
              </div>
            ))}

            <button
              type="button"
              className={styles.addLine}
              onClick={() =>
                setLines((current) => [
                  ...current,
                  { productId: '', quantity: '' },
                ])
              }
            >
              {t('dlg.addAnother')}
            </button>

            {duplicated ? (
              <p className={styles.tally} data-bad="">
  {t('dlg.duplicateProduct')}
              </p>
            ) : totalUnits > 0 ? (
              <div className={styles.saleTotal}>
                <span>{t(isReturn ? 'dlg.totalReturned' : 'dlg.totalRequested')}</span>
                <strong className="tabular">{t('dlg.units', { n: count(totalUnits) })}</strong>
              </div>
            ) : null}

            </>
          )}

          <label className={styles.field}>
            <span>{t('dlg.note')}</span>
            <input
              value={note}
              onChange={(event) => setNote(event.target.value)}
              maxLength={500}
              placeholder={t(
                isReturn ? 'dlg.phReturnNote' : 'dlg.phRequestNote',
              )}
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
              {busy
                ? t('dlg.sending')
                : t(isReturn ? 'dlg.sendReturn' : 'dlg.sendRequest')}
            </button>
          </div>
        </form>
      </aside>
    </div>
  )
}

import { useEffect, useState, type FormEvent } from 'react'

import { api } from '../../lib/api'
import { sendOrQueue } from '../../lib/sync'
import { useT } from '../../lib/i18n'
import { CATEGORY_KEY, CATEGORY_ORDER, count } from '../../lib/format'
import { requestRef } from '../../lib/requests'
import { cartaSuffix } from '../../lib/stock'
import type {
  CatalogueProduct,
  Holding,
  InventorySummary,
  StockRequest,
  StockRequestKind,
} from '../../lib/types'
import styles from '../inventory/Panel.module.css'

const TITLE_KEY = {
  RESTOCK: 'dlg.newRequest',
  ISSUE: 'dlg.takeItems',
  RETURN: 'dlg.handBack',
} as const

const NOTE_KEY = {
  RESTOCK: 'dlg.newRequestNote',
  ISSUE: 'dlg.takeItemsNote',
  RETURN: null,
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
  kind: kindProp = 'RESTOCK',
  onClose,
  onDone,
  editing,
  branchOnly = false,
}: {
  /** Asking another branch's supervisor, never the Owner. */
  branchOnly?: boolean
  kind?: StockRequestKind
  onClose: () => void
  onDone: (message: string) => void
  /** A request nobody has decided yet, being corrected. */
  editing?: StockRequest
}) {
  const kind = editing?.kind ?? kindProp
  const isReturn = kind === 'RETURN'

  // Everyone works from a fixed list: every item the branch sells, with a
  // box against each, grouped by category. They only type how many they
  // want; picking products one by one from a menu is slower and easier to
  // get wrong when it is done every day.
  const [products, setProducts] = useState<CatalogueProduct[]>([])
  const t = useT()
  const [onHand, setOnHand] = useState<Map<string, number>>(new Map())
  const [grid, setGrid] = useState<Record<string, string>>(() =>
    Object.fromEntries((editing?.items ?? []).map((item) => [item.product.id, String(item.quantity)])),
  )
  const [note, setNote] = useState(editing?.notes ?? '')
  // A supervisor's restock goes to the Owner, or straight to another
  // branch's supervisor, who sends the goods.
  const asksBranch = kind === 'RESTOCK' && !editing
  const [askBranches, setAskBranches] = useState<{ id: string; name: string }[]>([])
  const [fromBranchId, setFromBranchId] = useState('')

  useEffect(() => {
    if (!asksBranch) return
    const controller = new AbortController()
    api<{ branches: { id: string; name: string }[] }>('/api/requests/sources', { signal: controller.signal })
      .then((payload) => setAskBranches(payload.branches ?? []))
      .catch(() => undefined)
    return () => controller.abort()
  }, [asksBranch])

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
          if (!editing) setGrid(
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
  }, [isReturn, editing])

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

  const canSubmit = !busy && gridValid && (!branchOnly || fromBranchId !== '')

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    if (!canSubmit) return

    setBusy(true)
    setError(null)

    try {
      // Same reasoning as a sale: a branch that has run out should be able to
      // ask for stock whether or not the link is up at that moment.
      // A correction goes straight to the server: it must see the request as
      // it stands now.
      if (editing) {
        await api(`/api/requests/${editing.id}`, {
          method: 'PUT',
          body: {
            kind,
            items: gridLines
              .filter((line) => !line.blank && line.qty > 0)
              .map((line) => ({ productId: line.product.id, quantity: line.qty })),
            ...(!isReturn && note.trim() ? { notes: note.trim() } : {}),
          },
        })
        onDone(t('req.edited'))
        return
      }

      const sent = await sendOrQueue({
        method: 'POST',
        path: '/api/requests',
        labelKey: 'sync.requestOffline',
        entity: 'requests',
        body: {
          kind,
          items: gridLines
            .filter((line) => !line.blank && line.qty > 0)
            .map((line) => ({
              productId: line.product.id,
              quantity: line.qty,
            })),
          ...(!isReturn && note.trim() ? { notes: note.trim() } : {}),
          ...(asksBranch && fromBranchId ? { fromBranchId } : {}),
        },
      })

      onDone(
        sent === null
          ? t('sync.savedOffline')
          : isReturn
            ? t('done.handedBack', {
                units: t('dlg.units', { n: count(gridTotal) }),
              })
          : t('done.requested', {
              units: t('dlg.units', { n: count(gridTotal) }),
              n: gridLines.filter((line) => !line.blank && line.qty > 0).length,
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
            <h2>{editing ? `${t('req.editTitle')} · ${requestRef(editing)}` : t(branchOnly ? 'tr.askBranch' : TITLE_KEY[kind])}</h2>
            {NOTE_KEY[kind] ? <p>{t(NOTE_KEY[kind])}</p> : null}
          </div>
          <button type="button" onClick={onClose} aria-label={t('common.close')}>
            ✕
          </button>
        </header>

        <form className={styles.body} onSubmit={handleSubmit}>
          {asksBranch ? (
            <label className={styles.field}>
              <span>{t('req.askWho')}</span>
              <select value={fromBranchId} onChange={(event) => setFromBranchId(event.target.value)} required={branchOnly}>
                <option value="">{t(branchOnly ? 'req.pickBranch' : 'req.askOwner')}</option>
                {askBranches.map((entry) => (
                  <option key={entry.id} value={entry.id}>
                    {t('req.askBranch', { branch: entry.name })}
                  </option>
                ))}
              </select>
            </label>
          ) : null}

          <>
              {products.length === 0 ? (
                <p className={styles.none}>
                  {isReturn ? t('hold.nothing') : t('common.loading')}
                </p>
              ) : null}

              {CATEGORY_ORDER.filter((category) =>
                gridLines.some((line) => line.product.category === category),
              ).map((category) => (
                // Each category folds open and shut, so a long list stays short.
                <details key={category} className={styles.gridGroup} open>
                  <summary className={styles.gridHead}>{t(CATEGORY_KEY[category])}</summary>

                  {gridLines
                    .filter((line) => line.product.category === category)
                    .map((line) => (
                      <label key={line.product.id} className={styles.gridRow}>
                        <span className={styles.gridName}>
                          {line.product.name}
                          <em className={styles.sub}>
                            {t(isReturn ? 'dlg.youHold' : 'dlg.onHand', {
                              n: `${count(onHand.get(line.product.id) ?? 0)}${cartaSuffix(line.product.category)}`,
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
                </details>
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

          {!isReturn ? (
            <label className={styles.field}>
              <span>{t('dlg.note')}</span>
              <input
                value={note}
                onChange={(event) => setNote(event.target.value)}
                maxLength={500}
                placeholder={t('dlg.phRequestNote')}
              />
            </label>
          ) : null}

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

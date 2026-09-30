import { useEffect, useMemo, useState, type FormEvent } from 'react'

import { api } from '../../lib/api'
import { count, currency } from '../../lib/format'
import { useCategories } from '../../lib/categories'
import { useT } from '../../lib/i18n'
import type { BranchRow, ProductRow, TypeNode } from '../../lib/types'
import styles from './Panel.module.css'

/** What tells two products of the same type apart. */
function detailOf(product: ProductRow): string {
  if (product.voucherDetails) {
    return currency(Number(product.voucherDetails.denomination))
  }

  if (product.phoneDetails) {
    const { model, storage, color } = product.phoneDetails
    return [model, storage, color].filter(Boolean).join(' · ')
  }

  return product.description ?? ''
}

/**
 * Brings a delivery into a branch. Owner only.
 *
 * The product is found the way it was defined: category, then type (a brand
 * for phones, then the phone's type), then the product itself — so the list
 * at the last step is short enough to read.
 */
export function StockInDialog({
  onClose,
  onDone,
}: {
  onClose: () => void
  onDone: (message: string) => void
}) {
  const [products, setProducts] = useState<ProductRow[]>([])
  const [types, setTypes] = useState<TypeNode[]>([])
  const t = useT()
  const [branches, setBranches] = useState<[string, string][]>([])

  // The Owner's categories; `kind` says whether the second step is a brand.
  const { categories } = useCategories()
  const [categoryId, setCategoryId] = useState('')
  const category = categories.some((entry) => entry.id === categoryId)
    ? categoryId
    : (categories[0]?.id ?? '')
  const kind = categories.find((entry) => entry.id === category)?.kind
  const [typeId, setTypeId] = useState('')
  const [subTypeId, setSubTypeId] = useState('')
  const [productId, setProductId] = useState('')
  const [locationId, setLocationId] = useState('')
  const [quantity, setQuantity] = useState('')
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
        const [productRes, typeRes, branchRes] = await Promise.all([
          api<{ products: ProductRow[] }>('/api/products', {
            signal: controller.signal,
          }),
          api<{ types: TypeNode[] }>('/api/product-types', {
            signal: controller.signal,
          }),
          api<{ branches: BranchRow[] }>('/api/branches?isActive=true', {
            signal: controller.signal,
          }),
        ])

        setProducts(
          (productRes.products ?? []).filter(
            (entry) => entry.status === 'ACTIVE',
          ),
        )
        setTypes(typeRes.types ?? [])

        // Ask for the branches themselves. These were read off the stock rows
        // instead, which left out any branch holding nothing yet - on a new
        // system that is every branch, so there was nowhere to put the first
        // delivery. Every signed-in user may list branches, and the list is
        // already scoped to them.
        setBranches(
          (branchRes.branches ?? [])
            .filter((row) => row.isActive)
            .map((row): [string, string] => [row.id, row.name])
            .sort((a, b) => a[1].localeCompare(b[1])),
        )
      } catch (caught) {
        if (controller.signal.aborted) return
        setError(
          caught instanceof Error ? caught.message : 'Could not load the form.',
        )
      }
    }

    void load()

    return () => controller.abort()
  }, [])

  // A product's type is either a top-level type or a phone type under a
  // brand; either way it belongs to the top-level one.
  const topOf = (entry: ProductRow) =>
    entry.type ? (entry.type.parentId ?? entry.type.id) : ''

  const inCategory = useMemo(
    () => products.filter((entry) => entry.categoryId === category),
    [products, category],
  )

  // Only types something is filed under: an empty one leads nowhere.
  const topTypes = types.filter(
    (node) =>
      node.categoryId === category &&
      inCategory.some((entry) => topOf(entry) === node.id),
  )
  const validTypeId = topTypes.some((node) => node.id === typeId)
    ? typeId
    : (topTypes[0]?.id ?? '')

  const subTypes = (
    topTypes.find((node) => node.id === validTypeId)?.children ?? []
  ).filter((node) => inCategory.some((entry) => entry.type?.id === node.id))
  const validSubTypeId = subTypes.some((node) => node.id === subTypeId)
    ? subTypeId
    : ''

  const shown = inCategory.filter(
    (entry) =>
      topOf(entry) === validTypeId &&
      (validSubTypeId === '' || entry.type?.id === validSubTypeId),
  )

  // Cleared rather than kept when a filter above hides it, so nothing is
  // saved that is not on screen.
  const product = shown.find((entry) => entry.id === productId)
  const validProductId = product ? productId : ''

  const qty = Number(quantity)
  const qtyValid = Number.isInteger(qty) && qty > 0

  const canSubmit =
    !busy && validProductId !== '' && locationId !== '' && qtyValid

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    if (!canSubmit) return

    setBusy(true)
    setError(null)

    try {
      await api('/api/inventory/stock-in', {
        method: 'POST',
        body: {
          productId: validProductId,
          locationId,
          quantity: qty,
          ...(note.trim() ? { note: note.trim() } : {}),
        },
      })

      const where = branches.find(([id]) => id === locationId)?.[1] ?? 'stock'

      onDone(
        t('done.stockAdded', {
          n: qty,
          product: product?.name ?? t('done.item'),
          branch: where,
        }),
      )
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : 'Could not add the stock.',
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
        aria-label={t('dlg.addInventory')}
        onClick={(event) => event.stopPropagation()}
      >
        <header className={styles.head}>
          <div>
            <h2>{t('dlg.addInventory')}</h2>
            <p>{t('dlg.addInventoryNote')}</p>
          </div>
          <button type="button" onClick={onClose} aria-label={t('common.close')}>
            ✕
          </button>
        </header>

        <form className={styles.body} onSubmit={handleSubmit}>
          <label className={styles.field}>
            <span>{t('prod.category')}</span>
            <select
              value={category}
              onChange={(event) => setCategoryId(event.target.value)}
            >
              {categories.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.name}
                </option>
              ))}
            </select>
          </label>

          {topTypes.length === 0 ? (
            <p className={styles.blocked}>{t('dlg.noProductsHere')}</p>
          ) : (
            <>
              <label className={styles.field}>
                <span>
                  {t(kind === 'PHONE' ? 'prod.brand' : 'prod.type')}
                </span>
                <select
                  value={validTypeId}
                  onChange={(event) => setTypeId(event.target.value)}
                >
                  {topTypes.map((node) => (
                    <option key={node.id} value={node.id}>
                      {node.name}
                    </option>
                  ))}
                </select>
              </label>

              {subTypes.length > 0 ? (
                <label className={styles.field}>
                  <span>{t('prod.type')}</span>
                  <select
                    value={validSubTypeId}
                    onChange={(event) => setSubTypeId(event.target.value)}
                  >
                    <option value="">{t('dlg.allTypes')}</option>
                    {subTypes.map((node) => (
                      <option key={node.id} value={node.id}>
                        {node.name}
                      </option>
                    ))}
                  </select>
                </label>
              ) : null}

              <label className={styles.field}>
                <span>{t('dlg.product')}</span>
                <select
                  value={validProductId}
                  onChange={(event) => setProductId(event.target.value)}
                  required
                >
                  <option value="">{t('dlg.selectProduct')}</option>
                  {shown.map((entry) => {
                    const detail = detailOf(entry)
                    return (
                      <option key={entry.id} value={entry.id}>
                        {entry.name}
                        {detail && !entry.name.includes(detail) ? ` · ${detail}` : ''}
                      </option>
                    )
                  })}
                </select>
              </label>

              {product ? (
                <dl className={styles.facts}>
                  <div>
                    <dt>{t('prod.sku')}</dt>
                    <dd className="tabular">{product.sku}</dd>
                  </div>
                  <div>
                    <dt>{t('prod.price')}</dt>
                    <dd className="tabular">{currency(Number(product.price))}</dd>
                  </div>
                  <div>
                    <dt>{t('prod.inStock')}</dt>
                    <dd className="tabular">
                      {count(
                        product.inventoryBalances.reduce(
                          (sum, balance) => sum + balance.quantity,
                          0,
                        ),
                      )}
                    </dd>
                  </div>
                  {detailOf(product) ? (
                    <div>
                      <dt>{t('prod.details')}</dt>
                      <dd>{detailOf(product)}</dd>
                    </div>
                  ) : null}
                </dl>
              ) : null}
            </>
          )}

          <label className={styles.field}>
            <span>{t('common.branch')}</span>
            <select
              value={locationId}
              onChange={(event) => setLocationId(event.target.value)}
              required
            >
              <option value="">{t("dlg.selectBranch")}</option>
              {branches.map(([id, name]) => (
                <option key={id} value={id}>
                  {name}
                </option>
              ))}
            </select>
          </label>

          <label className={styles.field}>
            <span>{t('dlg.quantity')}</span>
            <input
              type="number"
              min="1"
              step="1"
              value={quantity}
              onChange={(event) => setQuantity(event.target.value)}
              required
            />
          </label>

          <label className={styles.field}>
            <span>{t('dlg.note')}</span>
            <input
              value={note}
              onChange={(event) => setNote(event.target.value)}
              maxLength={500}
              placeholder={t('dlg.phStockNote')}
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
              {busy ? t('dlg.adding') : t('dlg.addToStock')}
            </button>
          </div>
        </form>
      </aside>
    </div>
  )
}

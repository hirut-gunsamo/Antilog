import { useEffect, useMemo, useRef, useState } from 'react'

import { useAuth } from '../auth/context'
import {
  BulkDeleteButton,
  deleteSelected,
  SelectAllCell,
  SelectCell,
  useSelection,
} from '../components/BulkDelete'
import { Card, Empty } from '../components/Card'
import { icons } from '../components/icons'
import { DeleteProductDialog } from '../components/products/DeleteProductDialog'
import { EditProductDialog } from '../components/products/EditProductDialog'
import { ProductDialog } from '../components/products/ProductDialog'
import { TypeDialog } from '../components/products/TypeDialog'
import { Toasts } from '../components/Toasts'
import { api } from '../lib/api'
import { count, currency } from '../lib/format'
import { useCategories } from '../lib/categories'
import { useT } from '../lib/i18n'
import { useToasts } from '../lib/toasts'
import type { ProductRow } from '../lib/types'
import styles from './Products.module.css'


/**
 * The catalogue: what the business sells.
 *
 * Distinct from Inventory, which counts how many of each of these a branch is
 * holding. Nothing can be taken into stock until it exists here, so on a new
 * installation this is the first page the Owner needs.
 *
 * Deleting one that past sales point at only takes it out of the catalogue;
 * the API keeps the row so that history stays readable.
 */
export default function Products() {
  const { user } = useAuth()
  const t = useT()
  const { toasts, push, dismiss } = useToasts()

  const isOwner = user?.role === 'OWNER'

  const [products, setProducts] = useState<ProductRow[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
  const [addingType, setAddingType] = useState(false)
  const [reloadKey, setReloadKey] = useState(0)
  const selection = useSelection()

  const [openMenu, setOpenMenu] = useState<string | null>(null)
  const [editOf, setEditOf] = useState<ProductRow | null>(null)
  const [deleteOf, setDeleteOf] = useState<ProductRow | null>(null)
  const menuRef = useRef<HTMLDivElement | null>(null)

  const [category, setCategory] = useState('ALL')
  // One tab per category the Owner has, after All.
  const { categories } = useCategories()
  const tabs = [{ value: 'ALL', label: t('inv.tabAll') }, ...categories.map((entry) => ({ value: entry.id, label: entry.name }))]

  useEffect(() => {
    const controller = new AbortController()

    api<{ products: ProductRow[] }>('/api/products', {
      signal: controller.signal,
    })
      .then((payload) => {
        setProducts(payload.products ?? [])
        setError(null)
      })
      .catch((caught: unknown) => {
        if (controller.signal.aborted) return
        setError(caught instanceof Error ? caught.message : 'Could not load.')
        setProducts([])
      })

    return () => controller.abort()
  }, [reloadKey])

  // Close the row menu on an outside click.
  useEffect(() => {
    if (!openMenu) return

    function onDown(event: MouseEvent) {
      if (!menuRef.current?.contains(event.target as Node)) setOpenMenu(null)
    }

    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [openMenu])

  const rows = useMemo(
    () =>
      (products ?? []).filter(
        (product) => category === 'ALL' || product.categoryId === category,
      ),
    [products, category],
  )

  // The catalogue only: what Ethio Telecom sells. How many are held is on
  // the Inventory page, per branch.
  const totals = {
    all: (products ?? []).length,
  }

  async function removeSelected() {
    const ids = [...selection.selected]
    if (await deleteSelected(ids, (id) => `/api/products/${id}`, t, push)) {
      selection.clear()
      setReloadKey((n) => n + 1)
    }
  }

  return (
    <div className={styles.page}>
      <header className={styles.head}>
        <div className={styles.mobileHeading}>
          <h1 className={styles.title}>{t('prod.title')}</h1>
          <p className={styles.subtitle}>{t('prod.note')}</p>
        </div>

        {isOwner ? (
          <div className={styles.headActions}>
            <button
              type="button"
              className={styles.primary}
              onClick={() => setAdding(true)}
            >
              + {t('prod.add')}
            </button>
          </div>
        ) : null}
      </header>

      <div className={styles.totals}>
        <div>
          <strong className="tabular">{count(totals.all)}</strong>
          <span>{t('prod.totalProducts')}</span>
        </div>
      </div>

      <Card>
        <div className={styles.tabs} role="tablist">
          <div className={styles.tabList}>
            {tabs.map((option) => (
              <button
                key={option.value}
                className={
                  category === option.value
                    ? `${styles.tab} ${styles.tabActive}`
                    : styles.tab
                }
                type="button"
                role="tab"
                aria-selected={category === option.value}
                onClick={() => setCategory(option.value)}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>

        {error ? <Empty>{error}</Empty> : null}

        {products === null ? (
          <Empty>{t('common.loading')}</Empty>
        ) : rows.length === 0 ? (
          <Empty>{t('prod.none')}</Empty>
        ) : (
          <div className={styles.scroll}>
            <table className={styles.table}>
              <thead>
                <tr>
                  {isOwner ? (
                    <SelectAllCell ids={rows.map((product) => product.id)} selection={selection} />
                  ) : null}
                  <th scope="col">{t('prod.name')}</th>
                  <th scope="col">{t('prod.category')}</th>
                  <th scope="col">{t('prod.type')}</th>
                  <th scope="col">{t('prod.price')}</th>
                  {isOwner ? (
                    <th scope="col" className={styles.actionsCol}>
                      <BulkDeleteButton
                        count={selection.selected.size}
                        onClick={() => void removeSelected()}
                      />
                    </th>
                  ) : null}
                </tr>
              </thead>
              <tbody>
                {rows.map((product) => {
                  return (
                    <tr key={product.id}>
                      {isOwner ? (
                        <SelectCell id={product.id} name={product.name} selection={selection} />
                      ) : null}
                      <td data-label={t('prod.name')} className={styles.strong}>
                        {product.name}
                        {/* A phone is told apart by its model and storage. */}
                        {product.phoneDetails ? (
                          <em className={styles.sub}>
                            {[
                              product.phoneDetails.model,
                              product.phoneDetails.storage,
                              product.phoneDetails.color,
                            ]
                              .filter(Boolean)
                              .join(' · ')}
                          </em>
                        ) : null}
                        {product.description ? (
                          <em className={styles.sub}>{product.description}</em>
                        ) : null}
                      </td>
                      <td data-label={t('prod.category')}>
                        {product.productCategory?.name ?? '—'}
                      </td>
                      <td data-label={t('prod.type')}>
                        {product.type?.name ?? '—'}
                      </td>
                      <td data-label={t('prod.price')} className="tabular">
                        {currency(Number(product.price))}
                        {product.branchPrices?.length ? (
                          <em className={styles.sub}>
                            {t('bp.count', { n: product.branchPrices.length })}
                          </em>
                        ) : null}
                      </td>
                      {isOwner ? (
                        <td className={styles.actionsCol}>
                          <div className={styles.menuWrap}>
                            <button
                              className={styles.iconButton}
                              type="button"
                              aria-label={t('a11y.actionsFor', { name: product.name })}
                              aria-haspopup="menu"
                              aria-expanded={openMenu === product.id}
                              onClick={() =>
                                setOpenMenu(
                                  openMenu === product.id ? null : product.id,
                                )
                              }
                            >
                              <svg
                                viewBox="0 0 24 24"
                                width={16}
                                height={16}
                                fill="none"
                                stroke="currentColor"
                                strokeLinecap="round"
                                aria-hidden="true"
                              >
                                {icons.more.map((d, index) => (
                                  <path key={index} d={d} />
                                ))}
                              </svg>
                            </button>

                            {openMenu === product.id ? (
                              <div
                                className={styles.menu}
                                role="menu"
                                ref={menuRef}
                              >
                                <button
                                  type="button"
                                  role="menuitem"
                                  onClick={() => {
                                    setEditOf(product)
                                    setOpenMenu(null)
                                  }}
                                >
                                  {t('prod.edit')}
                                </button>

                                <button
                                  type="button"
                                  role="menuitem"
                                  className={styles.menuDanger}
                                  onClick={() => {
                                    setDeleteOf(product)
                                    setOpenMenu(null)
                                  }}
                                >
                                  {t('prod.delete')}
                                </button>
                              </div>
                            ) : null}
                          </div>
                        </td>
                      ) : null}
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {adding ? (
        <ProductDialog
          onClose={() => setAdding(false)}
          onDone={(product) => {
            setAdding(false)
            push('success', t('prod.saved', { name: product.name }))
            setReloadKey((n) => n + 1)
          }}
        />
      ) : null}

      {editOf ? (
        <EditProductDialog
          product={editOf}
          onClose={() => setEditOf(null)}
          onDone={(product) => {
            setEditOf(null)
            push('success', t('prod.updated', { name: product.name }))
            setReloadKey((n) => n + 1)
          }}
          onNotice={(message) => {
            push('success', message)
            setReloadKey((n) => n + 1)
          }}
        />
      ) : null}

      {deleteOf ? (
        <DeleteProductDialog
          product={deleteOf}
          onClose={() => setDeleteOf(null)}
          onDone={() => {
            push('success', t('prod.deleted', { name: deleteOf.name }))
            setDeleteOf(null)
            setReloadKey((n) => n + 1)
          }}
        />
      ) : null}

      {addingType ? (
        <TypeDialog
          categoryId={category === 'ALL' ? (categories[0]?.id ?? '') : category}
          onClose={() => setAddingType(false)}
          onDone={(type) => {
            setAddingType(false)
            push('success', t('prod.typeSaved', { name: type.name }))
          }}
        />
      ) : null}

      <Toasts toasts={toasts} onDismiss={dismiss} />
    </div>
  )
}

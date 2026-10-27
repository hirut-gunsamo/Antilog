import { useEffect, useState } from 'react'

import { Card, Empty } from '../Card'
import { api } from '../../lib/api'
import { CATEGORY_KEY, count, currency } from '../../lib/format'
import { useT, type TranslationKey } from '../../lib/i18n'
import { cartaSuffix, stockStatus, type StockStatus } from '../../lib/stock'
import styles from '../../pages/Inventory.module.css'

type Row = {
  id: string
  quantity: number
  branch: { id: string; name: string }
  product: {
    id: string
    name: string
    sku: string
    category: string
    price: string | number
    productCategory: { id: string; name: string } | null
  }
}

const STATUS_LABEL: Record<StockStatus, TranslationKey> = {
  IN_STOCK: 'inv.inStock',
  LOW_STOCK: 'inv.lowStock',
  OUT_OF_STOCK: 'inv.outOfStock',
}

/**
 * The Owner's stock, kept at the main store and split by the branch it was
 * bought for. A branch's request is filled only from its own share. Each
 * share can be corrected to its true figure.
 */
export function BranchStockCard({
  branch,
  reload,
  onAdd,
  onSaved,
}: {
  /** 'ALL' or a branch id, from the page's branch picker. */
  branch: string
  reload: number
  onAdd: () => void
  onSaved: (message: string) => void
}) {
  const t = useT()
  const [rows, setRows] = useState<Row[] | null>(null)
  const [editing, setEditing] = useState<string | null>(null)
  const [value, setValue] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [version, setVersion] = useState(0)

  useEffect(() => {
    const controller = new AbortController()
    const query = branch !== 'ALL' ? `?branchId=${encodeURIComponent(branch)}` : ''
    api<{ stock: Row[] }>(`/api/inventory/branch-stock${query}`, { signal: controller.signal })
      .then((payload) => setRows(payload.stock ?? []))
      .catch(() => {
        if (!controller.signal.aborted) setRows([])
      })
    return () => controller.abort()
  }, [branch, reload, version])

  async function save(row: Row) {
    const quantity = Number(value)
    if (!Number.isInteger(quantity) || quantity < 0 || busy) return
    setBusy(true)
    setError(null)
    try {
      await api('/api/inventory/branch-stock', {
        method: 'PUT',
        body: { branchId: row.branch.id, productId: row.product.id, quantity },
      })
      setEditing(null)
      setVersion((n) => n + 1)
      onSaved(t('bs.saved', { product: row.product.name, branch: row.branch.name, n: count(quantity) }))
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not save it.')
    } finally {
      setBusy(false)
    }
  }

  const total = (rows ?? []).reduce((sum, row) => sum + row.quantity, 0)
  const worth = (rows ?? []).reduce((sum, row) => sum + row.quantity * Number(row.product.price ?? 0), 0)

  return (
    <Card
      title={t('bs.title')}
      subtitle={t('bs.note')}
      action={
        <button type="button" className={styles.primary} onClick={onAdd}>
          + {t('inv.add')}
        </button>
      }
    >
      {error ? <p style={{ color: 'var(--danger)', margin: '0 0 10px' }}>{error}</p> : null}
      {rows === null ? (
        <Empty>{t('common.loading')}</Empty>
      ) : rows.length === 0 ? (
        <Empty>{t('bs.none')}</Empty>
      ) : (
        <div className={styles.scroll}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th scope="col">{t('common.branch')}</th>
                <th scope="col">{t('inv.product')}</th>
                <th scope="col">{t('inv.category')}</th>
                <th scope="col">{t('dlg.quantity')}</th>
                <th scope="col">{t('common.status')}</th>
                <th scope="col">{t('bs.value')}</th>
                <th scope="col" />
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id}>
                  <td data-label={t('common.branch')} className={styles.strong}>
                    {row.branch.name}
                  </td>
                  <td data-label={t('inv.product')}>{row.product.name}</td>
                  <td data-label={t('inv.category')}>
                    {row.product.productCategory?.name ??
                      (CATEGORY_KEY[row.product.category] ? t(CATEGORY_KEY[row.product.category]) : row.product.category)}
                  </td>
                  <td data-label={t('dlg.quantity')} className="tabular">
                    {editing === row.id ? (
                      <input
                        type="number"
                        min="0"
                        step="1"
                        value={value}
                        onChange={(event) => setValue(event.target.value)}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter') void save(row)
                          if (event.key === 'Escape') setEditing(null)
                        }}
                        autoFocus
                        style={{ width: 110 }}
                        aria-label={t('dlg.quantity')}
                      />
                    ) : (
                      <strong>
                        {count(row.quantity)}
                        {cartaSuffix(row.product.category)}
                      </strong>
                    )}
                  </td>
                  <td data-label={t('common.status')}>
                    {/* The same rule as a branch shelf: low means ask for more. */}
                    <span className={styles.status} data-state={stockStatus(row.product.category, row.quantity)}>
                      {t(STATUS_LABEL[stockStatus(row.product.category, row.quantity)])}
                    </span>
                  </td>
                  <td data-label={t('bs.value')} className="tabular">
                    {currency(row.quantity * Number(row.product.price ?? 0))}
                  </td>
                  <td>
                    {editing === row.id ? (
                      <>
                        <button type="button" className={styles.primary} disabled={busy} onClick={() => void save(row)}>
                          {t('common.save')}
                        </button>{' '}
                        <button type="button" className={styles.ghost} onClick={() => setEditing(null)}>
                          {t('common.cancel')}
                        </button>
                      </>
                    ) : (
                      <button
                        type="button"
                        className={styles.ghost}
                        onClick={() => {
                          setEditing(row.id)
                          setValue(String(row.quantity))
                          setError(null)
                        }}
                      >
                        {t('bs.edit')}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td>{t('rep.totalRow')}</td>
                <td />
                <td />
                <td className="tabular">{count(total)}</td>
                <td />
                <td className="tabular">{currency(worth)}</td>
                <td />
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </Card>
  )
}

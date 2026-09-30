import { useEffect, useState } from 'react'

import { Card, Empty } from '../components/Card'
import { Toasts } from '../components/Toasts'
import { api } from '../lib/api'
import { count, currency } from '../lib/format'
import { useT } from '../lib/i18n'
import { useToasts } from '../lib/toasts'
import type { ProductRow } from '../lib/types'
import base from './Products.module.css'
import styles from './Ibid.module.css'

/** A carta is 20 cards; the standard price is 5% off them. */
const standardPrice = (value: number) => Math.round(value * 20 * 0.95 * 100) / 100

/**
 * Airtime prices: every airtime item, grouped by its type (Voucher, Ibid…),
 * with the price of one carta. The Owner changes a price here; sales always
 * sell at it and cannot change it.
 */
export default function VoucherPrices() {
  const t = useT()
  const { toasts, push, dismiss } = useToasts()

  const [products, setProducts] = useState<ProductRow[] | null>(null)
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const [busyId, setBusyId] = useState<string | null>(null)
  const [reloadKey, setReloadKey] = useState(0)

  useEffect(() => {
    const controller = new AbortController()
    api<{ products: ProductRow[] }>('/api/products', { signal: controller.signal })
      .then((payload) =>
        setProducts((payload.products ?? []).filter((row) => row.category === 'AIRTIME_VOUCHER')),
      )
      .catch(() => {
        if (!controller.signal.aborted) setProducts([])
      })
    return () => controller.abort()
  }, [reloadKey])

  const valueOf = (row: ProductRow) => Number(row.voucherDetails?.denomination ?? 0)

  // Grouped by type: Voucher, Ibid, and any added later.
  const groups = [
    ...(products ?? [])
      .reduce((map, row) => {
        const key = row.type?.name ?? t('vp.noType')
        map.set(key, [...(map.get(key) ?? []), row])
        return map
      }, new Map<string, ProductRow[]>())
      .entries(),
  ]
    .map(([name, rows]) => [name, rows.sort((a, b) => valueOf(a) - valueOf(b))] as const)
    .sort((a, b) => a[0].localeCompare(b[0]))

  async function save(row: ProductRow, price: number) {
    setBusyId(row.id)
    try {
      await api(`/api/products/${row.id}`, { method: 'PATCH', body: { price } })
      push('success', t('vp.saved', { name: row.name, price: currency(price) }))
      setDrafts((current) => {
        const next = { ...current }
        delete next[row.id]
        return next
      })
      setReloadKey((n) => n + 1)
    } catch (caught) {
      push('error', caught instanceof Error ? caught.message : 'Failed.')
    } finally {
      setBusyId(null)
    }
  }

  return (
    <div className={base.page}>
      <header className={base.head}>
        <div className={base.mobileHeading}>
          <h1 className={base.title}>{t('vp.title')}</h1>
          <p className={base.subtitle}>{t('vp.note')}</p>
        </div>
      </header>

      {products === null ? (
        <Card>
          <Empty>{t('common.loading')}</Empty>
        </Card>
      ) : groups.length === 0 ? (
        <Card>
          <Empty>{t('vp.none')}</Empty>
        </Card>
      ) : (
        groups.map(([type, rows]) => (
          <Card key={type} title={type}>
            <div className={base.scroll}>
              <table className={base.table}>
                <thead>
                  <tr>
                    <th scope="col">{t('prod.name')}</th>
                    <th scope="col">{t('prod.denomination')}</th>
                    <th scope="col">{t('prod.cartaPrice')}</th>
                    <th scope="col">{t('vp.standard')}</th>
                    <th scope="col">{t('prod.inStock')}</th>
                    <th scope="col" className={base.actionsCol} />
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => {
                    const current = Number(row.price)
                    const draft = drafts[row.id] ?? String(current)
                    const next = Number(draft)
                    const changed = draft.trim() !== '' && next >= 0 && next !== current
                    const standard = standardPrice(valueOf(row))
                    const held = row.inventoryBalances.reduce((sum, balance) => sum + balance.quantity, 0)

                    return (
                      <tr key={row.id}>
                        <td data-label={t('prod.name')} className={base.strong}>
                          {row.name}
                          <em className={base.sub}>{row.sku}</em>
                        </td>
                        <td data-label={t('prod.denomination')} className="tabular">
                          {valueOf(row)}
                        </td>
                        <td data-label={t('prod.cartaPrice')}>
                          <div className={styles.filters} style={{ margin: 0 }}>
                            <input
                              type="number"
                              inputMode="decimal"
                              min="0"
                              step="0.01"
                              value={draft}
                              onChange={(event) => setDrafts((all) => ({ ...all, [row.id]: event.target.value }))}
                              style={{ width: 110 }}
                              aria-label={t('prod.cartaPrice')}
                            />
                          </div>
                        </td>
                        <td data-label={t('vp.standard')} className="tabular">
                          {currency(standard)}
                          {current !== standard ? (
                            <button
                              type="button"
                              className={styles.link}
                              onClick={() => void save(row, standard)}
                              disabled={busyId === row.id}
                            >
                              {t('vp.useStandard')}
                            </button>
                          ) : null}
                        </td>
                        <td data-label={t('prod.inStock')} className="tabular">
                          {count(held)}
                        </td>
                        <td className={base.actionsCol}>
                          <button
                            type="button"
                            className={base.primary}
                            onClick={() => void save(row, next)}
                            disabled={!changed || busyId === row.id}
                          >
                            {t('common.save')}
                          </button>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </Card>
        ))
      )}

      <Toasts toasts={toasts} onDismiss={dismiss} />
    </div>
  )
}

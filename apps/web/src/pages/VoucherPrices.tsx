import { useEffect, useState } from 'react'

import { Card, Empty } from '../components/Card'
import { Toasts } from '../components/Toasts'
import { api } from '../lib/api'
import { useBranchList } from '../lib/branches'
import { count, currency } from '../lib/format'
import { useT } from '../lib/i18n'
import { useSettings } from '../lib/settings'
import { useToasts } from '../lib/toasts'
import type { AppSettings, ProductRow } from '../lib/types'
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
  // Buying prices being typed, by product; blank clears one.
  const [costDrafts, setCostDrafts] = useState<Record<string, string>>({})
  const [busyId, setBusyId] = useState<string | null>(null)
  const [reloadKey, setReloadKey] = useState(0)
  // Whose prices are shown: '' is the default every branch sells at, else one
  // branch's own prices.
  const [branch, setBranch] = useState('')
  const branchList = useBranchList()
  const branchName = branchList.find(([id]) => id === branch)?.[1] ?? ''
  // Typed prices are kept per branch, so switching branch never carries one over.
  const draftKey = (row: ProductRow) => `${branch}:${row.id}`

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

  // The fixed price of one SIM transfer, also set in Settings.
  const { settings, setSettings } = useSettings()
  const [transferDraft, setTransferDraft] = useState<string | null>(null)
  const transferValue = transferDraft ?? String(Number(settings.simTransferPrice ?? 0))
  const transferNext = Number(transferValue)
  const transferChanged =
    transferValue.trim() !== '' && transferNext >= 0 && transferNext !== Number(settings.simTransferPrice ?? 0)
  const [transferBusy, setTransferBusy] = useState(false)

  async function saveTransferPrice() {
    setTransferBusy(true)
    try {
      const payload = await api<{ settings: AppSettings }>('/api/settings', {
        method: 'PATCH',
        body: { simTransferPrice: transferNext },
      })
      setSettings(payload.settings)
      setTransferDraft(null)
      push('success', t('st.saved'))
    } catch (err) {
      push('error', err instanceof Error ? err.message : 'Failed.')
    } finally {
      setTransferBusy(false)
    }
  }

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

  async function save(row: ProductRow, price: number | null, costPrice?: number | null) {
    setBusyId(row.id)
    try {
      if (branch) {
        // One branch's own price, or (null) back to the default.
        await api(`/api/products/${row.id}/prices/${branch}`, {
          method: price === null ? 'DELETE' : 'PUT',
          ...(price === null ? {} : { body: { price } }),
        })
        push(
          'success',
          price === null
            ? t('bp.reset', { branch: branchName })
            : t('bp.saved', { branch: branchName, price: currency(price) }),
        )
      } else {
        await api(`/api/products/${row.id}`, {
          method: 'PATCH',
          body: { price, ...(costPrice !== undefined ? { costPrice } : {}) },
        })
        push('success', t('vp.saved', { name: row.name, price: currency(price ?? 0) }))
      }
      const drop = (current: Record<string, string>) => {
        const next = { ...current }
        delete next[draftKey(row)]
        delete next[row.id]
        return next
      }
      setDrafts(drop)
      setCostDrafts(drop)
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

      <Card>
        <div className={styles.filters} style={{ marginBottom: 0 }}>
          <label>
            {t('bp.priceFor')}
            <select value={branch} onChange={(event) => setBranch(event.target.value)}>
              <option value="">{t('bp.allBranches')}</option>
              {branchList.map(([id, name]) => (
                <option key={id} value={id}>
                  {name}
                </option>
              ))}
            </select>
          </label>
        </div>
      </Card>

      <Card title={t('st.price')}>
        <div className={styles.filters} style={{ marginBottom: 0, alignItems: 'flex-end' }}>
          <label>
            {t('st.perTransfer')}
            <input
              type="number"
              inputMode="decimal"
              min="0"
              step="0.01"
              value={transferValue}
              onChange={(event) => setTransferDraft(event.target.value)}
              style={{ width: 110 }}
            />
          </label>
          <button
            type="button"
            className={base.primary}
            onClick={() => void saveTransferPrice()}
            disabled={!transferChanged || transferBusy}
          >
            {t('common.save')}
          </button>
        </div>
      </Card>

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
                    {branch ? null : <th scope="col">{t('prod.costPrice')}</th>}
                    <th scope="col">{t('prod.inStock')}</th>
                    <th scope="col" className={base.actionsCol} />
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => {
                    // With a branch chosen: its own price, else the default it falls back to.
                    const own = branch ? row.branchPrices?.find((entry) => entry.branchId === branch) : undefined
                    const current = Number(own?.price ?? row.price)
                    const draft = drafts[draftKey(row)] ?? String(current)
                    const next = Number(draft)
                    const savedCost = row.costPrice != null ? String(Number(row.costPrice)) : ''
                    const costDraft = costDrafts[row.id] ?? savedCost
                    const costChanged =
                      costDraft.trim() !== savedCost && (costDraft.trim() === '' || Number(costDraft) >= 0)
                    const changed = branch
                      ? draft.trim() !== '' && next >= 0 && (next !== current || !own)
                      : (draft.trim() !== '' && next >= 0 && next !== current) || costChanged
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
                              onChange={(event) => setDrafts((all) => ({ ...all, [draftKey(row)]: event.target.value }))}
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
                        {branch ? null : (
                          <td data-label={t('prod.costPrice')}>
                            <div className={styles.filters} style={{ margin: 0 }}>
                              <input
                                type="number"
                                inputMode="decimal"
                                min="0"
                                step="0.01"
                                value={costDraft}
                                onChange={(event) => setCostDrafts((all) => ({ ...all, [row.id]: event.target.value }))}
                                style={{ width: 110 }}
                                placeholder="—"
                                aria-label={t('prod.costPrice')}
                              />
                            </div>
                          </td>
                        )}
                        <td data-label={t('prod.inStock')} className="tabular">
                          {count(held)}
                        </td>
                        <td className={base.actionsCol}>
                          <button
                            type="button"
                            className={base.primary}
                            onClick={() =>
                              void save(
                                row,
                                draft.trim() !== '' && next >= 0 ? next : current,
                                costChanged ? (costDraft.trim() === '' ? null : Number(costDraft)) : undefined,
                              )
                            }
                            disabled={!changed || busyId === row.id}
                          >
                            {t('common.save')}
                          </button>
                          {own ? (
                            <button
                              type="button"
                              className={styles.link}
                              onClick={() => void save(row, null)}
                              disabled={busyId === row.id}
                            >
                              {t('bp.useDefault')}
                            </button>
                          ) : null}
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

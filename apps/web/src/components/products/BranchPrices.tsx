import { useState } from 'react'

import { api } from '../../lib/api'
import { useBranchList } from '../../lib/branches'
import { currency } from '../../lib/format'
import { useT } from '../../lib/i18n'
import type { ProductRow } from '../../lib/types'
import styles from '../inventory/Panel.module.css'
import own from './BranchPrices.module.css'

/**
 * A product's selling price at each branch. A branch left on the default
 * sells at the product's own price; the Owner sets, changes or removes each
 * branch's price here, and each one saves on its own.
 */
export function BranchPrices({
  product,
  onChanged,
}: {
  product: ProductRow
  onChanged: (message: string) => void
}) {
  const t = useT()
  const branches = useBranchList()
  // Kept here so a save shows at once, without waiting for the list to reload.
  const [set, setSet] = useState(
    () => new Map((product.branchPrices ?? []).map((row) => [row.branchId, Number(row.price)])),
  )
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const base = Number(product.price)

  async function send(branchId: string, name: string, price: number | null) {
    setBusy(branchId)
    setError(null)
    try {
      await api(`/api/products/${product.id}/prices/${branchId}`, {
        method: price === null ? 'DELETE' : 'PUT',
        ...(price === null ? {} : { body: { price } }),
      })
      setDrafts((current) => {
        const next = { ...current }
        delete next[branchId]
        return next
      })
      setSet((current) => {
        const next = new Map(current)
        if (price === null) next.delete(branchId)
        else next.set(branchId, price)
        return next
      })
      onChanged(
        price === null
          ? t('bp.reset', { branch: name })
          : t('bp.saved', { branch: name, price: currency(price) }),
      )
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not save it.')
    } finally {
      setBusy(null)
    }
  }

  return (
    <section className={own.wrap}>
      <h3 className={own.title}>{t('bp.title')}</h3>
      <p className={styles.hint}>{t('bp.note', { price: currency(base) })}</p>

      {branches.map(([id, name]) => {
        const current = set.get(id)
        const draft = drafts[id] ?? (current !== undefined ? String(current) : '')
        const value = Number(draft)
        const valid = draft.trim() !== '' && Number.isFinite(value) && value >= 0
        const changed = valid && value !== current

        return (
          <div key={id} className={own.row}>
            <span className={own.name}>
              {name}
              <em>{current !== undefined ? t('bp.own') : t('bp.default', { price: currency(base) })}</em>
            </span>
            <input
              type="number"
              inputMode="decimal"
              min="0"
              step="0.01"
              value={draft}
              placeholder={String(base)}
              onChange={(event) => setDrafts((all) => ({ ...all, [id]: event.target.value }))}
              aria-label={t('bp.priceAt', { branch: name })}
            />
            <button
              type="button"
              className={styles.submit}
              disabled={!changed || busy !== null}
              onClick={() => void send(id, name, value)}
            >
              {t('common.save')}
            </button>
            {current !== undefined ? (
              <button
                type="button"
                className={styles.cancel}
                disabled={busy !== null}
                onClick={() => void send(id, name, null)}
              >
                {t('bp.useDefault')}
              </button>
            ) : null}
          </div>
        )
      })}

      {error ? <p className={styles.error}>{error}</p> : null}
    </section>
  )
}

import { useEffect, useState, type FormEvent } from 'react'

import { api } from '../../lib/api'
import { count } from '../../lib/format'
import { useT } from '../../lib/i18n'
import type { ProductRow } from '../../lib/types'
import styles from '../inventory/Panel.module.css'

/**
 * Takes a product out of the catalogue.
 *
 * The API refuses while any of it is still in stock, so that case is said
 * here up front instead of as a failed request. Stock a salesperson is
 * holding is not in this row's data; the API's own message covers that.
 */
export function DeleteProductDialog({
  product,
  onClose,
  onDone,
}: {
  product: ProductRow
  onClose: () => void
  onDone: () => void
}) {
  const t = useT()

  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose()
    }

    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  const inStock = product.inventoryBalances.reduce(
    (sum, balance) => sum + balance.quantity,
    0,
  )
  const holdsStock = inStock !== 0

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    if (holdsStock || busy) return

    setBusy(true)
    setError(null)

    try {
      // The API client always sends a JSON content type, which Fastify
      // refuses with an empty body.
      await api(`/api/products/${product.id}`, { method: 'DELETE', body: {} })
      onDone()
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : 'Could not delete it.',
      )
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className={styles.scrim} onClick={onClose}>
      <aside
        className={styles.panel}
        role="alertdialog"
        aria-modal="true"
        aria-label={t('prod.deleteTitle')}
        onClick={(event) => event.stopPropagation()}
      >
        <header className={styles.head}>
          <div>
            <h2>{t('prod.deleteTitle')}</h2>
            <p className="tabular">{product.sku}</p>
          </div>
          <button type="button" onClick={onClose} aria-label={t('common.close')}>
            ✕
          </button>
        </header>

        <form className={styles.body} onSubmit={handleSubmit}>
          <p className={styles.warn}>
            {t('prod.deleteWhat', { name: product.name })}
          </p>

          {holdsStock ? (
            <p className={styles.blocked}>
              {t('prod.deleteBlocked', { n: count(inStock) })}
            </p>
          ) : null}

          {error ? <p className={styles.error}>{error}</p> : null}

          <div className={styles.actions}>
            <button type="button" className={styles.cancel} onClick={onClose}>
              {t('common.cancel')}
            </button>
            <button
              type="submit"
              className={styles.danger}
              disabled={holdsStock || busy}
            >
              {busy ? t('prod.deleting') : t('prod.delete')}
            </button>
          </div>
        </form>
      </aside>
    </div>
  )
}

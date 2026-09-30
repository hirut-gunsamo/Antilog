import { useEffect, useState, type FormEvent } from 'react'

import { api } from '../../lib/api'
import { useT } from '../../lib/i18n'
import type { ProductRow } from '../../lib/types'
import styles from '../inventory/Panel.module.css'

/**
 * Changes what describes a product: its name, price and details.
 *
 * The category, type and code are not offered. Stock, requests and sales are
 * all counted against them, so a product that is really something else is
 * deleted and added again instead.
 */
export function EditProductDialog({
  product,
  onClose,
  onDone,
}: {
  product: ProductRow
  onClose: () => void
  onDone: (product: ProductRow) => void
}) {
  const t = useT()

  const isVoucher = product.category === 'AIRTIME_VOUCHER'
  const isPhone = product.category === 'PHONE'

  const [name, setName] = useState(product.name)
  const [price, setPrice] = useState(String(Number(product.price)))
  const [denomination, setDenomination] = useState(
    product.voucherDetails
      ? String(Number(product.voucherDetails.denomination))
      : '',
  )
  const [phoneModel, setPhoneModel] = useState(product.phoneDetails?.model ?? '')
  const [storage, setStorage] = useState(product.phoneDetails?.storage ?? '')
  const [color, setColor] = useState(product.phoneDetails?.color ?? '')
  const [description, setDescription] = useState(product.description ?? '')

  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose()
    }

    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  const priceValue = Number(price)
  const denominationValue = Number(denomination)

  const valid =
    name.trim().length >= 2 &&
    (!isVoucher ||
      (denomination.trim() !== '' && Number.isInteger(denominationValue) && denominationValue > 0)) &&
    price.trim() !== '' &&
    Number.isFinite(priceValue) &&
    priceValue >= 0

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    if (!valid || busy) return

    setBusy(true)
    setError(null)

    // Blank optional fields are sent as null so a value can be cleared.
    const body = {
      name: name.trim(),
      description: description.trim() || null,
      // Airtime's price is the carta price, which the Owner sets here.
      ...(isVoucher ? { denomination: denominationValue } : {}),
      price: priceValue,
      ...(isPhone
        ? {
            model: phoneModel.trim() || undefined,
            storage: storage.trim() || null,
            color: color.trim() || null,
          }
        : {}),
    }

    try {
      const payload = await api<{ product: ProductRow }>(
        `/api/products/${product.id}`,
        { method: 'PATCH', body },
      )

      onDone(payload.product)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not save it.')
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
        aria-label={t('prod.editTitle')}
        onClick={(event) => event.stopPropagation()}
      >
        <header className={styles.head}>
          <div>
            <h2>{t('prod.editTitle')}</h2>
            <p className="tabular">
              {product.sku}
              {product.type ? ` · ${product.type.name}` : ''}
            </p>
          </div>
          <button type="button" onClick={onClose} aria-label={t('common.close')}>
            ✕
          </button>
        </header>

        <form className={styles.body} onSubmit={handleSubmit}>
          <p className={styles.warn}>{t('prod.editNote')}</p>

          <label className={styles.field}>
            <span>
              {t('prod.name')}<em>{t('common.required')}</em>
            </span>
            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
              maxLength={150}
              required
              autoFocus
            />
          </label>

          {isVoucher ? (
            <label className={styles.field}>
              <span>
                {t('prod.denomination')}<em>{t('common.required')}</em>
              </span>
              <input
                type="number"
                inputMode="numeric"
                min="1"
                step="1"
                value={denomination}
                onChange={(event) => setDenomination(event.target.value)}
                required
              />
            </label>
          ) : null}

          {/* Everything has a price the Owner sets; for airtime it is the
              price of one carta, which sales cannot change. */}
          <label className={styles.field}>
            <span>
              {t(isVoucher ? 'prod.cartaPrice' : 'prod.price')}
              <em>{t(isVoucher ? 'prod.cartaPriceNote' : 'common.required')}</em>
            </span>
            <input
              type="number"
              inputMode="decimal"
              min="0"
              step="0.01"
              value={price}
              onChange={(event) => setPrice(event.target.value)}
              required
            />
          </label>


          {isPhone ? (
            <>
              <label className={styles.field}>
                <span>
                  {t('prod.model')}<em>{t('prod.optional')}</em>
                </span>
                <input
                  value={phoneModel}
                  onChange={(event) => setPhoneModel(event.target.value)}
                  maxLength={80}
                />
              </label>

              <label className={styles.field}>
                <span>
                  {t('prod.storage')}<em>{t('prod.optional')}</em>
                </span>
                <input
                  value={storage}
                  onChange={(event) => setStorage(event.target.value)}
                  maxLength={40}
                />
              </label>

              <label className={styles.field}>
                <span>
                  {t('prod.color')}<em>{t('prod.optional')}</em>
                </span>
                <input
                  value={color}
                  onChange={(event) => setColor(event.target.value)}
                  maxLength={40}
                />
              </label>
            </>
          ) : null}

          <label className={styles.field}>
            <span>
              {t('prod.description')}<em>{t('prod.descriptionNote')}</em>
            </span>
            <input
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              maxLength={500}
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
              disabled={!valid || busy}
            >
              {busy ? t('prod.saving') : t('prod.saveChanges')}
            </button>
          </div>
        </form>
      </aside>
    </div>
  )
}

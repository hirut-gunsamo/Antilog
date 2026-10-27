import { useEffect, useState, type FormEvent } from 'react'

import { api } from '../../lib/api'
import { useT } from '../../lib/i18n'
import { currency } from '../../lib/format'
import type { InventoryBalance } from '../../lib/types'
import styles from './Panel.module.css'

// SIM and phone quantities are derived from their unit rows, so the API
// refuses to set them directly. The field is disabled rather than hidden so
// it is clear why it cannot be used.
function isSerialized(category: string) {
  return category === 'SIM_CARD' || category === 'PHONE'
}

export function EditRowDialog({
  balance,
  onClose,
  onDone,
}: {
  balance: InventoryBalance
  onClose: () => void
  onDone: (message: string) => void
}) {
  const [name, setName] = useState(balance.product.name)
  const t = useT()
  const [price, setPrice] = useState(String(Number(balance.product.price ?? 0)))
  const [quantity, setQuantity] = useState(String(balance.quantity))
  const [reason, setReason] = useState('')

  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose()
    }

    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  const locked = isSerialized(balance.product.category)

  const nameChanged = name.trim() !== balance.product.name
  const priceChanged =
    Number(price) !== Number(balance.product.price ?? 0) &&
    price.trim() !== '' &&
    Number(price) >= 0
  const quantityChanged =
    !locked &&
    quantity.trim() !== '' &&
    Number(quantity) !== balance.quantity &&
    Number.isInteger(Number(quantity)) &&
    Number(quantity) >= 0

  const productChanged = nameChanged || priceChanged
  const anyChange = productChanged || quantityChanged

  // A quantity correction has to say why: it is the only edit that changes
  // what the business believes it holds.
  const needsReason = quantityChanged && reason.trim() === ''

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    if (!anyChange || needsReason || busy) return

    setBusy(true)
    setError(null)

    try {
      if (productChanged) {
        await api(`/api/inventory/product/${balance.productId}`, {
          method: 'PATCH',
          body: {
            ...(nameChanged ? { name: name.trim() } : {}),
            ...(priceChanged ? { price: Number(price) } : {}),
          },
        })
      }

      if (quantityChanged) {
        await api(`/api/inventory/balance/${balance.id}`, {
          method: 'PATCH',
          body: {
            quantity: Number(quantity),
            reason: reason.trim(),
          },
        })
      }

      // Name the change rather than saying "saved", so the confirmation is
      // checkable against what you meant to do.
      const changes: string[] = []
      if (nameChanged) changes.push(t('done.changeName'))
      if (priceChanged) changes.push(t('done.changePrice'))
      if (quantityChanged) {
        changes.push(
          t('done.changeQty', { from: balance.quantity, to: Number(quantity) }),
        )
      }

      onDone(
        t('done.rowUpdated', { name: name.trim(), changes: changes.join(', ') }),
      )
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : 'Could not save the change.',
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
        aria-label={t('a11y.editName', { name: balance.product.name })}
        onClick={(event) => event.stopPropagation()}
      >
        <header className={styles.head}>
          <div>
            <h2>{t('dlg.editItem')}</h2>
            <p className="tabular">
              {balance.location.name}
            </p>
          </div>
          <button type="button" onClick={onClose} aria-label={t('common.close')}>
            ✕
          </button>
        </header>

        <form className={styles.body} onSubmit={handleSubmit}>
          <label className={styles.field}>
            <span>{t('dlg.productName')}</span>
            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
              maxLength={160}
              required
            />
          </label>

          <label className={styles.field}>
            <span>
              {t('dlg.price')}
              <em>{t('dlg.currently', { value: currency(Number(balance.product.price ?? 0)) })}</em>
            </span>
            <input
              type="number"
              min="0"
              step="0.01"
              value={price}
              onChange={(event) => setPrice(event.target.value)}
            />
          </label>

          <label className={styles.field}>
            <span>
              {t('dlg.quantityAt', { branch: balance.location.name })}
              {locked ? <em>{t('dlg.setByUnits')}</em> : null}
            </span>
            <input
              type="number"
              min="0"
              step="1"
              value={quantity}
              disabled={locked}
              onChange={(event) => setQuantity(event.target.value)}
            />
          </label>

          {locked ? (
            <p className={styles.hint}>
{t('dlg.serialisedNote')}
            </p>
          ) : null}

          {quantityChanged ? (
            <label className={styles.field}>
              <span>
                {t('dlg.reasonForCorrection')}<em>{t('common.required')}</em>
              </span>
              <input
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                maxLength={500}
                placeholder={t('dlg.phEditReason')}
                autoFocus
              />
            </label>
          ) : null}

          {quantityChanged ? (
            <p className={styles.tally}>
              {balance.quantity} → {Number(quantity)} — recorded as an
              adjustment in stock history
            </p>
          ) : null}

          {error ? <p className={styles.error}>{error}</p> : null}

          <div className={styles.actions}>
            <button type="button" className={styles.cancel} onClick={onClose}>
              {t('common.cancel')}
            </button>
            <button
              type="submit"
              className={styles.submit}
              disabled={!anyChange || needsReason || busy}
            >
              {busy ? t('common.saving') : t('dlg.saveChanges')}
            </button>
          </div>
        </form>
      </aside>
    </div>
  )
}

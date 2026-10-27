import { useEffect, useState, type FormEvent } from 'react'
import { businessDay } from '../../lib/tz'

import { api } from '../../lib/api'
import { useT, type TranslationKey } from '../../lib/i18n'
import type { AssetCategory, BranchRow, OfficeAsset } from '../../lib/types'
import styles from '../inventory/Panel.module.css'

const CATEGORIES: { value: AssetCategory; labelKey: TranslationKey }[] = [
  { value: 'ELECTRONICS', labelKey: 'asset.electronics' },
  { value: 'FURNITURE', labelKey: 'asset.furniture' },
  { value: 'STATIONERY', labelKey: 'asset.stationery' },
  { value: 'OTHER', labelKey: 'asset.other' },
]

/** Today, as the date input wants it. */
function todayIso() {
  return businessDay()
}

/**
 * Records equipment delivered to a branch.
 *
 * Serial number and cost are optional on purpose: a box of paper has neither,
 * and inherited equipment often has no invoice. A blank is honest where a
 * zero would be a claim.
 */
export function AddAssetDialog({
  branches,
  onClose,
  onDone,
}: {
  branches: BranchRow[]
  onClose: () => void
  onDone: (asset: OfficeAsset) => void
}) {
  const t = useT()

  const [locationId, setLocationId] = useState(branches[0]?.id ?? '')
  const [name, setName] = useState('')
  const [category, setCategory] = useState<AssetCategory>('ELECTRONICS')
  const [quantity, setQuantity] = useState('1')
  const [serialNumber, setSerialNumber] = useState('')
  const [cost, setCost] = useState('')
  const [receivedAt, setReceivedAt] = useState(todayIso())
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

  const qty = Number(quantity)
  const valid =
    locationId !== '' &&
    name.trim().length >= 2 &&
    Number.isInteger(qty) &&
    qty > 0 &&
    (cost.trim() === '' || Number(cost) >= 0)

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    if (!valid || busy) return

    setBusy(true)
    setError(null)

    try {
      const payload = await api<{ asset: OfficeAsset }>('/api/assets', {
        method: 'POST',
        body: {
          locationId,
          name: name.trim(),
          category,
          quantity: qty,
          ...(serialNumber.trim() ? { serialNumber: serialNumber.trim() } : {}),
          ...(cost.trim() ? { cost: Number(cost) } : {}),
          ...(receivedAt ? { receivedAt } : {}),
          ...(note.trim() ? { note: note.trim() } : {}),
        },
      })

      onDone(payload.asset)
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : 'Could not save it.',
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
        aria-label={t('asset.addTitle')}
        onClick={(event) => event.stopPropagation()}
      >
        <header className={styles.head}>
          <div>
            <h2>{t('asset.addTitle')}</h2>
            <p>{t('asset.addNote')}</p>
          </div>
          <button type="button" onClick={onClose} aria-label={t('common.close')}>
            ✕
          </button>
        </header>

        <form className={styles.body} onSubmit={handleSubmit}>
          <label className={styles.field}>
            <span>
              {t('asset.name')}<em>{t('common.required')}</em>
            </span>
            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder={t('asset.namePlaceholder')}
              maxLength={160}
              required
            />
          </label>

          <label className={styles.field}>
            <span>{t('asset.category')}</span>
            <select
              value={category}
              onChange={(event) =>
                setCategory(event.target.value as AssetCategory)
              }
            >
              {CATEGORIES.map((option) => (
                <option key={option.value} value={option.value}>
                  {t(option.labelKey)}
                </option>
              ))}
            </select>
          </label>

          <label className={styles.field}>
            <span>
              {t('asset.branch')}<em>{t('common.required')}</em>
            </span>
            <select
              value={locationId}
              onChange={(event) => setLocationId(event.target.value)}
              required
            >
              {branches.map((branch) => (
                <option key={branch.id} value={branch.id}>
                  {branch.name}
                </option>
              ))}
            </select>
          </label>

          <label className={styles.field}>
            <span>{t('asset.quantity')}</span>
            <input
              type="number"
              inputMode="numeric"
              min="1"
              step="1"
              value={quantity}
              onChange={(event) => setQuantity(event.target.value)}
              required
            />
          </label>

          <label className={styles.field}>
            <span>
              {t('asset.serial')}<em>{t('asset.serialNote')}</em>
            </span>
            <input
              value={serialNumber}
              onChange={(event) => setSerialNumber(event.target.value)}
              maxLength={120}
            />
          </label>

          <label className={styles.field}>
            <span>
              {t('asset.cost')}<em>{t('asset.costNote')}</em>
            </span>
            <input
              type="number"
              inputMode="decimal"
              min="0"
              step="0.01"
              value={cost}
              onChange={(event) => setCost(event.target.value)}
            />
          </label>

          <label className={styles.field}>
            <span>{t('asset.received')}</span>
            <input
              type="date"
              value={receivedAt}
              onChange={(event) => setReceivedAt(event.target.value)}
            />
          </label>

          <label className={styles.field}>
            <span>{t('dlg.note')}</span>
            <input
              value={note}
              onChange={(event) => setNote(event.target.value)}
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
              {busy ? t('asset.saving') : t('asset.add')}
            </button>
          </div>
        </form>
      </aside>
    </div>
  )
}

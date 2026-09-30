import { useEffect, useMemo, useState, type FormEvent } from 'react'

import { api } from '../../lib/api'
import { useCategories } from '../../lib/categories'
import { useT } from '../../lib/i18n'
import type { ProductRow, TypeNode } from '../../lib/types'
import { CategoryDialog } from '../categories/CategoryDialog'
import { TypeDialog } from './TypeDialog'
import styles from '../inventory/Panel.module.css'

/**
 * Defines a product: what the business sells, as opposed to how many of it a
 * branch is holding.
 *
 * What the product *is* now comes from the type tree rather than free text —
 * a brand and model for a phone, a voucher kind for airtime — so the form
 * picks a type instead of typing a code or a network. The server derives the
 * name and the product code from that type when none is given.
 */
export function ProductDialog({
  onClose,
  onDone,
}: {
  onClose: () => void
  onDone: (product: ProductRow) => void
}) {
  const t = useT()

  // The Owner's category, and its kind, which decides the fields below.
  const { categories, reload: reloadCategories } = useCategories()
  const [categoryId, setCategoryId] = useState('')
  const [addingCategory, setAddingCategory] = useState(false)
  const validCategoryId = categories.some((entry) => entry.id === categoryId)
    ? categoryId
    : (categories[0]?.id ?? '')
  const category = categories.find((entry) => entry.id === validCategoryId)?.kind ?? 'OTHER'
  const [name, setName] = useState('')
  const [price, setPrice] = useState('')
  const [description, setDescription] = useState('')

  const [denomination, setDenomination] = useState('')
  const [phoneModel, setPhoneModel] = useState('')
  const [storage, setStorage] = useState('')
  const [color, setColor] = useState('')

  const [typeId, setTypeId] = useState('')
  const [modelId, setModelId] = useState('')

  const [types, setTypes] = useState<TypeNode[] | null>(null)
  const [typesReloadKey, setTypesReloadKey] = useState(0)
  const [addingType, setAddingType] = useState(false)

  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose()
    }

    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  // The full tree, unfiltered: each category's top-level options are filtered
  // from it client-side, so switching categories never needs a new request.
  useEffect(() => {
    const controller = new AbortController()

    api<{ types: TypeNode[] }>('/api/product-types', {
      signal: controller.signal,
    })
      .then((payload) => setTypes(payload.types ?? []))
      .catch(() => {
        if (!controller.signal.aborted) setTypes([])
      })

    return () => controller.abort()
  }, [typesReloadKey])

  // Retired types stay in the tree so old products still read correctly, but
  // nothing new may be filed under them.
  const topLevel = useMemo(
    () =>
      (types ?? []).filter(
        (node) => node.categoryId === validCategoryId && node.isActive,
      ),
    [types, validCategoryId],
  )

  // `typeId` is the person's last explicit pick, which goes stale the moment
  // the category changes or a reload drops it (retired, or simply not there
  // yet) — so what the form actually uses is derived fresh each render
  // rather than kept in sync by an effect.
  const validTypeId = topLevel.some((node) => node.id === typeId)
    ? typeId
    : (topLevel[0]?.id ?? '')

  const selectedBrand =
    topLevel.find((node) => node.id === validTypeId) ?? null
  const models = (selectedBrand?.children ?? []).filter((node) => node.isActive)

  const validModelId =
    category === 'PHONE' && models.some((node) => node.id === modelId)
      ? modelId
      : ''

  // Deletes the chosen type after a confirm. The API refuses while products
  // or types under it still exist, and its message is shown as the error.
  async function deleteType(node: TypeNode | null) {
    if (!node || busy) return
    if (!window.confirm(t('prod.deleteTypeConfirm', { name: node.name }))) return

    setBusy(true)
    setError(null)

    try {
      await api(`/api/product-types/${node.id}`, { method: 'DELETE', body: {} })
      setTypesReloadKey((n) => n + 1)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not delete it.')
    } finally {
      setBusy(false)
    }
  }

  function handleTypeAdded(created: TypeNode) {
    setAddingType(false)
    setTypesReloadKey((n) => n + 1)
    // A type added under another category takes the form there with it.
    if (created.categoryId) setCategoryId(created.categoryId)

    if (created.parentId) {
      setTypeId(created.parentId)
      setModelId(created.id)
    } else {
      setTypeId(created.id)
      setModelId('')
    }
  }

  const priceValue = Number(price)
  const denominationValue = Number(denomination)

  const nameValid = name.trim() === '' || name.trim().length >= 2

  const categoryValid =
    category === 'AIRTIME_VOUCHER'
      ? denomination.trim() !== '' &&
        Number.isInteger(denominationValue) &&
        denominationValue > 0
      : price.trim() !== '' && Number.isFinite(priceValue) && priceValue >= 0

  const valid = nameValid && categoryValid && validTypeId !== ''

  // The deepest node chosen is what gets submitted: the model if one was
  // picked, otherwise the brand (or the voucher kind, or the SIM type).
  const effectiveTypeId = validModelId || validTypeId

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    if (!valid || busy) return

    setBusy(true)
    setError(null)

    const body = {
      typeId: effectiveTypeId,
      // A voucher's price is taken from its denomination and the value sent
      // here is ignored, but the field is still required by the API.
      price: category === 'AIRTIME_VOUCHER' ? denominationValue : priceValue,
      ...(name.trim() ? { name: name.trim() } : {}),
      ...(description.trim() ? { description: description.trim() } : {}),
      ...(category === 'PHONE' && phoneModel.trim() ? { model: phoneModel.trim() } : {}),
      ...(category === 'PHONE' && storage.trim() ? { storage: storage.trim() } : {}),
      ...(category === 'PHONE' && color.trim() ? { color: color.trim() } : {}),
      ...(category === 'AIRTIME_VOUCHER' ? { denomination: denominationValue } : {}),
    }

    try {
      const payload = await api<{ product: ProductRow }>('/api/products', {
        method: 'POST',
        body,
      })

      onDone(payload.product)
    } catch (caught) {
      // The API answers a duplicate or a bad type with its own sentence; show
      // that rather than a generic failure, so the person knows what to fix.
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
        aria-label={t('prod.addTitle')}
        onClick={(event) => event.stopPropagation()}
      >
        <header className={styles.head}>
          <div>
            <h2>{t('prod.addTitle')}</h2>
            <p>{t('prod.addNote')}</p>
          </div>
          <button type="button" onClick={onClose} aria-label={t('common.close')}>
            ✕
          </button>
        </header>

        <form className={styles.body} onSubmit={handleSubmit}>
          <label className={styles.field}>
            <span>{t('prod.category')}</span>
            <div className={styles.withAdd}>
              <select
                value={validCategoryId}
                onChange={(event) => {
                  setCategoryId(event.target.value)
                  setModelId('')
                }}
              >
                {categories.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.name}
                  </option>
                ))}
              </select>
              <button type="button" className={styles.addLine} onClick={() => setAddingCategory(true)}>
                + {t('cat.add')}
              </button>
            </div>
          </label>

          <label className={styles.field}>
            <span>
              {t(category === 'PHONE' ? 'prod.brand' : 'prod.type')}
              <em>{t('common.required')}</em>
            </span>
            <div className={styles.withAdd}>
              <select
                value={validTypeId}
                onChange={(event) => {
                  setTypeId(event.target.value)
                  setModelId('')
                }}
                disabled={topLevel.length === 0}
                required
              >
                {topLevel.length === 0 ? (
                  <option value="">{t('prod.noTypes')}</option>
                ) : null}
                {topLevel.map((node) => (
                  <option key={node.id} value={node.id}>
                    {node.name}
                  </option>
                ))}
              </select>
              <button
                type="button"
                className={styles.addLine}
                onClick={() => setAddingType(true)}
              >
                + {t('prod.addType')}
              </button>
              {selectedBrand ? (
                <button
                  type="button"
                  className={styles.deleteLine}
                  onClick={() => void deleteType(selectedBrand)}
                  disabled={busy}
                  aria-label={t('prod.deleteTypeNamed', { name: selectedBrand.name })}
                >
                  {t('prod.delete')}
                </button>
              ) : null}
            </div>
          </label>

          {category === 'PHONE' && selectedBrand ? (
            <label className={styles.field}>
              <span>
                {t('prod.type')}<em>{t('prod.optional')}</em>
              </span>
              <div className={styles.withAdd}>
                <select
                  value={validModelId}
                  onChange={(event) => setModelId(event.target.value)}
                >
                  <option value="">{t('prod.modelNone')}</option>
                  {models.map((node) => (
                    <option key={node.id} value={node.id}>
                      {node.name}
                    </option>
                  ))}
                </select>
                {validModelId ? (
                  <button
                    type="button"
                    className={styles.deleteLine}
                    onClick={() =>
                      void deleteType(
                        models.find((node) => node.id === validModelId) ?? null,
                      )
                    }
                    disabled={busy}
                  >
                    {t('prod.delete')}
                  </button>
                ) : null}
              </div>
            </label>
          ) : null}

          <label className={styles.field}>
            <span>
              {t('prod.name')}<em>{t('prod.nameNote')}</em>
            </span>
            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
              maxLength={150}
            />
          </label>

          {category === 'AIRTIME_VOUCHER' ? (
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
          ) : (
            <label className={styles.field}>
              <span>
                {t('prod.price')}<em>{t('common.required')}</em>
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
          )}

          {category === 'PHONE' ? (
            <>
              <label className={styles.field}>
                <span>
                  {t('prod.model')}<em>{t('prod.optional')}</em>
                </span>
                <input
                  value={phoneModel}
                  onChange={(event) => setPhoneModel(event.target.value)}
                  placeholder={t('prod.phModel')}
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
              {busy ? t('prod.saving') : t('prod.add')}
            </button>
          </div>
        </form>
      </aside>

      {addingType ? (
        <TypeDialog
          categoryId={validCategoryId}
          onClose={() => setAddingType(false)}
          onDone={handleTypeAdded}
        />
      ) : null}

      {addingCategory ? (
        <CategoryDialog
          onClose={() => setAddingCategory(false)}
          onDone={(created) => {
            setAddingCategory(false)
            reloadCategories()
            setCategoryId(created.id)
            setModelId('')
          }}
        />
      ) : null}
    </div>
  )
}

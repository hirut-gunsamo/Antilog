import { useEffect, useState, type FormEvent } from 'react'

import { api } from '../../lib/api'
import { useCategories } from '../../lib/categories'
import { useT } from '../../lib/i18n'
import type { TypeNode } from '../../lib/types'
import { CategoryDialog } from '../categories/CategoryDialog'
import styles from '../inventory/Panel.module.css'

/**
 * Adds a type: a SIM type or voucher type by name, or a phone as brand plus
 * model. The brand is reused when it already exists and created when it
 * does not, so the Owner never has to think about the tree underneath.
 */
export function TypeDialog({
  categoryId,
  onClose,
  onDone,
}: {
  /** The category to start on; the Owner can pick another. */
  categoryId: string
  onClose: () => void
  onDone: (type: TypeNode) => void
}) {
  const t = useT()

  const { categories, reload: reloadCategories } = useCategories()
  const [cat, setCat] = useState(categoryId)
  const [addingCategory, setAddingCategory] = useState(false)
  const [name, setName] = useState('')
  const [brandId, setBrandId] = useState('')
  const [model, setModel] = useState('')

  // A new brand is named and saved on its own, then chosen for the model.
  const [addingBrand, setAddingBrand] = useState(false)
  const [newBrand, setNewBrand] = useState('')

  const [brands, setBrands] = useState<TypeNode[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose()
    }

    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  const validCat = categories.some((entry) => entry.id === cat) ? cat : (categories[0]?.id ?? '')
  const kind = categories.find((entry) => entry.id === validCat)?.kind
  const isPhone = kind === 'PHONE'

  // The phone brands a model can be filed under.
  useEffect(() => {
    if (!isPhone) return
    const controller = new AbortController()

    api<{ types: TypeNode[] }>(`/api/product-types?categoryId=${encodeURIComponent(validCat)}`, {
      signal: controller.signal,
    })
      .then((payload) =>
        setBrands((payload.types ?? []).filter((node) => node.isActive)),
      )
      .catch(() => {
        if (!controller.signal.aborted) setBrands([])
      })

    return () => controller.abort()
  }, [isPhone, validCat])

  // Falls back to the first brand, so the select never shows one that is
  // not actually chosen.
  const validBrandId = brands.some((node) => node.id === brandId)
    ? brandId
    : (brands[0]?.id ?? '')

  const valid =
    validCat !== '' &&
    (isPhone ? validBrandId !== '' && model.trim() !== '' : name.trim() !== '')

  async function create(body: {
    categoryId: string
    name: string
    parentId?: string
  }) {
    const payload = await api<{ type: TypeNode }>('/api/product-types', {
      method: 'POST',
      body,
    })
    return payload.type
  }

  async function saveBrand() {
    if (newBrand.trim() === '' || busy) return

    setBusy(true)
    setError(null)

    try {
      const created = await create({ categoryId: validCat, name: newBrand.trim() })
      setBrands((list) => [...list, { ...created, children: [] }])
      setBrandId(created.id)
      setNewBrand('')
      setAddingBrand(false)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not save it.')
    } finally {
      setBusy(false)
    }
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    if (!valid || busy) return

    setBusy(true)
    setError(null)

    try {
      if (!isPhone) {
        onDone(await create({ categoryId: validCat, name: name.trim() }))
        return
      }

      onDone(
        await create({
          categoryId: validCat,
          name: model.trim(),
          parentId: validBrandId,
        }),
      )
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
        aria-label={t('prod.addTypeTitle')}
        onClick={(event) => event.stopPropagation()}
      >
        <header className={styles.head}>
          <div>
            <h2>{t('prod.addTypeTitle')}</h2>
            <p>{t('prod.addTypeNote')}</p>
          </div>
          <button type="button" onClick={onClose} aria-label={t('common.close')}>
            ✕
          </button>
        </header>

        <form className={styles.body} onSubmit={handleSubmit}>
          <label className={styles.field}>
            <span>{t('prod.category')}</span>
            <div className={styles.withAdd}>
              <select value={validCat} onChange={(event) => setCat(event.target.value)}>
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

          {isPhone ? (
            <>
              {addingBrand ? (
                <label className={styles.field}>
                  <span>
                    {t('prod.newBrand')}<em>{t('common.required')}</em>
                  </span>
                  <div className={styles.withAdd}>
                    <input
                      value={newBrand}
                      onChange={(event) => setNewBrand(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') {
                          event.preventDefault()
                          void saveBrand()
                        }
                      }}
                      placeholder={t('prod.phBrand')}
                      maxLength={80}
                      autoFocus
                    />
                    <button
                      type="button"
                      className={styles.addLine}
                      onClick={() => void saveBrand()}
                      disabled={newBrand.trim() === '' || busy}
                    >
                      {t('prod.saveBrand')}
                    </button>
                  </div>
                </label>
              ) : (
                <label className={styles.field}>
                  <span>
                    {t('prod.brand')}<em>{t('common.required')}</em>
                  </span>
                  <div className={styles.withAdd}>
                    <select
                      value={validBrandId}
                      onChange={(event) => setBrandId(event.target.value)}
                      disabled={brands.length === 0}
                    >
                      {brands.length === 0 ? (
                        <option value="">{t('prod.noBrands')}</option>
                      ) : null}
                      {brands.map((node) => (
                        <option key={node.id} value={node.id}>
                          {node.name}
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      className={styles.addLine}
                      onClick={() => setAddingBrand(true)}
                    >
                      + {t('prod.addBrand')}
                    </button>
                  </div>
                </label>
              )}

              <label className={styles.field}>
                <span>
                  {t('prod.typeName')}<em>{t('common.required')}</em>
                </span>
                <input
                  value={model}
                  onChange={(event) => setModel(event.target.value)}
                  placeholder={t('prod.phPhoneType')}
                  maxLength={80}
                  required
                />
              </label>
            </>
          ) : (
            <label className={styles.field}>
              <span>
                {t('prod.typeName')}<em>{t('common.required')}</em>
              </span>
              <input
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder={t(
                  kind === 'SIM_CARD'
                    ? 'prod.phSimType'
                    : kind === 'AIRTIME_VOUCHER'
                      ? 'prod.phVoucherType'
                      : 'prod.phOtherType',
                )}
                maxLength={80}
                required
              />
            </label>
          )}

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
              {busy ? t('prod.saving') : t('prod.addType')}
            </button>
          </div>
        </form>
      </aside>

      {addingCategory ? (
        <CategoryDialog
          onClose={() => setAddingCategory(false)}
          onDone={(created) => {
            setAddingCategory(false)
            reloadCategories()
            setCat(created.id)
          }}
        />
      ) : null}
    </div>
  )
}

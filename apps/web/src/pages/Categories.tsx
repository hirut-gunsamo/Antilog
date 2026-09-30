import { useState } from 'react'

import { Card, Empty } from '../components/Card'
import { CategoryDialog } from '../components/categories/CategoryDialog'
import { Toasts } from '../components/Toasts'
import { api } from '../lib/api'
import { BUILT_IN, useCategories } from '../lib/categories'
import { count } from '../lib/format'
import { useT, type TranslationKey } from '../lib/i18n'
import { useToasts } from '../lib/toasts'
import type { CategoryRow } from '../lib/types'
import base from './Products.module.css'
import styles from './Ibid.module.css'

const KIND_KEY: Record<CategoryRow['kind'], TranslationKey> = {
  SIM_CARD: 'cat.kindSim',
  PHONE: 'cat.kindPhone',
  AIRTIME_VOUCHER: 'cat.kindAirtime',
  OTHER: 'cat.kindOther',
}

/**
 * The first step of the catalogue: the categories goods are grouped in. Then
 * types within a category, then products. SIM Cards, Phones and Airtime come
 * with the system; anything added is counted and sold by quantity and price.
 */
export default function Categories() {
  const t = useT()
  const { toasts, push, dismiss } = useToasts()
  const { categories, loaded, reload } = useCategories()
  const [form, setForm] = useState<CategoryRow | 'new' | null>(null)

  async function remove(category: CategoryRow) {
    if (!window.confirm(t('cat.deleteConfirm', { name: category.name }))) return

    try {
      await api(`/api/categories/${category.id}`, { method: 'DELETE' })
      push('success', t('cat.deleted', { name: category.name }))
      reload()
    } catch (caught) {
      push('error', caught instanceof Error ? caught.message : 'Failed.')
    }
  }

  return (
    <div className={base.page}>
      <header className={base.head}>
        <div className={base.mobileHeading}>
          <h1 className={base.title}>{t('cat.title')}</h1>
          <p className={base.subtitle}>{t('cat.note')}</p>
        </div>
        <div className={base.headActions}>
          <button type="button" className={base.primary} onClick={() => setForm('new')}>
            + {t('cat.add')}
          </button>
        </div>
      </header>

      <Card>
        {!loaded ? (
          <Empty>{t('common.loading')}</Empty>
        ) : categories.length === 0 ? (
          <Empty>{t('cat.none')}</Empty>
        ) : (
          <div className={base.scroll}>
            <table className={base.table}>
              <thead>
                <tr>
                  <th scope="col">{t('cat.name')}</th>
                  <th scope="col">{t('cat.how')}</th>
                  <th scope="col">{t('nav.productTypes')}</th>
                  <th scope="col">{t('nav.productList')}</th>
                  <th scope="col" className={base.actionsCol}>
                    {t('common.actions')}
                  </th>
                </tr>
              </thead>
              <tbody>
                {categories.map((category) => (
                  <tr key={category.id}>
                    <td data-label={t('cat.name')} className={base.strong}>
                      {category.name}
                    </td>
                    <td data-label={t('cat.how')}>{t(KIND_KEY[category.kind])}</td>
                    <td data-label={t('nav.productTypes')} className="tabular">
                      {count(category._count?.types ?? 0)}
                    </td>
                    <td data-label={t('nav.productList')} className="tabular">
                      {count(category._count?.products ?? 0)}
                    </td>
                    <td className={base.actionsCol}>
                      <div style={{ display: 'flex', gap: 12, justifyContent: 'flex-end' }}>
                        <button type="button" className={styles.link} style={{ margin: 0 }} onClick={() => setForm(category)}>
                          {t('cat.rename')}
                        </button>
                        {!BUILT_IN.has(category.id) ? (
                          <button type="button" className={styles.remove} onClick={() => void remove(category)}>
                            {t('prod.delete')}
                          </button>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {form ? (
        <CategoryDialog
          editing={form === 'new' ? null : form}
          onClose={() => setForm(null)}
          onDone={(category) => {
            const wasNew = form === 'new'
            setForm(null)
            push('success', t(wasNew ? 'cat.added' : 'cat.renamed', { name: category.name }))
            reload()
          }}
        />
      ) : null}

      <Toasts toasts={toasts} onDismiss={dismiss} />
    </div>
  )
}

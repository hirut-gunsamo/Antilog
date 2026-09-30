import { useEffect, useState } from 'react'

import { Card, Empty } from '../components/Card'
import { TypeDialog } from '../components/products/TypeDialog'
import { Toasts } from '../components/Toasts'
import { api } from '../lib/api'
import { useCategories } from '../lib/categories'
import { useT } from '../lib/i18n'
import { useToasts } from '../lib/toasts'
import type { TypeNode } from '../lib/types'
import base from './Products.module.css'
import styles from './Ibid.module.css'


/**
 * The types products are filed under: SIM types, phone brands and their
 * names, voucher types. Adding and removing them lives here, one step before
 * the products themselves.
 */
export default function ProductTypes() {
  const t = useT()
  const { toasts, push, dismiss } = useToasts()

  const [types, setTypes] = useState<TypeNode[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [reloadKey, setReloadKey] = useState(0)
  const [adding, setAdding] = useState<string | null>(null)
  const { categories } = useCategories()

  useEffect(() => {
    const controller = new AbortController()

    api<{ types: TypeNode[] }>('/api/product-types', { signal: controller.signal })
      .then((payload) => {
        setTypes(payload.types ?? [])
        setError(null)
      })
      .catch((caught: unknown) => {
        if (controller.signal.aborted) return
        setError(caught instanceof Error ? caught.message : 'Could not load.')
        setTypes([])
      })

    return () => controller.abort()
  }, [reloadKey])

  async function remove(node: TypeNode) {
    if (!window.confirm(t('prod.deleteTypeConfirm', { name: node.name }))) return

    try {
      await api(`/api/product-types/${node.id}`, { method: 'DELETE' })
      push('success', t('types.deleted', { name: node.name }))
      setReloadKey((n) => n + 1)
    } catch (caught) {
      push('error', caught instanceof Error ? caught.message : 'Failed.')
    }
  }

  const active = (list: TypeNode[]) => list.filter((node) => node.isActive)

  return (
    <div className={base.page}>
      <header className={base.head}>
        <div className={base.mobileHeading}>
          <h1 className={base.title}>{t('types.title')}</h1>
          <p className={base.subtitle}>{t('types.note')}</p>
        </div>
        <div className={base.headActions}>
          <button type="button" className={base.primary} onClick={() => setAdding(categories[0]?.id ?? '')}>
            + {t('prod.addType')}
          </button>
        </div>
      </header>

      {error ? <Empty>{error}</Empty> : null}

      {categories.map((category) => {
        const isPhone = category.kind === 'PHONE'
        const roots = active((types ?? []).filter((node) => node.categoryId === category.id))

        return (
          <Card key={category.id}>
            <div className={styles.filters}>
              <h2 className={styles.sectionTitle} style={{ margin: 0 }}>
                {category.name}
              </h2>
              <button
                type="button"
                className={base.secondary}
                style={{ marginLeft: 'auto' }}
                onClick={() => setAdding(category.id)}
              >
                + {t('prod.addType')}
              </button>
            </div>

            {types === null ? (
              <Empty>{t('common.loading')}</Empty>
            ) : roots.length === 0 ? (
              <Empty>{t('prod.noTypes')}</Empty>
            ) : (
              <div className={base.scroll}>
                <table className={base.table}>
                  <thead>
                    <tr>
                      <th scope="col">
                        {t(isPhone ? 'prod.brand' : 'prod.typeName')}
                      </th>
                      {isPhone ? <th scope="col">{t('prod.type')}</th> : null}
                      <th scope="col" className={base.actionsCol}>
                        {t('common.actions')}
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {roots.flatMap((root) => {
                      const children = active(root.children)

                      if (!isPhone || children.length === 0) {
                        return [
                          <tr key={root.id}>
                            <td className={base.strong} data-label={t('prod.typeName')}>
                              {root.name}
                            </td>
                            {isPhone ? <td>—</td> : null}
                            <td className={base.actionsCol}>
                              <button type="button" className={styles.remove} onClick={() => void remove(root)}>
                                {t('prod.delete')}
                              </button>
                            </td>
                          </tr>,
                        ]
                      }

                      return children.map((child, index) => (
                        <tr key={child.id}>
                          <td className={base.strong} data-label={t('prod.brand')}>
                            {index === 0 ? root.name : ''}
                          </td>
                          <td data-label={t('prod.type')}>{child.name}</td>
                          <td className={base.actionsCol}>
                            <button type="button" className={styles.remove} onClick={() => void remove(child)}>
                              {t('prod.delete')}
                            </button>
                          </td>
                        </tr>
                      ))
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        )
      })}

      {adding ? (
        <TypeDialog
          categoryId={adding}
          onClose={() => setAdding(null)}
          onDone={(type) => {
            setAdding(null)
            push('success', t('prod.typeSaved', { name: type.name }))
            setReloadKey((n) => n + 1)
          }}
        />
      ) : null}

      <Toasts toasts={toasts} onDismiss={dismiss} />
    </div>
  )
}

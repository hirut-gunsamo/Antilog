import { useState } from 'react'

import { useAuth } from '../../auth/context'
import { api } from '../../lib/api'
import { CATEGORY_KEY, count } from '../../lib/format'
import { useT } from '../../lib/i18n'
import type { StockRequest } from '../../lib/types'
import styles from './CategoryDecisions.module.css'

type RequestItem = StockRequest['items'][number]

/** The items of one category in a request, decided together. */
type ItemGroup = { key: string; name: string; units: number; items: RequestItem[] }

function groupByCategory(items: RequestItem[], t: ReturnType<typeof useT>): ItemGroup[] {
  const groups = new Map<string, ItemGroup>()

  for (const item of items) {
    const own = item.product.productCategory
    const key = own?.id ?? item.product.category
    const name =
      own?.name ??
      (CATEGORY_KEY[item.product.category]
        ? t(CATEGORY_KEY[item.product.category])
        : item.product.category)
    const group = groups.get(key) ?? { key, name, units: 0, items: [] }

    group.items.push(item)
    group.units += item.quantity
    groups.set(key, group)
  }

  for (const group of groups.values()) {
    group.items.sort((a, b) => a.product.name.localeCompare(b.product.name))
  }

  return [...groups.values()].sort((a, b) => a.name.localeCompare(b.name))
}

/**
 * A request's items by category (SIM cards, phones, airtime). The person it
 * was sent to approves or rejects each category, all of its items at the
 * quantities asked for; everyone else sees how each category was decided.
 */
export function CategoryDecisions({
  request,
  onDecided,
  onError,
}: {
  request: StockRequest
  onDecided: (updated: StockRequest, message: string) => void
  onError: (message: string) => void
}) {
  const t = useT()
  const { user } = useAuth()
  const [pending, setPending] = useState<string | null>(null)

  const canDecide = request.status === 'PENDING' && request.requestedTo?.id === user?.id
  const groups = groupByCategory(request.items, t)

  async function decide(group: ItemGroup, approve: boolean) {
    setPending(group.key)

    try {
      const payload = await api<{ request: StockRequest }>(
        `/api/requests/${request.id}/items/decide`,
        {
          method: 'PATCH',
          body: { itemIds: group.items.map((item) => item.id), approve },
        },
      )
      onDecided(
        payload.request,
        t(approve ? 'appr.itemApproved' : 'appr.itemRejected', {
          name: group.name,
          n: count(group.units),
        }),
      )
    } catch (caught) {
      onError(caught instanceof Error ? caught.message : t('appr.approveFailed'))
    } finally {
      setPending(null)
    }
  }

  return (
    <ul className={styles.groups} onClick={(event) => event.stopPropagation()}>
      {groups.map((group) => {
        const undecided = group.items.some((item) => item.approvedQuantity === null)
        const state = undecided
          ? request.status === 'PENDING'
            ? 'PENDING'
            : request.status === 'REJECTED'
              ? 'REJECTED'
              : 'OTHER'
          : group.items.some((item) => (item.approvedQuantity ?? 0) > 0)
            ? 'APPROVED'
            : 'REJECTED'

        return (
          <li key={group.key}>
            <span className={styles.name}>
              <strong>{group.name}</strong>
              {group.items.map((item) => (
                <span key={item.id} className={styles.item}>
                  {item.product.name} × <span className="tabular">{count(item.quantity)}</span>
                </span>
              ))}
            </span>

            {canDecide && undecided ? (
              <span className={styles.actions}>
                <button
                  type="button"
                  className={styles.approve}
                  disabled={pending !== null}
                  onClick={() => void decide(group, true)}
                >
                  {t('appr.approve')}
                </button>
                <button
                  type="button"
                  className={styles.reject}
                  disabled={pending !== null}
                  onClick={() => void decide(group, false)}
                >
                  {t('appr.reject')}
                </button>
              </span>
            ) : (
              <span className={styles.state} data-state={state}>
                {state === 'APPROVED'
                  ? t('appr.statusApproved')
                  : state === 'REJECTED'
                    ? t('appr.statusRejected')
                    : state === 'PENDING'
                      ? t('appr.statusPending')
                      : '—'}
              </span>
            )}
          </li>
        )
      })}
    </ul>
  )
}

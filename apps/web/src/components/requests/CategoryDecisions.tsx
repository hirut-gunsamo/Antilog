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

/** A tick box that can also show "some of these". */
function Tick({
  checked,
  partly = false,
  onChange,
  label,
}: {
  checked: boolean
  partly?: boolean
  onChange: (checked: boolean) => void
  label: string
}) {
  return (
    <input
      type="checkbox"
      className={styles.tick}
      checked={checked}
      aria-label={label}
      ref={(element) => {
        if (element) element.indeterminate = partly && !checked
      }}
      onChange={(event) => onChange(event.target.checked)}
    />
  )
}

/**
 * A request's items, listed one by one under their category (SIM cards,
 * phones, airtime). The person it was sent to approves or rejects each item,
 * or ticks several (or all) and decides them together; everyone else sees
 * how each item was decided.
 */
export function CategoryDecisions({
  request,
  onDecided,
  onError,
  readOnly = false,
}: {
  request: StockRequest
  onDecided: (updated: StockRequest, message: string) => void
  onError: (message: string) => void
  /** Show how each item stands without the buttons, as in a table cell. */
  readOnly?: boolean
}) {
  const t = useT()
  const { user } = useAuth()
  const [pending, setPending] = useState(false)
  const [ticked, setTicked] = useState<Set<string>>(() => new Set())

  const canDecide = !readOnly && request.status === 'PENDING' && request.requestedTo?.id === user?.id
  const groups = groupByCategory(request.items, t)
  const open = request.items.filter((item) => item.approvedQuantity === null)
  const openIds = open.map((item) => item.id)
  const chosen = open.filter((item) => ticked.has(item.id))

  function tick(ids: string[], on: boolean) {
    setTicked((current) => {
      const next = new Set(current)
      ids.forEach((id) => (on ? next.add(id) : next.delete(id)))
      return next
    })
  }

  async function decide(items: RequestItem[], approve: boolean) {
    if (items.length === 0) return
    setPending(true)

    try {
      const payload = await api<{ request: StockRequest }>(
        `/api/requests/${request.id}/items/decide`,
        {
          method: 'PATCH',
          body: { itemIds: items.map((item) => item.id), approve },
        },
      )
      setTicked(new Set())
      onDecided(
        payload.request,
        items.length === 1
          ? t(approve ? 'appr.itemApproved' : 'appr.itemRejected', {
              name: items[0].product.name,
              n: count(items[0].quantity),
            })
          : t(approve ? 'appr.itemsApproved' : 'appr.itemsRejected', { n: count(items.length) }),
      )
    } catch (caught) {
      onError(caught instanceof Error ? caught.message : t('appr.approveFailed'))
    } finally {
      setPending(false)
    }
  }

  const stateOf = (item: RequestItem) =>
    item.approvedQuantity === null
      ? request.status === 'PENDING'
        ? 'PENDING'
        : request.status === 'REJECTED'
          ? 'REJECTED'
          : 'OTHER'
      : item.approvedQuantity > 0
        ? 'APPROVED'
        : 'REJECTED'

  const showTicks = canDecide && open.length > 0

  return (
    <div className={styles.wrap} onClick={(event) => event.stopPropagation()}>
      {showTicks && open.length > 1 ? (
        <label className={styles.all}>
          <Tick
            checked={chosen.length === open.length}
            partly={chosen.length > 0}
            onChange={(on) => tick(openIds, on)}
            label={t('appr.selectAll')}
          />
          <span>{`${t('appr.selectAll')} (${count(open.length)})`}</span>
        </label>
      ) : null}

      <ul className={styles.groups}>
        {groups.map((group) => {
          const groupOpen = group.items.filter((item) => item.approvedQuantity === null)
          const groupTicked = groupOpen.filter((item) => ticked.has(item.id)).length

          return (
            <li key={group.key} className={styles.group}>
              <span className={styles.groupHead}>
                {showTicks && groupOpen.length > 0 ? (
                  <Tick
                    checked={groupTicked === groupOpen.length}
                    partly={groupTicked > 0}
                    onChange={(on) => tick(groupOpen.map((item) => item.id), on)}
                    label={group.name}
                  />
                ) : null}
                <strong>{group.name}</strong>
              </span>

              {group.items.map((item) => {
                const state = stateOf(item)
                const undecided = item.approvedQuantity === null

                return (
                  <div key={item.id} className={styles.line}>
                    <label className={styles.name}>
                      {showTicks && undecided ? (
                        <Tick
                          checked={ticked.has(item.id)}
                          onChange={(on) => tick([item.id], on)}
                          label={item.product.name}
                        />
                      ) : null}
                      <span>
                        {item.product.name} × <span className="tabular">{count(item.quantity)}</span>
                      </span>
                    </label>

                    {canDecide && undecided ? (
                      <span className={styles.actions}>
                        <button
                          type="button"
                          className={styles.approve}
                          disabled={pending}
                          onClick={() => void decide([item], true)}
                        >
                          {t('appr.approve')}
                        </button>
                        <button
                          type="button"
                          className={styles.reject}
                          disabled={pending}
                          onClick={() => void decide([item], false)}
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
                  </div>
                )
              })}
            </li>
          )
        })}
      </ul>

      {showTicks && chosen.length > 0 ? (
        <div className={styles.bulk}>
          <button
            type="button"
            className={styles.approve}
            disabled={pending}
            onClick={() => void decide(chosen, true)}
          >
            {t('appr.approveSelected', { n: count(chosen.length) })}
          </button>
          <button
            type="button"
            className={styles.reject}
            disabled={pending}
            onClick={() => void decide(chosen, false)}
          >
            {t('appr.rejectSelected', { n: count(chosen.length) })}
          </button>
        </div>
      ) : null}
    </div>
  )
}

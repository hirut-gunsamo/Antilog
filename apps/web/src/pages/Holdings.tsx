import { useEffect, useState } from 'react'

import { useAuth } from '../auth/context'
import { Card, Empty } from '../components/Card'
import { NewRequestDialog } from '../components/requests/NewRequestDialog'
import { Toasts } from '../components/Toasts'
import { api } from '../lib/api'
import { count } from '../lib/format'
import { useT } from '../lib/i18n'
import { useSettings } from '../lib/settings'
import { useToasts } from '../lib/toasts'
import type { Holding, StockRequestKind } from '../lib/types'
import styles from './Holdings.module.css'

/**
 * The branch's card sheet: what each seller took out this morning, what they
 * have sold since, and what they are still answerable for.
 *
 * A salesperson sees their own day and the two buttons that bracket it. A
 * supervisor sees every seller in the branch, which is how they know what the
 * evening count should come to before anyone counts it.
 */
export default function Holdings() {
  const { user } = useAuth()
  const t = useT()
  const { toasts, push, dismiss } = useToasts()

  const [rows, setRows] = useState<Holding[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [asking, setAsking] = useState<StockRequestKind | null>(null)

  const isSales = user?.role === 'SALES'

  // Bumped after a request is sent, so the page shows the new state without
  // the person having to reload it.
  const [reloadKey, setReloadKey] = useState(0)

  useEffect(() => {
    const controller = new AbortController()

    api<{ holdings: Holding[] }>('/api/inventory/holdings', {
      signal: controller.signal,
    })
      .then((payload) => {
        setRows(payload.holdings ?? [])
        setError(null)
      })
      .catch((caught: unknown) => {
        if (controller.signal.aborted) return
        setError(caught instanceof Error ? caught.message : 'Could not load.')
        setRows([])
      })

    return () => controller.abort()
  }, [reloadKey])

  const mine = isSales ? rows?.[0] : undefined
  const holdingNow = (rows ?? []).filter(
    (row) =>
      row.totals.remaining > 0 ||
      row.totals.issuedToday > 0 ||
      row.totals.soldToday > 0,
  )

  return (
    <div className={styles.page}>
      <header className={styles.head}>
        <div className={styles.mobileHeading}>
          <h1 className={styles.title}>{t('hold.title')}</h1>
          <p className={styles.subtitle}>
            {isSales ? t('hold.mine') : t('hold.note')}
          </p>
        </div>

        {isSales ? (
          <div className={styles.headActions}>
            <button
              type="button"
              className={styles.primary}
              onClick={() => setAsking('ISSUE')}
            >
              {t('hold.takeItems')}
            </button>
            <button
              type="button"
              className={styles.secondary}
              onClick={() => setAsking('RETURN')}
              disabled={(mine?.totals.remaining ?? 0) === 0}
            >
              {t('hold.handBack')}
            </button>
          </div>
        ) : null}
      </header>

      {error ? <Card><Empty>{error}</Empty></Card> : null}

      {rows === null ? (
        <Card>
          <Empty>{t('common.loading')}</Empty>
        </Card>
      ) : isSales ? (
        <Card title={t('hold.mine')}>
          <Totals totals={mine?.totals} />
          <Lines items={mine?.items ?? []} emptyKey="hold.nothing" />
        </Card>
      ) : holdingNow.length === 0 ? (
        <Card>
          <Empty>{t('hold.nobody')}</Empty>
        </Card>
      ) : (
        holdingNow.map((seller) => (
          <Card
            key={seller.id}
            title={seller.name}
            subtitle={seller.branch?.name ?? undefined}
          >
            <Totals totals={seller.totals} />
            <Lines items={seller.items} emptyKey="hold.nothing" />
          </Card>
        ))
      )}

      {asking ? (
        <NewRequestDialog
          kind={asking}
          onClose={() => setAsking(null)}
          onDone={(message) => {
            setAsking(null)
            push('success', `${message} ${t('hold.waiting')}`)
            setReloadKey((n) => n + 1)
          }}
        />
      ) : null}

      <Toasts toasts={toasts} onDismiss={dismiss} />
    </div>
  )
}

function Totals({
  totals,
}: {
  totals?: { issuedToday: number; soldToday: number; remaining: number }
}) {
  const t = useT()

  const cells = [
    { key: 'hold.issued' as const, value: totals?.issuedToday ?? 0 },
    { key: 'hold.sold' as const, value: totals?.soldToday ?? 0 },
    { key: 'hold.remaining' as const, value: totals?.remaining ?? 0 },
  ]

  return (
    <div className={styles.totals}>
      {cells.map((cell) => (
        <div key={cell.key}>
          <strong className="tabular">{count(cell.value)}</strong>
          <span>{t(cell.key)}</span>
        </div>
      ))}
    </div>
  )
}

function Lines({
  items,
  emptyKey,
}: {
  items: Holding['items']
  emptyKey: 'hold.nothing'
}) {
  const t = useT()
  const { settings } = useSettings()

  // The number that decides whether the next customer is served. Per category,
  // and set by the Owner rather than fixed here.
  const level: Record<string, number> = {
    SIM_CARD: settings.lowHoldingSim,
    PHONE: settings.lowHoldingPhone,
    AIRTIME_VOUCHER: settings.lowHoldingVoucher,
  }

  if (items.length === 0) return <Empty>{t(emptyKey)}</Empty>

  return (
    <div className={styles.scroll}>
      <table className={styles.table}>
        <thead>
          <tr>
            <th scope="col">{t('hold.product')}</th>
            <th scope="col">{t('hold.issued')}</th>
            <th scope="col">{t('hold.sold')}</th>
            <th scope="col">{t('hold.remaining')}</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => {
            const low =
              item.issuedToday > 0 &&
              item.remaining <= (level[item.product?.category ?? ''] ?? 0)

            return (
            <tr key={item.productId} data-low={low || undefined}>
              <td data-label={t('hold.product')} className={styles.strong}>
                {item.product?.name ?? item.productId}
              </td>
              <td data-label={t('hold.issued')} className="tabular">
                {count(item.issuedToday)}
              </td>
              <td data-label={t('hold.sold')} className="tabular">
                {count(item.soldToday)}
              </td>
              <td
                data-label={t('hold.remaining')}
                className={`${styles.strong} tabular`}
              >
                {count(item.remaining)}
                {low ? <em className={styles.lowTag}>{t('hold.low')}</em> : null}
              </td>
            </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'

import { api } from '../../lib/api'
import { count, currency, shortDate } from '../../lib/format'
import { useT } from '../../lib/i18n'
import { saleRef, STATUS_KEY } from '../../lib/sales'
import type {
  Dashboard,
  Holding,
  NationalIdSummary,
  Sale,
} from '../../lib/types'
import { Card, Empty } from '../Card'
import { StatCard } from '../StatCard'
import styles from './SalesDashboard.module.css'

/**
 * The salesperson's dashboard: their own day.
 *
 * Their day is a short list — take items out, sell them, take more if they run
 * out, hand back what is left, hand the cash to the supervisor, go home — so
 * this shows exactly those four figures and nothing about the branch's books.
 * Yadere is the supervisor's business: it only begins once the cash has been
 * handed over, and a salesperson carries nothing overnight.
 *
 * Every figure here is about this person, not the branch — the API already
 * scopes sales and cash to the signed-in user, so "Today's Sales" means theirs.
 * Low stock too: it lists the goods issued to them that are running low.
 */
export function SalesDashboard({ data }: { data: Dashboard }) {
  const t = useT()

  const [mySales, setMySales] = useState<Sale[] | null>(null)
  const [prints, setPrints] = useState<NationalIdSummary | null>(null)
  const [holding, setHolding] = useState<Holding | null>(null)

  useEffect(() => {
    const controller = new AbortController()

    // Both already scoped by the API: own sales, own branch's prints.
    Promise.all([
      api<{ sales: Sale[] }>('/api/sales?limit=6', { signal: controller.signal }).catch(
        () => ({ sales: [] as Sale[] }),
      ),
      api<{ summary: NationalIdSummary }>(
        '/api/national-id/summary?range=today',
        { signal: controller.signal },
      ).catch(() => ({ summary: null as NationalIdSummary | null })),
      api<{ holdings: Holding[] }>('/api/inventory/holdings', {
        signal: controller.signal,
      }).catch(() => ({ holdings: [] as Holding[] })),
    ]).then(([sales, summary, held]) => {
      if (controller.signal.aborted) return
      setMySales(sales.sales ?? [])
      setPrints(summary.summary)
      setHolding(held.holdings[0] ?? null)
    })

    return () => controller.abort()
  }, [])

  // Today's takings that have not yet reached the supervisor. Not yadere:
  // this is cleared before they go home, and anything the supervisor has not
  // banked by then is the supervisor's to carry.
  const toHandOver = data.cashPosition.totals.inHand

  const itemsToday = Object.values(data.today.byCategory).reduce(
    (sum, entry) => sum + entry.quantity,
    0,
  )

  const recent = (mySales ?? []).slice(0, 6)
  const lowStock = data.lowStock.slice(0, 5)

  return (
    <>
      <div className={styles.tiles}>
        <StatCard
          label={t('dash.todaysSales')}
          value={currency(data.today.revenue)}
          icon="cart"
          tone="green"
          to="/sales"
        />
        <StatCard
          label={t('sales.itemsSold')}
          value={count(itemsToday)}
          icon="box"
          tone="blue"
          to="/sales"
        />
        <StatCard
          label={t('cash.toHandOver')}
          value={currency(toHandOver)}
          icon="cash"
          tone="emerald"
          to="/sales"
        />
        <StatCard
          label={t('hold.remaining')}
          value={count(holding?.totals.remaining ?? 0)}
          icon="clipboard"
          tone="red"
          to="/holdings"
        />
      </div>

      <div className={styles.split}>
        <Card
          title={t('dash.myRecentSales')}
          subtitle={t('dash.myRecentNote')}
          action={
            <Link className={styles.viewAll} to="/sales">
              {t('common.viewAll')}
            </Link>
          }
        >
          {!mySales ? (
            <Empty>{t('common.loading')}</Empty>
          ) : recent.length === 0 ? (
            <Empty>{t('dash.noSalesYet')}</Empty>
          ) : (
            <ul className={styles.saleList}>
              {recent.map((sale) => (
                <li key={sale.id}>
                  <span className={styles.saleMain}>
                    <strong className="tabular">{saleRef(sale)}</strong>
                    <em>{shortDate(sale.saleDate)}</em>
                  </span>
                  <span
                    className={styles.saleState}
                    data-state={sale.status}
                  >
                    {t(STATUS_KEY[sale.status])}
                  </span>
                  <strong className={`${styles.saleTotal} tabular`}>
                    {currency(Number(sale.totalAmount))}
                  </strong>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <div className={styles.side}>
          <Card title={t('nid.dashTitle')} subtitle={t('nid.today')}>
            {!prints ? (
              <Empty>{t('common.loading')}</Empty>
            ) : (
              <div className={styles.prints}>
                <strong className="tabular">
                  {count(prints.today.total)}
                  <em>{t('nid.idsShort')}</em>
                </strong>
                <span>
                  {t('nid.splitOf', {
                    original: count(prints.today.original),
                    copy: count(prints.today.copy),
                  })}
                </span>
                <Link className={styles.viewAll} to="/national-id">
                  {t('common.viewAll')}
                </Link>
              </div>
            )}
          </Card>

          {/* The goods issued to this person that are running low. */}
          <Card
            title={t('dash.lowStock')}
            subtitle={t('hold.mine')}
            action={
              <Link className={styles.viewAll} to="/inventory">
                {t('common.viewAll')}
              </Link>
            }
          >
            {lowStock.length === 0 ? (
              <Empty>{t('dash.allAboveReorder')}</Empty>
            ) : (
              <ul className={styles.lowList}>
                {lowStock.map((row) => (
                  <li key={row.id}>
                    <span>{row.name}</span>
                    <strong className="tabular" data-out={row.quantity === 0}>
                      {count(row.quantity)}
                    </strong>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </div>
    </>
  )
}

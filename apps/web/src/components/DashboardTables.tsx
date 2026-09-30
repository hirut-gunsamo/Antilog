import { Link } from 'react-router-dom'

import { Empty } from './Card'
import { icons } from './icons'
import { count, currency } from '../lib/format'
import { useT, type TranslationKey } from '../lib/i18n'
import type { Dashboard } from '../lib/types'
import styles from './DashboardTables.module.css'

const CATEGORY_ICON: Record<string, keyof typeof icons> = {
  SIM_CARD: 'sim',
  PHONE: 'phone',
  AIRTIME_VOUCHER: 'ticket',
}

const CATEGORY_TONE: Record<string, string> = {
  SIM_CARD: 'brand',
  PHONE: 'info',
  AIRTIME_VOUCHER: 'success',
}

function Thumb({ category }: { category: string }) {
  const tone = CATEGORY_TONE[category] ?? 'grey'

  return (
    <span className={`${styles.thumb} ${styles[tone]}`} aria-hidden="true">
      <svg
        viewBox="0 0 24 24"
        width="17"
        height="17"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        {(icons[CATEGORY_ICON[category] ?? 'box'] as readonly string[]).map(
          (d, index) => (
            <path key={index} d={d} />
          ),
        )}
      </svg>
    </span>
  )
}

/* ---------- Top selling products ---------- */

export function TopProducts({ data }: { data: Dashboard }) {
  const t = useT()

  if (data.topProducts.length === 0) {
    return <Empty>{t('dash.noSalesYet')}</Empty>
  }

  return (
    <ul className={styles.list}>
      {data.topProducts.map((product) => (
        <li key={product.id}>
          <Link className={styles.row} to="/inventory">
            <Thumb category={product.category} />

            <span className={styles.main}>
              <strong>{product.name}</strong>
              <span>{currency(product.price)}</span>
            </span>

            <span className={styles.side}>
              <strong className="tabular">{count(product.units)} {t('dash.units')}</strong>
              <span className={styles.sharePill}>{product.sharePct}%</span>
            </span>
          </Link>
        </li>
      ))}
    </ul>
  )
}

/* ---------- Low stock ---------- */

export function LowStock({ data }: { data: Dashboard }) {
  const t = useT()

  if (data.lowStock.length === 0) {
    return <Empty>{t('dash.allAboveReorder')}</Empty>
  }

  return (
    <ul className={styles.list}>
      {data.lowStock.map((item) => {
        const out = item.quantity === 0

        return (
          <li key={item.id}>
            <Link className={styles.row} to="/inventory">
              <Thumb category={item.category} />

              <span className={styles.main}>
                <strong>{item.name}</strong>
                <span>
                  {item.branch} · {item.sku}
                </span>
              </span>

              <span className={styles.side}>
                <strong
                  className={`tabular ${out ? styles.outInk : styles.lowInk}`}
                >
                  {t('dash.left', { n: item.quantity })}
                </strong>
                <span className={out ? styles.badgeDanger : styles.badgeWarning}>
                  {out ? t('dash.outOfStock') : t('dash.low')}
                </span>
              </span>
            </Link>
          </li>
        )
      })}
    </ul>
  )
}

/* ---------- Recent sales ---------- */

const STATUS_STYLE: Record<string, string> = {
  APPROVED: 'badgeSuccess',
  SUBMITTED: 'badgeWarning',
  DRAFT: 'badgeNeutral',
  REJECTED: 'badgeDanger',
}

const STATUS_KEY: Record<string, TranslationKey> = {
  APPROVED: 'dash.completed',
  SUBMITTED: 'dash.processing',
  DRAFT: 'dash.pending',
  REJECTED: 'dash.cancelled',
}

export function RecentSales({
  data,
  showBranch,
}: {
  data: Dashboard
  showBranch: boolean
}) {
  const t = useT()

  if (data.recentSales.length === 0) {
    return <Empty>{t('dash.noSalesRecorded')}</Empty>
  }

  return (
    <ul className={styles.list}>
      {data.recentSales.map((sale) => (
        <li key={sale.id}>
          <Link className={styles.row} to="/sales">
            <Thumb category={sale.category} />

            <span className={styles.main}>
              <strong>{sale.summary}</strong>
              <span>
                {showBranch ? `${sale.branch} · ` : ''}
                {sale.salesperson}
              </span>
            </span>

            <span className={styles.side}>
              <strong className="tabular">{currency(sale.total)}</strong>
              <span
                className={styles[STATUS_STYLE[sale.status] ?? 'badgeNeutral']}
              >
                {STATUS_KEY[sale.status] ? t(STATUS_KEY[sale.status]) : sale.status}
              </span>
            </span>
          </Link>
        </li>
      ))}
    </ul>
  )
}

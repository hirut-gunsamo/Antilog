import { mixActivities } from '../../lib/activity'
import { count, currency, timeAgo } from '../../lib/format'
import { useT, type TranslationKey } from '../../lib/i18n'
import type { Activity } from '../../lib/types'
import { icons } from '../icons'
import styles from './RecentActivities.module.css'

type Look = { icon: keyof typeof icons; tone: string }

const LOOK: Record<Activity['kind'], Look> = {
  SALE: { icon: 'cart', tone: 'blue' },
  STOCK_IN: { icon: 'plus', tone: 'green' },
  TRANSFER: { icon: 'sync', tone: 'violet' },
  REQUEST: { icon: 'clipboard', tone: 'amber' },
  ADJUSTMENT: { icon: 'box', tone: 'grey' },
  LOSS: { icon: 'warning', tone: 'red' },
  OTHER: { icon: 'box', tone: 'grey' },
}

/** "+100" or "−195": a correction always says which way it went. */
function signed(n: number) {
  return `${n > 0 ? '+' : n < 0 ? '−' : ''}${count(Math.abs(n))}`
}

/**
 * The newest few things that happened, in the viewer's own scope, mixed so
 * each kind of news gets a line (see mixActivities).
 */
export function RecentActivities({
  items,
  limit = 4,
}: {
  items: Activity[]
  limit?: number
}) {
  const t = useT()

  if (items.length === 0) {
    return <p className={styles.empty}>{t('dash.noActivity')}</p>
  }

  // Everything below is built from facts, so it reads in either language.
  function describe(item: Activity): {
    title: string
    qty?: { text: string; dir: 'up' | 'down' }
    detail: string[]
  } {
    const where = item.branch ?? ''
    const by = item.by ? t('act.by', { name: item.by }) : ''

    switch (item.kind) {
      case 'SALE':
        return {
          title: `${t('act.SALE')} · ${currency(item.amount ?? 0)}`,
          detail: [t('act.units', { n: count(item.units ?? 0) }), where, by],
        }

      case 'STOCK_IN':
        return {
          title: t('act.STOCK_IN'),
          detail: [`${count(item.quantity ?? 0)} × ${item.product}`, where, by],
        }

      case 'TRANSFER':
        return {
          title: t('act.TRANSFER'),
          detail: [
            `${count(item.quantity ?? 0)} × ${item.product}`,
            `${item.from ?? '—'} → ${item.to ?? '—'}`,
          ],
        }

      case 'REQUEST':
        return {
          title: t(`act.REQUEST_${item.status ?? 'PENDING'}` as TranslationKey),
          detail: [t('act.units', { n: count(item.units ?? 0) }), where, by],
        }

      case 'ADJUSTMENT':
      case 'LOSS': {
        const q = item.quantity ?? 0

        const title =
          item.kind === 'LOSS'
            ? t(
                item.cause === 'DAMAGED'
                  ? 'act.LOSS_DAMAGED'
                  : item.cause === 'LOST'
                    ? 'act.LOSS_LOST'
                    : 'act.LOSS',
              )
            : item.cause === 'REVERSED'
              ? t('act.LOSS_REVERSED')
              : q === 0
                ? t('act.ROW_REMOVED')
                : t(q > 0 ? 'act.ADJUSTMENT_UP' : 'act.ADJUSTMENT_DOWN')

        return {
          title,
          qty: q === 0 ? undefined : { text: signed(q), dir: q > 0 ? 'up' : 'down' },
          detail: [
            `× ${item.product}`,
            // The balance it was corrected from and to, e.g. "216 → 21".
            item.before != null && item.after != null
              ? `${count(item.before)} → ${count(item.after)}`
              : '',
            where,
            by,
          ],
        }
      }

      default:
        return {
          title: t('act.OTHER'),
          detail: [`${count(item.quantity ?? 0)} × ${item.product}`, where, by],
        }
    }
  }

  return (
    <ul className={styles.list}>
      {mixActivities(items, limit).map((item) => {
        const look = LOOK[item.kind] ?? LOOK.OTHER
        const { title, qty, detail } = describe(item)

        return (
          <li key={`${item.kind}-${item.id}`}>
            <span className={styles.icon} data-tone={look.tone} aria-hidden="true">
              <svg
                viewBox="0 0 24 24"
                width="15"
                height="15"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                {icons[look.icon].map((d, index) => (
                  <path key={index} d={d} />
                ))}
              </svg>
            </span>

            <span className={styles.main}>
              <strong>{title}</strong>
              <em>
                {qty ? (
                  <b className={styles.qty} data-dir={qty.dir}>
                    {qty.text}{' '}
                  </b>
                ) : null}
                {detail.filter(Boolean).join(' · ')}
              </em>
              {/* Corrections and write-offs carry the person's own reason. */}
              {item.note && (item.kind === 'ADJUSTMENT' || item.kind === 'LOSS') ? (
                <small title={item.note}>
                  {t('act.reason', { text: item.note })}
                </small>
              ) : null}
            </span>

            <time className={styles.when} dateTime={item.at}>
              {timeAgo(item.at, t)}
            </time>
          </li>
        )
      })}
    </ul>
  )
}

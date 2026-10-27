import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'

import { api } from '../lib/api'
import { count, currency, shortDate } from '../lib/format'
import { useT, type TranslationKey } from '../lib/i18n'
import type { NationalIdSummary, NationalIdTotals } from '../lib/types'
import { Card, Empty } from './Card'
import { icons } from './icons'
import styles from './NationalIdCard.module.css'

type Period = 'today' | 'week' | 'month'

const PERIODS: { key: Period; labelKey: TranslationKey }[] = [
  { key: 'today', labelKey: 'nid.today' },
  { key: 'week', labelKey: 'nid.thisWeek' },
  { key: 'month', labelKey: 'nid.thisMonth' },
]

function Glyph({ name, size = 16 }: { name: keyof typeof icons; size?: number }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {icons[name].map((d, index) => (
        <path key={index} d={d} />
      ))}
    </svg>
  )
}

/** Original and copy as one bar, so the mix reads at a glance. */
function SplitBar({ totals }: { totals: NationalIdTotals }) {
  const whole = Math.max(totals.total, 1)

  return (
    <span className={styles.split} aria-hidden="true">
      <i
        className={styles.original}
        style={{ width: `${(totals.original / whole) * 100}%` }}
      />
      <i
        className={styles.copy}
        style={{ width: `${(totals.copy / whole) * 100}%` }}
      />
    </span>
  )
}

/**
 * National ID printing on the dashboard.
 *
 * The three periods sit side by side as tiles and double as the period
 * picker; the trend and the branch ranking below follow the chosen one.
 * Original and copy stay separate throughout, because they are separate
 * lines in the branch's books.
 *
 * Branch-scoped by the API, so a salesperson sees their own branch here and
 * the Owner sees every branch.
 */
export function NationalIdCard() {
  const t = useT()

  const [period, setPeriod] = useState<Period>('month')
  // One summary per period, fetched the first time it is chosen. The month
  // summary also carries the headline figures for all three tiles.
  const [summaries, setSummaries] = useState<
    Partial<Record<Period, NationalIdSummary>>
  >({})
  const [failed, setFailed] = useState(false)
  const [hover, setHover] = useState<number | null>(null)

  useEffect(() => {
    const wanted: Period[] = ['month', period]
    const missing = [...new Set(wanted)].filter((key) => !summaries[key])
    if (missing.length === 0) return

    const controller = new AbortController()

    Promise.all(
      missing.map((key) =>
        api<{ summary: NationalIdSummary }>(
          `/api/national-id/summary?range=${key}`,
          { signal: controller.signal },
        ).then((payload) => [key, payload.summary] as const),
      ),
    )
      .then((pairs) =>
        setSummaries((current) => ({ ...current, ...Object.fromEntries(pairs) })),
      )
      .catch(() => {
        if (!controller.signal.aborted) setFailed(true)
      })

    return () => controller.abort()
  }, [period, summaries])

  const month = summaries.month
  const selected = summaries[period]

  const header = {
    title: t('nid.dashTitle'),
    subtitle: t('nid.dashNote'),
    action: (
      <div className={styles.actions}>
        <Link className={styles.viewAll} to="/national-id">
          {t('common.viewAll')}
        </Link>
      </div>
    ),
  }

  if (failed) {
    return (
      <Card {...header}>
        <Empty>{t('nid.loadFailed')}</Empty>
      </Card>
    )
  }

  if (!month) {
    return (
      <Card {...header}>
        <div className={styles.skeleton} aria-busy="true">
          <span />
          <span />
          <span />
        </div>
      </Card>
    )
  }

  const tiles: Record<Period, NationalIdTotals> = {
    today: month.today,
    week: month.week,
    month: month.month,
  }

  // The month's days, with the chosen window picked out. "Today" is the last
  // day; "this week" the days since the week's start.
  const trend = month.trend
  const windowStart =
    period === 'month'
      ? trend[0]?.date
      : period === 'week'
        ? summaries.week?.from ?? trend[Math.max(0, trend.length - 7)]?.date
        : trend[trend.length - 1]?.date
  const peak = Math.max(...trend.map((day) => day.original + day.copy), 1)
  const hovered = hover != null ? trend[hover] : null

  const nothingThisMonth = month.month.total === 0

  return (
    <Card {...header}>
      <div className={styles.wrap}>
        {/* ---------- The three periods, which are also the picker ---------- */}
        <div className={styles.tiles} role="tablist" aria-label={t('nid.pickPeriod')}>
          {PERIODS.map(({ key, labelKey }) => {
            const totals = tiles[key]
            const active = key === period

            return (
              <button
                key={key}
                type="button"
                role="tab"
                aria-selected={active}
                className={styles.tile}
                data-active={active}
                onClick={() => setPeriod(key)}
              >
                <span className={styles.tileHead}>
                  <span>{t(labelKey)}</span>
                  <em>{currency(totals.revenue)}</em>
                </span>

                <strong className="tabular">
                  {count(totals.total)}
                  <small>{t('nid.idsShort')}</small>
                </strong>

                <SplitBar totals={totals} />

                <span className={styles.tileSplit}>
                  <span data-kind="original">
                    {t('nid.nOriginal', { n: count(totals.original) })}
                  </span>
                  <span data-kind="copy">
                    {t('nid.nCopy', { n: count(totals.copy) })}
                  </span>
                </span>
              </button>
            )
          })}
        </div>

        {nothingThisMonth ? (
          <div className={styles.empty}>
            <span className={styles.emptyIcon}>
              <Glyph name="ticket" size={22} />
            </span>
            <div>
              <strong>{t('nid.emptyTitle')}</strong>
              <p>{t('nid.emptyNote')}</p>
            </div>
            <Link className={styles.emptyAction} to="/national-id/original">
              {t('nido.titleOriginal')}
            </Link>
          </div>
        ) : (
          <div className={styles.panels}>
            {/* ---------- Daily trend, the chosen window highlighted ---------- */}
            <section className={styles.panel}>
              <header className={styles.panelHead}>
                <h3>{t('nid.dailyTrend')}</h3>
                <span className={styles.legend}>
                  <span data-kind="original">{t('nid.originalIds')}</span>
                  <span data-kind="copy">{t('nid.copyIds')}</span>
                </span>
              </header>

              <div className={styles.readout} aria-live="polite">
                {hovered ? (
                  <>
                    <strong>{shortDate(hovered.date)}</strong>
                    {t('nid.splitOf', {
                      original: count(hovered.original),
                      copy: count(hovered.copy),
                    })}
                  </>
                ) : (
                  <span>{t('nid.hoverDay')}</span>
                )}
              </div>

              <div className={styles.trend} onMouseLeave={() => setHover(null)}>
                {trend.map((day, index) => {
                  const inWindow = windowStart != null && day.date >= windowStart
                  const total = day.original + day.copy

                  return (
                    <div
                      key={day.date}
                      className={styles.day}
                      data-in={inWindow}
                      data-hover={hover === index}
                      onMouseEnter={() => setHover(index)}
                      onFocus={() => setHover(index)}
                      onBlur={() => setHover(null)}
                      tabIndex={0}
                      role="img"
                      aria-label={`${shortDate(day.date)}: ${t('nid.splitOf', {
                        original: count(day.original),
                        copy: count(day.copy),
                      })}`}
                    >
                      <span
                        className={styles.dayBar}
                        style={{ height: `${(total / peak) * 100}%` }}
                      >
                        <i
                          className={styles.copy}
                          style={{ flexGrow: day.copy }}
                        />
                        <i
                          className={styles.original}
                          style={{ flexGrow: day.original }}
                        />
                      </span>
                    </div>
                  )
                })}
              </div>

              <div className={styles.axis}>
                <span>{trend[0] ? shortDate(trend[0].date) : ''}</span>
                <span>
                  {trend.length ? shortDate(trend[trend.length - 1].date) : ''}
                </span>
              </div>
            </section>

            {/* ---------- Branches for the chosen period ---------- */}
            <section className={styles.panel}>
              <header className={styles.panelHead}>
                <h3>{t('nid.byBranch')}</h3>
                <span className={styles.panelNote}>
                  {t(PERIODS.find((p) => p.key === period)!.labelKey)}
                </span>
              </header>

              {!selected ? (
                <Empty>{t('common.loading')}</Empty>
              ) : selected.byBranch.length === 0 ? (
                <p className={styles.none}>{t('nid.nothingYet')}</p>
              ) : (
                <ol className={styles.branches}>
                  {selected.byBranch.map((branch, index) => {
                    const share = selected.totals.total
                      ? Math.round((branch.total / selected.totals.total) * 100)
                      : 0

                    return (
                      <li key={branch.locationId}>
                        <span className={styles.rank} data-first={index === 0}>
                          {index + 1}
                        </span>
                        <span className={styles.branchMain}>
                          <span className={styles.branchTop}>
                            <strong>{branch.name}</strong>
                            <span className="tabular">
                              {count(branch.total)} <em>{t('nid.idsShort')}</em>
                              <b>{share}%</b>
                            </span>
                          </span>
                          <SplitBar totals={branch} />
                          <span className={styles.branchFoot}>
                            <span>
                              {t('nid.splitOf', {
                                original: count(branch.original),
                                copy: count(branch.copy),
                              })}
                            </span>
                            <span>{currency(branch.revenue)}</span>
                          </span>
                        </span>
                      </li>
                    )
                  })}
                </ol>
              )}
            </section>
          </div>
        )}
      </div>
    </Card>
  )
}

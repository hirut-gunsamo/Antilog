import { useId, useState } from 'react'

import { compact, currency } from '../../lib/format'
import styles from './Charts.module.css'
import { useT } from '../../lib/i18n'

/* ---------------------------------------------------------------------------
   Column chart - magnitude over time.

   Marks are thin with 4px rounded tops anchored to the baseline; the grid is
   recessive; only the hovered column is labelled, so there is never a number
   on every bar.
   --------------------------------------------------------------------------- */

export type Column = {
  key: string
  label: string
  value: number
}

export function ColumnChart({
  data,
  height = 200,
  color = 'var(--series-1)',
  valueFormat = (value: number) => currency(value),
  compactOnPhone = false,
}: {
  data: Column[]
  height?: number
  color?: string
  valueFormat?: (value: number) => string
  /** On phones, shrink to a short strip of bars with no axes, as in the design. */
  compactOnPhone?: boolean
}) {
  const [hover, setHover] = useState<number | null>(null)
  const clipId = useId()
  const t = useT()

  if (data.length === 0) {
    return <p className={styles.empty}>{t('dash.noSalesYet')}</p>
  }

  const max = Math.max(...data.map((d) => d.value), 1)
  const ticks = [0, 0.5, 1].map((fraction) => max * fraction)

  return (
    <div className={styles.wrap} data-compact={compactOnPhone || undefined}>
      <div className={styles.plot} style={{ height }}>
        {/* Recessive gridlines, drawn behind the marks */}
        {ticks.map((tick) => (
          <div
            key={tick}
            className={styles.gridline}
            style={{ bottom: `${(tick / max) * 100}%` }}
          >
            <span className={styles.tick}>{compact(tick)}</span>
          </div>
        ))}

        <div className={styles.columns}>
          {data.map((point, index) => {
            const pct = (point.value / max) * 100
            const active = hover === index

            return (
              <div
                key={point.key}
                className={styles.columnSlot}
                onMouseEnter={() => setHover(index)}
                onMouseLeave={() => setHover(null)}
                onFocus={() => setHover(index)}
                onBlur={() => setHover(null)}
                tabIndex={0}
                role="img"
                aria-label={`${point.label}: ${valueFormat(point.value)}`}
              >
                {active ? (
                  <div className={styles.tooltip} role="tooltip">
                    <strong>{valueFormat(point.value)}</strong>
                    <span>{point.label}</span>
                  </div>
                ) : null}

                <div
                  className={styles.column}
                  style={{
                    height: `${Math.max(pct, point.value > 0 ? 2 : 0)}%`,
                    background: color,
                    opacity: hover === null || active ? 1 : 0.45,
                  }}
                />
              </div>
            )
          })}
        </div>
        <svg width="0" height="0" aria-hidden="true">
          <clipPath id={clipId} />
        </svg>
      </div>

      <div className={styles.xAxis}>
        {data.map((point, index) => {
          // Every label on a month of days overlaps into a smear; name about
          // eight of them, always including the last.
          const step = Math.max(1, Math.ceil(data.length / 8))
          const shown = index % step === 0 || index === data.length - 1

          return (
            <span key={point.key} className={styles.xLabel}>
              {shown ? point.label : ''}
            </span>
          )
        })}
      </div>
    </div>
  )
}

/* ---------------------------------------------------------------------------
   Horizontal bars - ranking and part-to-whole comparisons.

   Every bar is directly labelled with its value. That is also the contrast
   relief the palette validator asks for: one of the light-mode series steps
   sits below 3:1 on the surface, so identity must never rest on the colour
   alone.
   --------------------------------------------------------------------------- */

export type Bar = {
  key: string
  label: string
  value: number
  color?: string
  note?: string
}

export function BarList({
  data,
  valueFormat = (value: number) => currency(value),
  emptyMessage = 'Nothing to show yet.',
}: {
  data: Bar[]
  valueFormat?: (value: number) => string
  emptyMessage?: string
}) {
  if (data.length === 0) {
    return <p className={styles.empty}>{emptyMessage}</p>
  }

  const max = Math.max(...data.map((d) => d.value), 1)

  return (
    <ul className={styles.bars}>
      {data.map((bar) => (
        <li key={bar.key} className={styles.barRow}>
          <div className={styles.barHead}>
            <span className={styles.barLabel}>
              <i
                className={styles.swatch}
                style={{ background: bar.color ?? 'var(--series-1)' }}
                aria-hidden="true"
              />
              {bar.label}
            </span>
            <span className={`${styles.barValue} tabular`}>
              {valueFormat(bar.value)}
            </span>
          </div>

          <div className={styles.barTrack}>
            <div
              className={styles.barFill}
              style={{
                width: `${Math.max((bar.value / max) * 100, bar.value > 0 ? 1.5 : 0)}%`,
                background: bar.color ?? 'var(--series-1)',
              }}
            />
          </div>

          {bar.note ? <span className={styles.barNote}>{bar.note}</span> : null}
        </li>
      ))}
    </ul>
  )
}

/* ---------------------------------------------------------------------------
   Legend - always present for two or more series, so identity is never
   carried by colour alone.
   --------------------------------------------------------------------------- */

export function Legend({
  items,
}: {
  items: { label: string; color: string }[]
}) {
  return (
    <ul className={styles.legend}>
      {items.map((item) => (
        <li key={item.label}>
          <i
            className={styles.swatch}
            style={{ background: item.color }}
            aria-hidden="true"
          />
          {item.label}
        </li>
      ))}
    </ul>
  )
}

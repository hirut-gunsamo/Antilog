import { count } from '../../lib/format'
import styles from './Donut.module.css'

export type Slice = {
  key: string
  label: string
  value: number
  color: string
}

// Ring chart with the total in the hole and a value-bearing legend beside it.
// Every slice is named and numbered in the legend, so identity never rests on
// the colour alone - which is also the contrast relief the palette needs.
export function Donut({
  slices,
  totalLabel = 'Total Items',
  size = 168,
}: {
  slices: Slice[]
  totalLabel?: string
  size?: number
}) {
  const total = slices.reduce((sum, slice) => sum + slice.value, 0)

  const stroke = 22
  const radius = (size - stroke) / 2
  const circumference = 2 * Math.PI * radius

  // 2px of surface between adjacent arcs, expressed in path length.
  const gap = total > 0 ? Math.min(6, circumference * 0.012) : 0

  let offset = 0

  return (
    <div className={styles.wrap}>
      <div className={styles.ring} style={{ width: size, height: size }}>
        <svg width={size} height={size} role="img" aria-label={`${totalLabel}: ${count(total)}`}>
          <g transform={`rotate(-90 ${size / 2} ${size / 2})`}>
            <circle
              cx={size / 2}
              cy={size / 2}
              r={radius}
              fill="none"
              stroke="var(--surface-2)"
              strokeWidth={stroke}
            />

            {total > 0
              ? slices.map((slice) => {
                  const fraction = slice.value / total
                  const length = Math.max(fraction * circumference - gap, 0)
                  const dash = `${length} ${circumference - length}`
                  const element = (
                    <circle
                      key={slice.key}
                      cx={size / 2}
                      cy={size / 2}
                      r={radius}
                      fill="none"
                      stroke={slice.color}
                      strokeWidth={stroke}
                      strokeDasharray={dash}
                      strokeDashoffset={-offset}
                      strokeLinecap="butt"
                    >
                      <title>
                        {slice.label}: {count(slice.value)}
                      </title>
                    </circle>
                  )

                  offset += fraction * circumference

                  return element
                })
              : null}
          </g>
        </svg>

        <div className={styles.hole}>
          <strong className="tabular">{count(total)}</strong>
          <span>{totalLabel}</span>
        </div>
      </div>

      <ul className={styles.legend}>
        {slices.map((slice) => (
          <li key={slice.key}>
            <i style={{ background: slice.color }} aria-hidden="true" />
            <span className={styles.legendLabel}>{slice.label}</span>
            <strong className="tabular">{count(slice.value)}</strong>
          </li>
        ))}
      </ul>
    </div>
  )
}

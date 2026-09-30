import { Link } from 'react-router-dom'

import styles from './MiniStat.module.css'

// The second row of the InApp layout: a figure, its month-on-month movement,
// and a link through to the detail.
export function MiniStat({
  label,
  value,
  changePct,
  to,
  linkLabel = 'View',
}: {
  label: string
  value: string
  changePct?: number
  to: string
  linkLabel?: string
}) {
  const up = (changePct ?? 0) >= 0

  return (
    <div className={styles.card}>
      <div className={styles.body}>
        <span className={styles.label}>{label}</span>
        <strong className={styles.value}>{value}</strong>

        {changePct === undefined ? null : (
          <span className={styles.delta}>
            <em className={up ? styles.up : styles.down}>
              {up ? '↑' : '↓'} {Math.abs(changePct)}%
            </em>
            vs Last Month
          </span>
        )}
      </div>

      <Link className={styles.link} to={to}>
        {linkLabel}
      </Link>
    </div>
  )
}

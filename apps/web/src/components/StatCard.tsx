import { Link } from 'react-router-dom'

import { icons } from './icons'
import styles from './StatCard.module.css'

export type Tone = 'green' | 'blue' | 'red' | 'emerald'

// Card structure:
//   left   label, figure and month-on-month delta, stacked
//   right  the icon, on a solid tile in the card's colour
//
// The delta carries an arrow as well as colour, so direction is never
// signalled by colour alone.
export function StatCard({
  label,
  value,
  changePct,
  icon,
  tone,
  to,
}: {
  label: string
  value: string
  changePct?: number
  icon: keyof typeof icons
  tone: Tone
  /** Where the figure comes from. Given one, the card becomes a link. */
  to?: string
}) {
  const up = (changePct ?? 0) >= 0

  const body = (
    <>
      <span className={styles.text}>
        <span className={styles.label}>{label}</span>
        <strong className={styles.value}>{value}</strong>

        {changePct === undefined ? null : (
          <span className={styles.delta}>
            <em className={up ? styles.up : styles.down}>
              <svg
                viewBox="0 0 24 24"
                width="13"
                height="13"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.6"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                {up ? (
                  <>
                    <path d="M12 19V5" />
                    <path d="m5 12 7-7 7 7" />
                  </>
                ) : (
                  <>
                    <path d="M12 5v14" />
                    <path d="m19 12-7 7-7-7" />
                  </>
                )}
              </svg>
              {Math.abs(changePct)}%
            </em>
            <span className={styles.deltaNote}>from last month</span>
          </span>
        )}
      </span>

      <span className={styles.plate} aria-hidden="true">
        {/* Size is driven by CSS so it can step down at each breakpoint. */}
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          {icons[icon].map((d, index) => (
            <path key={index} d={d} />
          ))}
        </svg>
      </span>
    </>
  )

  const className = `${styles.card} ${styles[tone]}`

  // A card that leads somewhere says so by being a link, which also gets
  // keyboard focus and the right cursor for free.
  return to ? (
    <Link className={`${className} ${styles.clickable}`} to={to}>
      {body}
    </Link>
  ) : (
    <div className={className}>{body}</div>
  )
}

import type { ReactNode } from 'react'

import styles from './Card.module.css'

export function Card({
  title,
  subtitle,
  action,
  children,
  className,
  fill,
}: {
  title?: string
  subtitle?: string
  action?: ReactNode
  children: ReactNode
  className?: string
  /** Stretch to the height of the grid row and let the body absorb the slack. */
  fill?: boolean
}) {
  const classes = [styles.card, fill ? styles.fill : '', className]
    .filter(Boolean)
    .join(' ')

  return (
    <section className={classes}>
      {title ? (
        <header className={styles.head}>
          <div>
            <h2 className={styles.title}>{title}</h2>
            {subtitle ? <p className={styles.subtitle}>{subtitle}</p> : null}
          </div>
          {action}
        </header>
      ) : null}

      <div className={fill ? styles.bodyFill : styles.body}>{children}</div>
    </section>
  )
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className={styles.empty}>{children}</p>
}

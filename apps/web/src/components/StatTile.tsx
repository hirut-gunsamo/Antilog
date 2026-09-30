import styles from './StatTile.module.css'

// A headline number needs no plot. The optional sparkline-free "foot" carries
// the supporting count so the figure itself stays uncluttered.
export function StatTile({
  label,
  value,
  foot,
  accent,
  tone,
}: {
  label: string
  value: string
  foot?: string
  accent?: string
  tone?: 'good' | 'warning' | 'critical'
}) {
  return (
    <div
      className={styles.tile}
      style={accent ? ({ '--tile-accent': accent } as React.CSSProperties) : undefined}
    >
      <span className={styles.label}>{label}</span>
      <strong
        className={tone ? `${styles.value} ${styles[tone]}` : styles.value}
      >
        {value}
      </strong>
      {foot ? <span className={styles.foot}>{foot}</span> : null}
    </div>
  )
}

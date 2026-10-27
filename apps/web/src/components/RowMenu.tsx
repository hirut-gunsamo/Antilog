import styles from './RowMenu.module.css'

/**
 * A row's actions as plain text buttons side by side: Edit in green, Delete
 * (and other destructive actions) in red. No hidden ⋯ menu to discover.
 */
export function RowMenu({
  label,
  items,
}: {
  /** What the actions are for, read out by screen readers. */
  label: string
  items: { label: string; onClick: () => void; danger?: boolean; disabled?: boolean }[]
}) {
  if (items.length === 0) return null

  return (
    <div className={styles.actions} role="group" aria-label={label}>
      {items.map((item) => (
        <button
          key={item.label}
          type="button"
          className={item.danger ? styles.danger : styles.action}
          disabled={item.disabled}
          onClick={(event) => {
            event.stopPropagation()
            item.onClick()
          }}
        >
          {item.label}
        </button>
      ))}
    </div>
  )
}

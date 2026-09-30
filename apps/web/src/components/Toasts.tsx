import { useEffect } from 'react'
import { Link } from 'react-router-dom'

import type { Toast } from '../lib/toasts'
import { icons } from './icons'
import styles from './Toasts.module.css'
import { useT } from '../lib/i18n'

const DISMISS_AFTER = 4500
// News the person did not cause needs longer to notice and read.
const INFO_DISMISS_AFTER = 9000

function ToastRow({
  toast,
  onDismiss,
}: {
  toast: Toast
  onDismiss: (id: number) => void
}) {
  const t = useT()

  useEffect(() => {
    const timer = window.setTimeout(
      () => onDismiss(toast.id),
      toast.kind === 'info' ? INFO_DISMISS_AFTER : DISMISS_AFTER,
    )
    return () => window.clearTimeout(timer)
  }, [toast.id, toast.kind, onDismiss])

  return (
    <div className={styles.toast} data-kind={toast.kind}>
      <span className={styles.mark} aria-hidden="true">
        {toast.kind === 'info' ? (
          <svg
            viewBox="0 0 24 24"
            width="15"
            height="15"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            {icons.bell.map((d, index) => (
              <path key={index} d={d} />
            ))}
          </svg>
        ) : toast.kind === 'success' ? (
          <svg viewBox="0 0 24 24" width="15" height="15" fill="none">
            <path
              d="m5 12.5 4.5 4.5L19 7.5"
              stroke="currentColor"
              strokeWidth="2.4"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        ) : (
          <svg viewBox="0 0 24 24" width="15" height="15" fill="none">
            <path
              d="M12 8v5M12 16.5v.01"
              stroke="currentColor"
              strokeWidth="2.4"
              strokeLinecap="round"
            />
            <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2" />
          </svg>
        )}
      </span>

      {toast.href ? (
        <Link className={styles.text} to={toast.href} onClick={() => onDismiss(toast.id)}>
          {toast.text}
        </Link>
      ) : (
        <p className={styles.text}>{toast.text}</p>
      )}

      <button
        type="button"
        onClick={() => onDismiss(toast.id)}
        aria-label={t('common.dismiss')}
      >
        ✕
      </button>
    </div>
  )
}

export function Toasts({
  toasts,
  onDismiss,
  placement = 'bottom',
}: {
  toasts: Toast[]
  onDismiss: (id: number) => void
  /** 'top' sits under the header, near the bell, clear of page toasts. */
  placement?: 'top' | 'bottom'
}) {
  return (
    // aria-live so the confirmation is announced, not just shown.
    <div
      className={styles.stack}
      data-placement={placement}
      role="status"
      aria-live="polite"
    >
      {toasts.map((toast) => (
        <ToastRow key={toast.id} toast={toast} onDismiss={onDismiss} />
      ))}
    </div>
  )
}

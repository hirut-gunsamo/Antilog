import { useEffect } from 'react'

import { useT } from '../lib/i18n'
import { useSync } from '../lib/sync'
import styles from './inventory/Panel.module.css'

/**
 * Asks before signing out, so a mis-tap does not end the session.
 *
 * Also warns when changes made offline are still waiting to be sent: signing
 * out does not send them, and the next person on the device would not see
 * whose they were.
 */
export function SignOutDialog({
  onConfirm,
  onClose,
}: {
  onConfirm: () => void
  onClose: () => void
}) {
  const t = useT()
  const { outbox } = useSync()

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose()
    }

    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className={styles.scrim} onClick={onClose}>
      <aside
        className={styles.panel}
        role="alertdialog"
        aria-modal="true"
        aria-label={t('shell.signOutTitle')}
        onClick={(event) => event.stopPropagation()}
      >
        <header className={styles.head}>
          <div>
            <h2>{t('shell.signOutTitle')}</h2>
            <p>{t('shell.signOutNote')}</p>
          </div>
          <button type="button" onClick={onClose} aria-label={t('common.close')}>
            ✕
          </button>
        </header>

        <div className={styles.body}>
          {outbox.length > 0 ? (
            <p className={styles.blocked}>
              {t('shell.signOutPending', { n: outbox.length })}
            </p>
          ) : null}

          <div className={styles.actions}>
            <button
              type="button"
              className={styles.cancel}
              onClick={onClose}
              autoFocus
            >
              {t('shell.signOutCancel')}
            </button>
            <button type="button" className={styles.danger} onClick={onConfirm}>
              {t('shell.signOut')}
            </button>
          </div>
        </div>
      </aside>
    </div>
  )
}

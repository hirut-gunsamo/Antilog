import { useT } from '../lib/i18n'
import { applyUpdate, usePwa } from '../lib/pwa'
import { useSync } from '../lib/sync'
import styles from './AppStatus.module.css'

/**
 * Thin strips above the page for the two states that affect everything on
 * it: no connection, and a new version waiting.
 */
export function AppStatus() {
  const t = useT()
  const { online, outbox } = useSync()
  const { updateReady } = usePwa()

  return (
    <>
      {!online ? (
        <div className={styles.bar} data-tone="offline" role="status">
          <strong>{t('pwa.offline')}</strong>
          <span>
            {outbox.length > 0
              ? t('pwa.offlineQueued', { n: outbox.length })
              : t('pwa.offlineNote')}
          </span>
        </div>
      ) : null}

      {updateReady ? (
        <div className={styles.bar} data-tone="update" role="status">
          <strong>{t('pwa.updateReady')}</strong>
          <button type="button" onClick={applyUpdate}>
            {t('pwa.reload')}
          </button>
        </div>
      ) : null}
    </>
  )
}

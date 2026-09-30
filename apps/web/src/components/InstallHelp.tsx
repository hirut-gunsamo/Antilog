import { useEffect } from 'react'

import { useT, type TranslationKey } from '../lib/i18n'
import styles from './InstallHelp.module.css'

/**
 * Shown when the browser has no install dialog a page can trigger: always on
 * iPhone and iPad, and on Android whenever Chrome withholds its prompt (it
 * never offers one on a plain-http address, or after the person dismissed it).
 * Walks them through the browser's own menu instead.
 */
export function InstallHelp({
  platform,
  onClose,
}: {
  platform: 'ios' | 'android' | 'desktop'
  onClose: () => void
}) {
  const t = useT()

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose()
    }

    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  return (
    <div className={styles.scrim} onClick={onClose}>
      <div
        className={styles.panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby="install-help-title"
        onClick={(event) => event.stopPropagation()}
      >
        {platform === 'ios' ? (
          <>
            <h2 id="install-help-title">{t('pwa.iosTitle')}</h2>

            <ol>
              <li>{t('pwa.iosStep1')}</li>
              <li>{t('pwa.iosStep2')}</li>
              <li>{t('pwa.iosStep3')}</li>
            </ol>

            <p>{t('pwa.iosSafari')}</p>
          </>
        ) : (
          <>
            <h2 id="install-help-title">
              {t(
                (platform === 'android'
                  ? 'pwa.androidTitle'
                  : 'pwa.installDesktopTitle') as TranslationKey,
              )}
            </h2>

            <ol>
              {[1, 2, 3].map((step) => (
                <li key={step}>
                  {t(
                    (platform === 'android'
                      ? `pwa.androidStep${step}`
                      : `pwa.installDesktop${step}`) as TranslationKey,
                  )}
                </li>
              ))}
            </ol>

            <p>
              {t(
                (platform === 'android'
                  ? 'pwa.androidNote'
                  : 'pwa.installDesktopNote') as TranslationKey,
              )}
            </p>
          </>
        )}

        <button type="button" onClick={onClose}>
          {t('pwa.gotIt')}
        </button>
      </div>
    </div>
  )
}

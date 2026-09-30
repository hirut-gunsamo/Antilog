import { useEffect } from 'react'

import { useT, type TranslationKey } from '../lib/i18n'
import styles from './InstallHelp.module.css'

/**
 * How to take the app off a phone.
 *
 * A web app cannot remove itself — only the person can, from the home screen
 * — so this explains where, rather than offering a button that could not
 * work. Worth having beside Install: staff change phones.
 */
export function RemoveAppHelp({
  platform,
  onClose,
}: {
  platform: 'ios' | 'android' | 'desktop'
  onClose: () => void
}) {
  const t = useT()

  const step =
    platform === 'ios' ? 'Ios' : platform === 'android' ? 'Android' : 'Desktop'

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
        aria-labelledby="remove-help-title"
        onClick={(event) => event.stopPropagation()}
      >
        <h2 id="remove-help-title">{t('pwa.removeTitle')}</h2>

        <ol>
          <li>{t(`pwa.remove${step}1` as TranslationKey)}</li>
          <li>{t(`pwa.remove${step}2` as TranslationKey)}</li>
          <li>{t(`pwa.remove${step}3` as TranslationKey)}</li>
        </ol>

        <p>{t('pwa.removeNote')}</p>

        <button type="button" onClick={onClose}>
          {t('pwa.gotIt')}
        </button>
      </div>
    </div>
  )
}

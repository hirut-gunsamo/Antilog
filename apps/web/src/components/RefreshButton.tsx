import { useState } from 'react'

import { useT } from '../lib/i18n'
import { refreshApp, usePwa } from '../lib/pwa'
import { icons } from './icons'
import styles from './ThemeToggle.module.css'

/**
 * One tap to get the newest of everything: a new version of the app if one
 * is out (a dot shows when it is), otherwise just the latest data.
 */
export function RefreshButton() {
  const t = useT()
  const { updateReady } = usePwa()
  const [busy, setBusy] = useState(false)

  return (
    <div className={styles.wrap}>
      <button
        type="button"
        className={styles.button}
        onClick={() => {
          setBusy(true)
          void refreshApp()
        }}
        disabled={busy}
        aria-label={t(updateReady ? 'pwa.refreshUpdate' : 'pwa.refresh')}
        title={t(updateReady ? 'pwa.refreshUpdate' : 'pwa.refresh')}
      >
        <svg
          viewBox="0 0 24 24"
          width={17}
          height={17}
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
          style={busy ? { animation: 'spin 0.8s linear infinite' } : undefined}
        >
          {icons.sync.map((d, index) => (
            <path key={index} d={d} />
          ))}
        </svg>
      </button>
      {updateReady ? <span className={styles.dot} aria-hidden="true" /> : null}
    </div>
  )
}

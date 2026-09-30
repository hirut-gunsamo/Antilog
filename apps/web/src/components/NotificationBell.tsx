import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'

import { count } from '../lib/format'
import { useT, type TranslationKey } from '../lib/i18n'
import { disablePush, enablePush, usePushStatus } from '../lib/push'
import type { Notifications } from '../lib/types'
import { icons } from './icons'
import styles from './NotificationBell.module.css'

function BellIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width={20}
      height={20}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {icons.bell.map((d, index) => (
        <path key={index} d={d} />
      ))}
    </svg>
  )
}

/**
 * The header bell. The badge counts only things that need a decision from
 * this person; warnings such as low stock are listed in the panel but do not
 * light the badge, so a shelf that stays low does not nag forever.
 */
export function NotificationBell({ data }: { data: Notifications | null }) {
  const t = useT()

  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return

    function onPointerDown(event: MouseEvent) {
      if (!ref.current?.contains(event.target as Node)) setOpen(false)
    }

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') setOpen(false)
    }

    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)

    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  const items = data?.notifications ?? []
  const badge = data?.actionCount ?? 0

  // Phone notifications (Android): the switch at the foot of the list.
  const push = usePushStatus()
  const [pushBusy, setPushBusy] = useState(false)
  const [pushError, setPushError] = useState<string | null>(null)

  async function togglePush() {
    setPushBusy(true)
    setPushError(null)
    try {
      if (push.status === 'on') await disablePush()
      else await enablePush()
    } catch (caught) {
      setPushError(caught instanceof Error ? caught.message : 'Failed.')
    } finally {
      setPushBusy(false)
      push.refresh()
    }
  }

  // The number on the installed app's icon follows the bell while the app is
  // open; with it closed, the pushes keep it up to date.
  useEffect(() => {
    if (!data || !('setAppBadge' in navigator)) return
    const nav = navigator as Navigator & {
      setAppBadge: (n: number) => Promise<void>
      clearAppBadge: () => Promise<void>
    }
    void (badge > 0 ? nav.setAppBadge(badge) : nav.clearAppBadge()).catch(() => {})
  }, [data, badge])

  return (
    <div className={styles.wrap} ref={ref}>
      <button
        className={styles.bell}
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-haspopup="true"
        aria-label={
          badge > 0
            ? t('notif.bellLabel', { n: count(badge) })
            : t('shell.notifications')
        }
      >
        <BellIcon />
        {badge > 0 ? (
          <span className={styles.badge} aria-hidden="true">
            {badge > 99 ? '99+' : badge}
          </span>
        ) : null}
      </button>

      {open ? (
        <div className={styles.panel}>
          <div className={styles.head}>{t('shell.notifications')}</div>

          {!data ? (
            <p className={styles.empty}>{t('common.loading')}</p>
          ) : items.length === 0 ? (
            <p className={styles.empty}>{t('notif.allClear')}</p>
          ) : (
            <ul className={styles.list}>
              {items.map((item) => (
                <li key={item.kind}>
                  <Link
                    className={styles.item}
                    data-tone={item.tone}
                    to={item.href}
                    onClick={() => setOpen(false)}
                  >
                    <i className={styles.marker} aria-hidden="true" />
                    <span>
                      <strong>
                        {t(`notif.${item.kind}` as TranslationKey, {
                          n: count(item.count),
                        })}
                      </strong>
                      {item.sample.length > 0 ? (
                        <em>{item.sample.join(', ')}</em>
                      ) : null}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}

          {push.status !== 'unavailable' ? (
            <div className={styles.pushRow}>
              <span>
                <strong>{t('notif.phone')}</strong>
                <em>
                  {t(
                    push.status === 'on'
                      ? 'notif.phoneOn'
                      : push.status === 'blocked'
                        ? 'notif.phoneBlocked'
                        : 'notif.phoneOff',
                  )}
                </em>
                {pushError ? <em className={styles.pushError}>{pushError}</em> : null}
              </span>
              {push.status !== 'blocked' ? (
                <button
                  type="button"
                  className={styles.pushButton}
                  data-on={push.status === 'on' || undefined}
                  onClick={() => void togglePush()}
                  disabled={pushBusy}
                >
                  {t(push.status === 'on' ? 'notif.turnOff' : 'notif.turnOn')}
                </button>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}

import { useEffect, useState } from 'react'

import { api } from './api'

/*
 * Phone notifications, Android only.
 *
 * The phone is registered with the server once, from the bell menu; after that
 * the server pushes new work to it with the app closed (see sw.js). iPhone is
 * deliberately left out.
 */

export type PushStatus =
  /** Not offered here: not Android, no worker, server not set up, or the role. */
  | 'unavailable'
  /** The person blocked notifications for this site in the browser. */
  | 'blocked'
  | 'off'
  | 'on'

function isAndroid() {
  return typeof navigator !== 'undefined' && /android/i.test(navigator.userAgent)
}

function supported() {
  return (
    isAndroid() &&
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    'Notification' in window
  )
}

/** The server key, base64url, as the bytes PushManager wants. */
function keyBytes(base64: string) {
  const padded = (base64 + '='.repeat((4 - (base64.length % 4)) % 4))
    .replace(/-/g, '+')
    .replace(/_/g, '/')
  const raw = atob(padded)
  return Uint8Array.from(raw, (char) => char.charCodeAt(0))
}

async function currentSubscription() {
  const registration = await navigator.serviceWorker.ready
  return registration.pushManager.getSubscription()
}

function language() {
  try {
    return localStorage.getItem('sim.lang') === 'am' ? 'am' : 'en'
  } catch {
    return 'en'
  }
}

export async function enablePush() {
  const { key } = await api<{ key: string | null }>('/api/push/key')
  if (!key) throw new Error('Phone notifications are not set up on the server')

  const permission = await Notification.requestPermission()
  if (permission !== 'granted') throw new Error('Notifications were not allowed')

  const registration = await navigator.serviceWorker.ready
  const subscription =
    (await registration.pushManager.getSubscription()) ??
    (await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: keyBytes(key),
    }))

  const json = subscription.toJSON()

  await api('/api/push/subscribe', {
    method: 'POST',
    body: { endpoint: json.endpoint, keys: json.keys, lang: language() },
  })
}

/** Turns it off for this phone. Called from the switch and on sign-out. */
export async function disablePush() {
  if (!supported()) return

  const subscription = await currentSubscription()
  if (!subscription) return

  await api('/api/push/unsubscribe', {
    method: 'POST',
    body: { endpoint: subscription.endpoint },
  }).catch(() => {})

  await subscription.unsubscribe().catch(() => {})
}

/** Where the switch stands on this phone, and a way to re-read it. */
export function usePushStatus() {
  const [status, setStatus] = useState<PushStatus>('unavailable')
  const [version, setVersion] = useState(0)

  useEffect(() => {
    if (!supported() || !import.meta.env.PROD) return
    let cancelled = false

    void (async () => {
      try {
        const { key, allowed } = await api<{ key: string | null; allowed: boolean }>(
          '/api/push/key',
        )
        if (!key || !allowed) return

        if (Notification.permission === 'denied') {
          if (!cancelled) setStatus('blocked')
          return
        }

        const subscription = await currentSubscription()
        if (!cancelled) setStatus(subscription ? 'on' : 'off')
      } catch {
        // Leave the switch hidden.
      }
    })()

    return () => {
      cancelled = true
    }
  }, [version])

  return { status, refresh: () => setVersion((n) => n + 1) }
}

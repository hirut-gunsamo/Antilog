import { useSyncExternalStore } from 'react'

/* ---------------------------------------------------------------------------
   The installed-app layer: registering the service worker, offering a reload
   when a new version is deployed, and the "Install app" option.

   The worker itself is sw.js at the project root; it is only built into
   production output, so none of this does anything under `pnpm dev`.
   --------------------------------------------------------------------------- */

/** Chrome's install event. Not in the DOM typings because it is not standard. */
type InstallPromptEvent = Event & {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

export type PwaState = {
  /** A new version has downloaded and is waiting for a reload. */
  updateReady: boolean
  /** Chrome/Edge/Android can show the native install dialog. */
  canPrompt: boolean
  /** Safari on iPhone/iPad, where installing is a manual Share-sheet step. */
  iosManual: boolean
  /**
   * An Android browser. Chrome there withholds its install dialog on a
   * plain-http address, so installing may have to go through its menu.
   */
  android: boolean
  /** Already running as the installed app. */
  installed: boolean
}

let installEvent: InstallPromptEvent | null = null
let waiting: ServiceWorker | null = null

// An update found this soon after the app opened is installed straight away:
// nobody has started typing yet, so there is nothing a reload could lose.
// Later ones wait for the person to press Reload on the banner.
const AUTO_APPLY_MS = 15_000
const openedAt = Date.now()

function runningInstalled() {
  if (typeof window === 'undefined') return false

  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    // iOS Safari's own flag, from before display-mode existed there.
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  )
}

function isIos() {
  if (typeof navigator === 'undefined') return false

  return (
    /iphone|ipad|ipod/i.test(navigator.userAgent) ||
    // iPadOS reports itself as a Mac; touch is what gives it away.
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
  )
}

function isAndroid() {
  if (typeof navigator === 'undefined') return false

  return /android/i.test(navigator.userAgent)
}

let state: PwaState = {
  updateReady: false,
  canPrompt: false,
  iosManual: isIos() && !runningInstalled(),
  android: isAndroid(),
  installed: runningInstalled(),
}

const listeners = new Set<() => void>()

function set(patch: Partial<PwaState>) {
  state = { ...state, ...patch }
  listeners.forEach((listener) => listener())
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

function getState() {
  return state
}

export function usePwa() {
  return useSyncExternalStore(subscribe, getState, getState)
}

/** Shows the native install dialog where the browser offers one. */
export async function promptInstall() {
  if (!installEvent) return false

  const event = installEvent
  installEvent = null
  set({ canPrompt: false })

  await event.prompt()
  const { outcome } = await event.userChoice

  return outcome === 'accepted'
}

let registered: ServiceWorkerRegistration | null = null

/**
 * The Refresh button: installs a new version if one is out, otherwise just
 * reloads so the page shows the latest data.
 */
export async function refreshApp() {
  if (waiting) {
    applyUpdate()
    return
  }

  // Ask the server once more; a new version found now is installed at once
  // (watch() applies it while `refreshing` is set).
  if (registered) {
    refreshing = true
    try {
      await registered.update()
      // Give a found update a moment to download before falling back.
      await new Promise((resolve) => setTimeout(resolve, 1500))
    } catch {
      // Offline or the server is unreachable: a plain reload still helps.
    }
    if (waiting) return
  }

  window.location.reload()
}

let refreshing = false

/** Switches to the waiting version; the page reloads once it has taken over. */
export function applyUpdate() {
  if (!waiting) {
    window.location.reload()
    return
  }

  waiting.postMessage('SKIP_WAITING')
}

function watch(worker: ServiceWorker | null) {
  if (!worker) return

  const settle = () => {
    // Only an update counts. On the very first install there is no
    // controller yet, and nothing old is running to replace.
    if (worker.state === 'installed' && navigator.serviceWorker.controller) {
      waiting = worker
      set({ updateReady: true })

      if (refreshing) {
        applyUpdate()
        return
      }

      if (Date.now() - openedAt < AUTO_APPLY_MS) applyUpdate()
    }
  }

  settle()
  worker.addEventListener('statechange', settle)
}

/** Called once from main.tsx. Safe to call where workers are unsupported. */
export function startPwa() {
  // Chrome fires this early, sometimes before React mounts; catch it here.
  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault()
    installEvent = event as InstallPromptEvent
    set({ canPrompt: true })
  })

  window.addEventListener('appinstalled', () => {
    installEvent = null
    set({ canPrompt: false, iosManual: false, installed: true })
  })

  if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return

  let reloading = false

  navigator.serviceWorker.addEventListener('controllerchange', () => {
    // Fires when the waiting version takes over after "Reload".
    if (reloading) return
    reloading = true
    window.location.reload()
  })

  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register('/sw.js')
      .then((registration) => {
        registered = registration
        watch(registration.waiting)
        watch(registration.installing)

        registration.addEventListener('updatefound', () =>
          watch(registration.installing),
        )

        const check = () => {
          void registration.update().catch(() => {})
        }

        // An installed app is rarely closed: it is put in the background and
        // brought back. So look for a new deploy whenever it comes back to
        // the front or back online, and every five minutes while it is open,
        // not only on a cold start.
        document.addEventListener('visibilitychange', () => {
          if (document.visibilityState === 'visible') check()
        })
        window.addEventListener('online', check)
        window.setInterval(check, 5 * 60 * 1000)
      })
      .catch(() => {
        // No worker means no offline start, but the app itself still works.
      })
  })
}

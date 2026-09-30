/* global self, caches, URL, fetch */

/*
 * The service worker behind the installed app.
 *
 * It keeps the app's own files so the app opens with no connection. It never
 * touches /api: branch data always comes from the server, so nobody reads
 * stale stock or another user's figures off a shared phone. Work done offline
 * is the sync outbox's job (src/lib/sync.ts), not this file's.
 *
 * This is a template. The build (vite.config.ts) replaces the two
 * placeholders below with the build id and the exact list of built files, so
 * every deploy produces a new worker and the app can offer to reload.
 */

const BUILD = '__BUILD_ID__'
const PRECACHE = __PRECACHE__

const SHELL = `shell-${BUILD}`
const FONTS = 'fonts-v1'

// Servers commonly send `Vary` (Origin, Accept-Encoding). A module script is
// requested with an Origin header that the precache request lacked, so an
// exact match would miss and the app would not start offline. Every file here
// is fingerprinted or the single shell page, so ignoring Vary is safe.
const MATCH = { ignoreVary: true }

self.addEventListener('install', (event) => {
  // No skipWaiting here: the new version waits until the person chooses to
  // reload, so a page never has its code swapped out from under it.
  event.waitUntil(caches.open(SHELL).then((cache) => cache.addAll(PRECACHE)))
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key.startsWith('shell-') && key !== SHELL)
            .map((key) => caches.delete(key)),
        ),
      )
      .then(() => self.clients.claim()),
  )
})

self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting()
})

self.addEventListener('fetch', (event) => {
  const { request } = event

  if (request.method !== 'GET') return

  const url = new URL(request.url)

  // Data is never cached. Returning without respondWith leaves the request
  // to the network exactly as if there were no worker.
  if (url.origin === self.location.origin && url.pathname.startsWith('/api/')) {
    return
  }

  // Pages: the network first, so an online user always gets the current
  // version; the saved shell when there is no connection. Every route is the
  // same single-page app, so one saved page answers them all.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request).catch(() =>
        caches
          .open(SHELL)
          .then((cache) => cache.match('/index.html', MATCH))
          .then((cached) => cached ?? Response.error()),
      ),
    )
    return
  }

  // The app's own files are fingerprinted by the build, so a saved copy is
  // never out of date.
  if (url.origin === self.location.origin) {
    event.respondWith(
      caches
        .open(SHELL)
        .then((cache) => cache.match(request, MATCH))
        .then((cached) => cached ?? fetch(request)),
    )
    return
  }

  // Google Fonts: serve the saved copy at once and refresh it behind the
  // scenes, so text keeps its typeface offline.
  if (
    url.hostname === 'fonts.googleapis.com' ||
    url.hostname === 'fonts.gstatic.com'
  ) {
    event.respondWith(
      caches.open(FONTS).then((cache) =>
        cache.match(request, MATCH).then((cached) => {
          const fresh = fetch(request)
            .then((response) => {
              if (response.ok || response.type === 'opaque') {
                cache.put(request, response.clone())
              }
              return response
            })
            .catch(() => cached ?? Response.error())

          return cached ?? fresh
        }),
      ),
    )
  }
})

// ---------------------------------------------------------------------------
// Phone notifications (Android). The server pushes { title, body, url, count }
// when new work is waiting; this shows it with the app closed and puts the
// count on the app icon where the launcher supports it.
// ---------------------------------------------------------------------------

self.addEventListener('push', (event) => {
  let data = {}
  try {
    data = event.data ? event.data.json() : {}
  } catch {
    data = { body: event.data ? event.data.text() : '' }
  }

  const count = Number(data.count) || 0
  const badge =
    'setAppBadge' in self.navigator
      ? (count > 0
          ? self.navigator.setAppBadge(count)
          : self.navigator.clearAppBadge()
        ).catch(() => {})
      : Promise.resolve()

  event.waitUntil(
    Promise.all([
      badge,
      self.registration.showNotification(data.title || 'AntiLog', {
        body: data.body || '',
        icon: '/icon-192.png?v=3',
        badge: '/icon-192.png?v=3',
        // One notice per app: a newer one replaces the last instead of piling up.
        tag: 'antilog-work',
        renotify: true,
        data: { url: data.url || '/dashboard' },
      }),
    ]),
  )
})

// Opens the page the notice is about, reusing an open window if there is one.
self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const target = new URL(event.notification.data?.url || '/dashboard', self.location.origin).href

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      for (const client of list) {
        if ('focus' in client) {
          return client.focus().then((focused) => focused.navigate?.(target) ?? focused)
        }
      }
      return self.clients.openWindow(target)
    }),
  )
})

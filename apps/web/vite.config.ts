import { readFileSync } from 'node:fs'

import react from '@vitejs/plugin-react'
import { defineConfig, type Plugin } from 'vite'

import pkg from './package.json' with { type: 'json' }

// Public files the installed app needs offline. Everything the bundler emits
// is added automatically; these come from public/ and are copied as-is.
//
// The ?v= on the icons matches index.html and the manifest exactly: the worker
// saves what the page asks for, so the query has to be the same in all three
// places or the saved copy is never found.
const PUBLIC_SHELL = [
  '/index.html',
  '/manifest.webmanifest',
  // Twice over: the app's own <Logo> asks for the bare path, the favicon and
  // the install icons ask for the busted one, and the worker only finds what
  // was asked for exactly.
  '/logo-mark.png',
  '/logo-mark.png?v=3',
  '/icon-192.png?v=3',
  '/icon-512.png?v=3',
  '/icon-maskable-512.png?v=3',
  '/apple-touch-icon.png?v=3',
]

/**
 * Emits sw.js with this build's id and the exact list of built files.
 *
 * A new id means a byte-different worker on every deploy, which is what makes
 * the browser notice the update and lets the app offer a reload. Build only:
 * in dev there is no worker, so nothing can serve a stale file while coding.
 */
function serviceWorker(): Plugin {
  return {
    name: 'sim-service-worker',
    apply: 'build',
    generateBundle(_options, bundle) {
      const built = Object.keys(bundle)
        .filter((file) => !file.endsWith('.map') && file !== 'index.html')
        .map((file) => `/${file}`)

      const source = readFileSync(new URL('./sw.js', import.meta.url), 'utf8')
        .replace('__BUILD_ID__', `${pkg.version}-${Date.now().toString(36)}`)
        .replace('__PRECACHE__', JSON.stringify([...PUBLIC_SHELL, ...built]))

      this.emitFile({ type: 'asset', fileName: 'sw.js', source })
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), serviceWorker()],

  // The Sync page reports the running version. Taking it from package.json
  // means it cannot drift from what was actually built.
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },

  server: {
    // The API runs separately in dev; proxying keeps the browser same-origin
    // so there are no CORS preflights and the token header passes straight
    // through.
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
    },
  },

  // `vite preview` serves the production build, worker included, so the
  // installed-app behaviour can be checked locally before deploying.
  preview: {
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
    },
  },
})

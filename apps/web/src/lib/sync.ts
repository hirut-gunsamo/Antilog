import { useSyncExternalStore } from 'react'

import { api, ApiError, OfflineError } from './api'
import type { TranslationKey } from './i18n'

/* ---------------------------------------------------------------------------
   What this is

   A small offline-first layer with two halves.

   Push: a mutation that cannot reach the server is kept in an outbox and sent
   again later. Each carries a mutation id the server remembers, so draining
   the queue twice records the work once.

   Pull: the server is asked what has changed since this device last synced.
   Every count is a real query, scoped to what the signed-in user may read.

   Everything here is per-browser. Nothing is shared between devices, which is
   why the page calls it "this device".
   --------------------------------------------------------------------------- */

export const SYNC_ENTITIES = [
  'sales',
  'requests',
  'inventory',
  'receipts',
  'products',
  'users',
  'branches',
] as const

export type SyncEntity = (typeof SYNC_ENTITIES)[number]

export const ENTITY_KEY: Record<SyncEntity, TranslationKey> = {
  sales: 'nav.sales',
  requests: 'nav.requests',
  inventory: 'nav.inventory',
  receipts: 'nav.receipts',
  products: 'sync.products',
  users: 'nav.users',
  branches: 'nav.branches',
}

export type QueuedMutation = {
  id: string
  /** Sent as X-Client-Mutation-Id; the server dedupes on it. */
  mutationId: string
  method: 'POST' | 'PATCH' | 'DELETE'
  path: string
  body?: unknown
  /** What the row says it is, e.g. "Sales (offline)". */
  labelKey: TranslationKey
  entity: SyncEntity
  queuedAt: string
  attempts: number
  lastError: string | null
}

export type LogEntry = {
  id: string
  at: string
  direction: 'upload' | 'download'
  labelKey: TranslationKey
  status: 'success' | 'failed'
  items: number
  error: string | null
  /** Set on a failed upload so the row's Retry button can find its queue entry. */
  mutationId?: string
}

export type SyncSettings = {
  autoSync: boolean
  intervalMinutes: number
  entities: SyncEntity[]
}

export type SyncState = {
  online: boolean
  syncing: boolean
  lastSyncedAt: string | null
  lastError: string | null
  pendingDownload: number
  downloadByEntity: Partial<Record<SyncEntity, number>>
  outbox: QueuedMutation[]
  log: LogEntry[]
  settings: SyncSettings
  nextAutoSyncAt: number | null
}

const KEYS = {
  device: 'sim.sync.device',
  outbox: 'sim.sync.outbox',
  log: 'sim.sync.log',
  marker: 'sim.sync.marker',
  settings: 'sim.sync.settings',
} as const

/** Long enough to be useful, short enough that localStorage stays small. */
const LOG_LIMIT = 40

const DEFAULT_SETTINGS: SyncSettings = {
  autoSync: true,
  intervalMinutes: 5,
  entities: [...SYNC_ENTITIES],
}

/* ---------------------------------------------------------------------------
   Storage — every read and write is guarded. A private window, blocked site
   data, or a quota error must degrade to "this device remembers nothing",
   never to a crash.
   --------------------------------------------------------------------------- */

function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as T) : fallback
  } catch {
    return fallback
  }
}

function write(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    // Nothing to do: the queue still works for this session.
  }
}

function newId() {
  try {
    return crypto.randomUUID()
  } catch {
    return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
  }
}

/* ---------------------------------------------------------------------------
   Device identity
   --------------------------------------------------------------------------- */

/** Stable for as long as this browser keeps its storage. */
export function deviceId() {
  let id = read<string | null>(KEYS.device, null)

  if (!id) {
    id = newId()
    write(KEYS.device, id)
  }

  return id
}

/**
 * A readable name for this browser, from the user agent.
 *
 * Deliberately coarse. The user agent cannot tell us the model of the machine,
 * so this says "Mac · Chrome" rather than inventing "MacBook Pro".
 */
export function deviceName() {
  const ua = navigator.userAgent

  const platform =
    /iPhone/.test(ua) ? 'iPhone'
    : /iPad/.test(ua) ? 'iPad'
    : /Android/.test(ua) ? 'Android'
    : /Macintosh|Mac OS X/.test(ua) ? 'Mac'
    : /Windows/.test(ua) ? 'Windows'
    : /Linux/.test(ua) ? 'Linux'
    : 'Unknown device'

  // Order matters: Edge and Opera both claim to be Chrome, Chrome claims
  // Safari. The most specific match has to win.
  const browser =
    /Edg\//.test(ua) ? 'Edge'
    : /OPR\/|Opera/.test(ua) ? 'Opera'
    : /Firefox\//.test(ua) ? 'Firefox'
    : /Chrome\//.test(ua) ? 'Chrome'
    : /Safari\//.test(ua) ? 'Safari'
    : 'Browser'

  return `${platform} · ${browser}`
}

/** Injected at build time from the package version. */
export const APP_VERSION = __APP_VERSION__

/* ---------------------------------------------------------------------------
   The store
   --------------------------------------------------------------------------- */

function isOnline() {
  return typeof navigator === 'undefined' ? true : navigator.onLine
}

let state: SyncState = {
  online: isOnline(),
  syncing: false,
  lastSyncedAt: read<string | null>(KEYS.marker, null),
  lastError: null,
  pendingDownload: 0,
  downloadByEntity: {},
  outbox: read<QueuedMutation[]>(KEYS.outbox, []),
  log: read<LogEntry[]>(KEYS.log, []),
  settings: { ...DEFAULT_SETTINGS, ...read(KEYS.settings, {}) },
  nextAutoSyncAt: null,
}

const listeners = new Set<() => void>()

function emit() {
  for (const listener of listeners) listener()
}

function set(patch: Partial<SyncState>) {
  state = { ...state, ...patch }
  emit()
}

export function getSyncState() {
  return state
}

export function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** Re-renders on every change without an effect copying state into React. */
export function useSync() {
  return useSyncExternalStore(subscribe, getSyncState, getSyncState)
}

/* ---------------------------------------------------------------------------
   The outbox
   --------------------------------------------------------------------------- */

function saveOutbox(outbox: QueuedMutation[]) {
  write(KEYS.outbox, outbox)
  set({ outbox })
}

function addLog(entry: Omit<LogEntry, 'id' | 'at'>) {
  const log = [
    { ...entry, id: newId(), at: new Date().toISOString() },
    ...state.log,
  ].slice(0, LOG_LIMIT)

  write(KEYS.log, log)
  set({ log })
}

/**
 * Sends a mutation, or keeps it for later if the device is offline.
 *
 * Returns the server's response when it went through, or null when it was
 * queued — so a caller can tell the difference and say so.
 */
export async function sendOrQueue<T>(
  request: {
    method: QueuedMutation['method']
    path: string
    body?: unknown
    labelKey: TranslationKey
    entity: SyncEntity
  },
): Promise<T | null> {
  const mutationId = newId()

  try {
    return await api<T>(request.path, {
      method: request.method,
      body: request.body,
      mutationId,
      deviceId: deviceId(),
    })
  } catch (caught) {
    // Only a lost connection is worth queueing. A 400 or a 403 would fail the
    // same way forever, so it is reported now rather than hidden in a queue.
    if (!(caught instanceof OfflineError)) throw caught

    const queued: QueuedMutation = {
      id: newId(),
      mutationId,
      method: request.method,
      path: request.path,
      body: request.body,
      labelKey: request.labelKey,
      entity: request.entity,
      queuedAt: new Date().toISOString(),
      attempts: 0,
      lastError: null,
    }

    saveOutbox([...state.outbox, queued])
    return null
  }
}

/** Drops one entry without sending it. */
export function discardQueued(id: string) {
  saveOutbox(state.outbox.filter((entry) => entry.id !== id))
}

/* ---------------------------------------------------------------------------
   Push and pull
   --------------------------------------------------------------------------- */

async function push(): Promise<{ sent: number; failed: number }> {
  if (state.outbox.length === 0) return { sent: 0, failed: 0 }

  let sent = 0
  let failed = 0
  const keep: QueuedMutation[] = []

  // Serial, not parallel: these are the user's actions and their order is the
  // order they happened in.
  for (const entry of state.outbox) {
    try {
      await api(entry.path, {
        method: entry.method,
        body: entry.body,
        mutationId: entry.mutationId,
        deviceId: deviceId(),
      })

      sent += 1
      addLog({
        direction: 'upload',
        labelKey: entry.labelKey,
        status: 'success',
        items: 1,
        error: null,
      })
    } catch (caught) {
      // Still offline: stop draining and keep the rest in order.
      if (caught instanceof OfflineError) {
        keep.push(entry)
        continue
      }

      const message =
        caught instanceof ApiError
          ? caught.message
          : caught instanceof Error
            ? caught.message
            : 'Could not send'

      failed += 1
      keep.push({
        ...entry,
        attempts: entry.attempts + 1,
        lastError: message,
      })

      addLog({
        direction: 'upload',
        labelKey: entry.labelKey,
        status: 'failed',
        items: 1,
        error: message,
        mutationId: entry.mutationId,
      })
    }
  }

  saveOutbox(keep)
  return { sent, failed }
}

type ChangesPayload = {
  changes: {
    serverTime: string
    since: string | null
    total: number
    entities: Record<string, number>
  }
}

async function pull() {
  const params = new URLSearchParams()

  if (state.lastSyncedAt) params.set('since', state.lastSyncedAt)
  if (state.settings.entities.length !== SYNC_ENTITIES.length) {
    params.set('entities', state.settings.entities.join(','))
  }

  const query = params.toString()
  const { changes } = await api<ChangesPayload>(
    `/api/sync/changes${query ? `?${query}` : ''}`,
  )

  return changes
}

/**
 * One sync run: send what is waiting, then find out what is new.
 *
 * The marker is the server's own clock, echoed back from the delta. Using the
 * device's clock instead would skip anything written in the gap between the
 * two if they disagree.
 */
export async function syncNow(): Promise<{
  ok: boolean
  updates?: number
  error?: string
}> {
  if (state.syncing) return { ok: false, error: 'Already syncing' }

  set({ syncing: true, lastError: null })

  try {
    const pushed = await push()
    const changes = await pull()

    write(KEYS.marker, changes.serverTime)

    addLog({
      direction: 'download',
      labelKey: 'sync.checkedForUpdates',
      status: 'success',
      items: changes.total,
      error: null,
    })

    set({
      lastSyncedAt: changes.serverTime,
      pendingDownload: 0,
      downloadByEntity: changes.entities as Partial<Record<SyncEntity, number>>,
      syncing: false,
      online: true,
      lastError: pushed.failed > 0 ? 'Some changes could not be sent' : null,
    })

    scheduleAuto()
    return { ok: true, updates: changes.total }
  } catch (caught) {
    const offline = caught instanceof OfflineError
    const message =
      caught instanceof Error ? caught.message : 'Could not sync'

    if (!offline) {
      addLog({
        direction: 'download',
        labelKey: 'sync.checkedForUpdates',
        status: 'failed',
        items: 0,
        error: message,
      })
    }

    set({ syncing: false, lastError: message, online: offline ? false : true })
    scheduleAuto()

    return { ok: false, error: message }
  }
}

/**
 * Asks what is new without claiming a sync happened.
 *
 * This is what fills "Pending Download": it leaves the marker alone, so the
 * count keeps growing until the user actually syncs.
 */
export async function refreshPending() {
  if (!state.online) return

  try {
    const changes = await pull()

    set({
      pendingDownload: changes.total,
      downloadByEntity: changes.entities as Partial<Record<SyncEntity, number>>,
    })
  } catch {
    // A failed poll is not worth reporting; the next one will say the same.
  }
}

/* ---------------------------------------------------------------------------
   Settings, history and automatic syncing
   --------------------------------------------------------------------------- */

export function updateSettings(patch: Partial<SyncSettings>) {
  const settings = { ...state.settings, ...patch }

  write(KEYS.settings, settings)
  set({ settings })
  scheduleAuto()
}

export function clearLog() {
  write(KEYS.log, [])
  set({ log: [] })
}

/**
 * Forgets everything this device remembers about syncing.
 *
 * The outbox goes too, so this is destructive when something is waiting —
 * the page warns and names the count before calling it.
 */
export function clearLocalData() {
  for (const key of [KEYS.outbox, KEYS.log, KEYS.marker]) {
    try {
      localStorage.removeItem(key)
    } catch {
      // Nothing stored means nothing to clear.
    }
  }

  set({
    outbox: [],
    log: [],
    lastSyncedAt: null,
    pendingDownload: 0,
    downloadByEntity: {},
    lastError: null,
  })
}

let timer: number | null = null

function scheduleAuto() {
  if (timer !== null) {
    window.clearTimeout(timer)
    timer = null
  }

  if (!state.settings.autoSync) {
    set({ nextAutoSyncAt: null })
    return
  }

  const delay = Math.max(1, state.settings.intervalMinutes) * 60_000

  set({ nextAutoSyncAt: Date.now() + delay })

  timer = window.setTimeout(() => {
    if (state.online && !state.syncing) void syncNow()
    else scheduleAuto()
  }, delay)
}

let started = false

/**
 * Starts the background loop. Called once from the app shell, so syncing keeps
 * working while the user is on any page — not only while the Sync page is open.
 */
export function startSync() {
  if (started) return
  started = true

  window.addEventListener('online', () => {
    set({ online: true })

    // Coming back online is the moment the queue exists for.
    if (state.outbox.length > 0) void syncNow()
    else void refreshPending()
  })

  window.addEventListener('offline', () => {
    set({ online: false, nextAutoSyncAt: null })
  })

  void refreshPending()
  scheduleAuto()
}

export function stopSync() {
  if (timer !== null) {
    window.clearTimeout(timer)
    timer = null
  }

  started = false
  set({ nextAutoSyncAt: null })
}

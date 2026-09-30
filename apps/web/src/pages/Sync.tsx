import { useEffect, useState } from 'react'

import { Card, Empty } from '../components/Card'
import { icons } from '../components/icons'
import { Toasts } from '../components/Toasts'
import { count, shortDate } from '../lib/format'
import { useT, type TranslationKey } from '../lib/i18n'
import {
  APP_VERSION,
  clearLocalData,
  clearLog,
  deviceId,
  deviceName,
  discardQueued,
  ENTITY_KEY,
  refreshPending,
  syncNow,
  SYNC_ENTITIES,
  updateSettings,
  useSync,
  type SyncEntity,
} from '../lib/sync'
import { useToasts } from '../lib/toasts'
import styles from './Sync.module.css'

const INTERVALS = [1, 5, 15, 30, 60]

function Icon({ name, size = 16 }: { name: keyof typeof icons; size?: number }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {icons[name].map((d, index) => (
        <path key={index} d={d} />
      ))}
    </svg>
  )
}

/** "Sep 17, 2026 10:24" — the log is about exact moments, so it keeps the time. */
function stamp(iso: string) {
  const date = new Date(iso)

  if (Number.isNaN(date.getTime())) return '—'

  const time = date.toLocaleTimeString(undefined, {
    hour: '2-digit',
    minute: '2-digit',
  })

  return `${shortDate(iso)} ${time}`
}

export default function Sync() {
  const state = useSync()
  const t = useT()
  const { toasts, push, dismiss } = useToasts()

  const [showLogs, setShowLogs] = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  const [confirmClear, setConfirmClear] = useState(false)

  // The countdown reads from this rather than from Date.now() at render time,
  // which keeps rendering pure and makes "In 4 minutes" actually tick down.
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 30_000)
    return () => window.clearInterval(id)
  }, [])

  // Opening the page is a good moment to find out what is new.
  useEffect(() => {
    void refreshPending()
  }, [])

  // The card shows the last few by default; "View Sync Logs" opens the rest.
  const VISIBLE_LOGS = 7
  const visibleLog = showLogs ? state.log : state.log.slice(0, VISIBLE_LOGS)

  const pendingUpload = state.outbox.length
  const failedInQueue = state.outbox.filter((entry) => entry.attempts > 0).length

  const health: { key: TranslationKey; note: TranslationKey; tone: string } =
    !state.online
      ? { key: 'sync.offline', note: 'sync.queuedOffline', tone: 'amber' }
      : failedInQueue > 0 || state.lastError
        ? { key: 'sync.needsAttention', note: 'sync.lastRunFailed', tone: 'red' }
        : pendingUpload > 0
          ? { key: 'sync.waiting', note: 'sync.queuedOffline', tone: 'amber' }
          : { key: 'sync.healthy', note: 'sync.allWorking', tone: 'purple' }

  async function run() {
    if (!state.online) {
      push('error', t('sync.cannotSyncOffline'))
      return
    }

    const result = await syncNow()

    if (result.ok) {
      // The count comes back from the run itself rather than from this
      // render's snapshot, which was taken before the run started.
      const total = result.updates ?? 0

      push(
        'success',
        total > 0 ? t('sync.done', { n: total }) : t('sync.doneClean'),
      )
    } else {
      push('error', t('sync.failedToast', { error: result.error ?? '' }))
    }
  }

  function minutesUntil(at: number) {
    return Math.max(0, Math.round((at - now) / 60_000))
  }

  const nextAuto = !state.settings.autoSync
    ? t('sync.autoSyncOff')
    : state.nextAutoSyncAt
      ? minutesUntil(state.nextAutoSyncAt) < 1
        ? t('sync.inOneMinute')
        : t('sync.inMinutes', { n: minutesUntil(state.nextAutoSyncAt) })
      : '—'

  const tiles = [
    {
      key: 'last',
      tone: 'green',
      icon: 'sync' as const,
      label: t('sync.lastSynced'),
      value: state.lastSyncedAt ? stamp(state.lastSyncedAt) : t('sync.neverSynced'),
      note: state.lastSyncedAt ? t('sync.upToDate') : t('sync.notSyncedYet'),
      small: true,
    },
    {
      key: 'up',
      tone: 'blue',
      icon: 'arrowUp' as const,
      label: t('sync.pendingUpload'),
      value: count(pendingUpload),
      note:
        pendingUpload === 0
          ? t('sync.nothingWaiting')
          : t('sync.queuedOffline'),
    },
    {
      key: 'down',
      tone: 'amber',
      icon: 'arrowDown' as const,
      label: t('sync.pendingDownload'),
      value: count(state.pendingDownload),
      note:
        state.pendingDownload === 0
          ? t('sync.noNewUpdates')
          : t('sync.nItems', { n: count(state.pendingDownload) }),
    },
    {
      key: 'status',
      tone: health.tone,
      icon: 'check' as const,
      label: t('sync.syncStatus'),
      value: t(health.key),
      note: t(health.note),
    },
  ]

  function toggleEntity(entity: SyncEntity) {
    const on = state.settings.entities.includes(entity)

    // Never let the last one be switched off: a sync that checks nothing would
    // silently report "up to date" forever.
    if (on && state.settings.entities.length === 1) return

    updateSettings({
      entities: on
        ? state.settings.entities.filter((value) => value !== entity)
        : [...state.settings.entities, entity],
    })
  }

  return (
    <div className={styles.page}>
      <header className={styles.head}>
        <div className={styles.mobileHeading}>
          <h1 className={styles.title}>{t('nav.sync')}</h1>
          <p className={styles.subtitle}>{t('sync.subtitle')}</p>
        </div>

        <div className={styles.headActions}>
          <span
            className={styles.connection}
            data-online={state.online}
            role="status"
          >
            <Icon name={state.online ? 'sync' : 'more'} size={14} />
            {state.online ? t('sync.connected') : t('sync.offline')}
          </span>
        </div>
      </header>

      <div className={styles.tiles}>
        {tiles.map((tile) => (
          <div key={tile.key} className={styles.tile} data-tone={tile.tone}>
            <span className={styles.tileIcon}>
              <Icon name={tile.icon} size={17} />
            </span>
            <span className={styles.tileText}>
              <span className={styles.tileLabel}>{tile.label}</span>
              <span
                className={styles.tileValue}
                data-small={tile.small ? '' : undefined}
              >
                {tile.value}
              </span>
              <span className={styles.tileNote}>{tile.note}</span>
            </span>
          </div>
        ))}
      </div>

      <div className={styles.actions}>
        <button
          type="button"
          className={styles.primary}
          onClick={() => void run()}
          disabled={state.syncing}
        >
          <Icon name="sync" size={15} />
          {state.syncing ? t('sync.syncing') : t('sync.now')}
        </button>

        <button
          type="button"
          className={styles.ghost}
          onClick={() => setShowLogs((value) => !value)}
          aria-expanded={showLogs}
          disabled={state.log.length <= VISIBLE_LOGS}
        >
          <Icon name="clipboard" size={15} />
          {showLogs ? t('sync.hideLogs') : t('sync.viewLogs')}
        </button>

        <button
          type="button"
          className={styles.ghost}
          onClick={() => setShowSettings((value) => !value)}
          aria-expanded={showSettings}
        >
          <Icon name="settings" size={15} />
          {t('sync.settings')}
        </button>
      </div>

      <div className={styles.columns}>
        <div className={styles.column}>
          {/* Anything the device is holding comes first: it is the only part
              of this page that represents work not yet saved anywhere else. */}
          {pendingUpload > 0 ? (
            <Card title={t('sync.waitingToSend')} subtitle={t('sync.offlineNote')}>
              <ul className={styles.queue}>
                {state.outbox.map((entry) => (
                  <li key={entry.id}>
                    <span className={styles.queueIcon} data-tone="blue">
                      <Icon name="arrowUp" size={14} />
                    </span>
                    <span className={styles.queueText}>
                      <strong>{t(entry.labelKey)}</strong>
                      <em>
                        {t('sync.queuedAt', { when: stamp(entry.queuedAt) })}
                        {entry.attempts > 0
                          ? ` · ${t('sync.attempts', { n: entry.attempts })}`
                          : ''}
                      </em>
                      {entry.lastError ? (
                        <em className={styles.queueError}>{entry.lastError}</em>
                      ) : null}
                    </span>
                    <button
                      type="button"
                      className={styles.discard}
                      onClick={() => {
                        discardQueued(entry.id)
                        push('success', t('sync.discarded'))
                      }}
                    >
                      {t('sync.discard')}
                    </button>
                  </li>
                ))}
              </ul>
            </Card>
          ) : null}

          <Card
            title={t('sync.recentActivity')}
            action={
              state.log.length > 0 ? (
                <button
                  type="button"
                  className={styles.linkButton}
                  onClick={() => {
                    clearLog()
                    push('success', t('sync.logCleared'))
                  }}
                >
                  {t('sync.clearLog')}
                </button>
              ) : undefined
            }
          >
            {state.log.length === 0 ? (
              <Empty>{t('sync.noActivity')}</Empty>
            ) : (
              <div className={styles.tableWrap}>
                <table className={styles.table}>
                  <thead>
                    <tr>
                      <th scope="col" className={styles.rowNum}>
                        #
                      </th>
                      <th scope="col">{t('sync.dateTime')}</th>
                      <th scope="col">{t('sync.type')}</th>
                      <th scope="col">{t('sync.details')}</th>
                      <th scope="col">{t('common.status')}</th>
                      <th scope="col">{t('sync.items')}</th>
                    </tr>
                  </thead>

                  <tbody>
                    {visibleLog.map((entry, index) => (
                      <tr key={entry.id}>
                        <td className={styles.rowNum}>{index + 1}</td>
                        <td data-label={t('sync.dateTime')} className="tabular">
                          {stamp(entry.at)}
                        </td>
                        <td data-label={t('sync.type')}>
                          <span
                            className={styles.direction}
                            data-direction={entry.direction}
                          >
                            <Icon
                              name={
                                entry.direction === 'upload'
                                  ? 'arrowUp'
                                  : 'arrowDown'
                              }
                              size={12}
                            />
                            {t(
                              entry.direction === 'upload'
                                ? 'sync.upload'
                                : 'sync.download',
                            )}
                          </span>
                        </td>
                        <td data-label={t('sync.details')}>
                          {t(entry.labelKey)}
                          {entry.error ? (
                            <span className={styles.rowError}>
                              {entry.error}
                            </span>
                          ) : null}
                        </td>
                        <td data-label={t('common.status')}>
                          <span
                            className={styles.state}
                            data-state={entry.status}
                          >
                            {t(
                              entry.status === 'success'
                                ? 'sync.success'
                                : 'sync.failed',
                            )}
                          </span>
                        </td>
                        <td data-label={t('sync.items')} className="tabular">
                          {entry.items === 1
                            ? t('sync.oneItem')
                            : t('sync.nItems', { n: count(entry.items) })}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </div>

        <div className={styles.column}>
          <Card title={t('sync.information')}>
            <dl className={styles.facts}>
              <div>
                <dt>
                  <Icon name="monitor" size={15} />
                  {t('sync.device')}
                </dt>
                <dd>{deviceName()}</dd>
              </div>
              <div>
                <dt>
                  <Icon name="box" size={15} />
                  {t('sync.version')}
                </dt>
                <dd className="tabular">v{APP_VERSION}</dd>
              </div>
              <div>
                <dt>
                  <Icon name="sync" size={15} />
                  {t('sync.lastSynced')}
                </dt>
                <dd className="tabular">
                  {state.lastSyncedAt
                    ? stamp(state.lastSyncedAt)
                    : t('sync.neverSynced')}
                </dd>
              </div>
              <div>
                <dt>
                  <Icon name="chart" size={15} />
                  {t('sync.nextAutoSync')}
                </dt>
                <dd>{nextAuto}</dd>
              </div>
              <div>
                <dt>
                  <Icon name="cash" size={15} />
                  {t('sync.internetStatus')}
                </dt>
                <dd>
                  <span className={styles.dot} data-online={state.online} />
                  {state.online ? t('sync.online') : t('sync.offline')}
                </dd>
              </div>
              <div>
                <dt>
                  <Icon name="sim" size={15} />
                  {t('sync.deviceId')}
                </dt>
                <dd className={`${styles.small} tabular`}>
                  {deviceId().slice(0, 8)}
                </dd>
              </div>
            </dl>
          </Card>

          {showSettings ? (
            <Card title={t('sync.settings')}>
              <label className={styles.toggleRow}>
                <input
                  type="checkbox"
                  checked={state.settings.autoSync}
                  onChange={(event) => {
                    updateSettings({ autoSync: event.target.checked })
                    push('success', t('sync.settingsSaved'))
                  }}
                />
                <span>
                  <strong>{t('sync.autoSync')}</strong>
                  <em>{t('sync.autoSyncNote')}</em>
                </span>
              </label>

              {state.settings.autoSync ? (
                <label className={styles.field}>
                  <span>{t('sync.interval')}</span>
                  <select
                    value={state.settings.intervalMinutes}
                    onChange={(event) => {
                      updateSettings({
                        intervalMinutes: Number(event.target.value),
                      })
                      push('success', t('sync.settingsSaved'))
                    }}
                  >
                    {INTERVALS.map((minutes) => (
                      <option key={minutes} value={minutes}>
                        {t('sync.everyNMinutes', { n: minutes })}
                      </option>
                    ))}
                  </select>
                </label>
              ) : null}

              <div className={styles.group}>
                <span className={styles.groupLabel}>{t('sync.whatToSync')}</span>
                <p className={styles.hint}>{t('sync.whatToSyncNote')}</p>

                <div className={styles.chips}>
                  {SYNC_ENTITIES.map((entity) => {
                    const on = state.settings.entities.includes(entity)

                    return (
                      <button
                        key={entity}
                        type="button"
                        className={on ? `${styles.chip} ${styles.chipOn}` : styles.chip}
                        aria-pressed={on}
                        onClick={() => toggleEntity(entity)}
                      >
                        {t(ENTITY_KEY[entity])}
                        {on && state.downloadByEntity[entity] ? (
                          <span className={styles.chipCount}>
                            {count(state.downloadByEntity[entity] ?? 0)}
                          </span>
                        ) : null}
                      </button>
                    )
                  })}
                </div>
              </div>

              <div className={styles.group}>
                <span className={styles.groupLabel}>{t('sync.clearLocal')}</span>
                <p className={styles.hint}>{t('sync.clearLocalNote')}</p>

                {confirmClear && pendingUpload > 0 ? (
                  <p className={styles.warn}>
                    {t('sync.clearLocalWarn', { n: pendingUpload })}
                  </p>
                ) : null}

                <button
                  type="button"
                  className={styles.dangerButton}
                  onClick={() => {
                    // A first click only warns when something would be lost.
                    if (pendingUpload > 0 && !confirmClear) {
                      setConfirmClear(true)
                      return
                    }

                    clearLocalData()
                    setConfirmClear(false)
                    push('success', t('sync.cleared'))
                  }}
                >
                  {confirmClear && pendingUpload > 0
                    ? t('sync.clearAnyway')
                    : t('sync.clearLocal')}
                </button>
              </div>
            </Card>
          ) : null}

          <div className={styles.tip}>
            <span className={styles.tipIcon} aria-hidden="true">
              <Icon name="bell" size={15} />
            </span>
            <div>
              <strong>{t('sync.tip')}</strong>
              <p>{t('sync.tipBody')}</p>
            </div>
          </div>
        </div>
      </div>

      <Toasts toasts={toasts} onDismiss={dismiss} />
    </div>
  )
}

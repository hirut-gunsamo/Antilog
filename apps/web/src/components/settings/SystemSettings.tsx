import { useRef, useState } from 'react'

import { api, getToken } from '../../lib/api'
import { setCurrency } from '../../lib/format'
import { useT } from '../../lib/i18n'
import { useSettings } from '../../lib/settings'
import type { AppSettings } from '../../lib/types'
import { Card } from '../Card'
import styles from '../../pages/Settings.module.css'

const CONFIRM_PHRASE = 'REPLACE ALL DATA'

/**
 * Backup, restore and reset — the three Owner-only operations that act on the
 * system as a whole rather than on one record.
 */
export function SystemSettings({
  onSaved,
  onError,
}: {
  onSaved: (message: string) => void
  onError: (message: string) => void
}) {
  const { setSettings } = useSettings()
  const t = useT()

  const [downloading, setDownloading] = useState(false)
  const [resetting, setResetting] = useState(false)

  const [file, setFile] = useState<File | null>(null)
  const [confirm, setConfirm] = useState('')
  const [restoring, setRestoring] = useState(false)

  const fileRef = useRef<HTMLInputElement | null>(null)

  async function backup() {
    setDownloading(true)

    try {
      // Fetched by hand rather than through a plain link: the endpoint needs
      // the bearer token, which an <a download> cannot carry.
      const token = getToken()
      const response = await fetch('/api/settings/backup', {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      })

      if (!response.ok) throw new Error('Could not build the backup')

      const blob = await response.blob()
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      const name = `sim-backup-${new Date().toISOString().slice(0, 10)}.json`

      link.href = url
      link.download = name
      link.click()
      URL.revokeObjectURL(url)

      onSaved(t('toast.savedToDownloads', { name }))
    } catch (caught) {
      onError(
        caught instanceof Error ? caught.message : 'Could not build the backup.',
      )
    } finally {
      setDownloading(false)
    }
  }

  async function restore() {
    if (!file || confirm !== CONFIRM_PHRASE || restoring) return

    setRestoring(true)

    try {
      const text = await file.text()
      const parsed = JSON.parse(text) as unknown

      const result = await api<{ message: string }>('/api/settings/restore', {
        method: 'POST',
        body: { confirm: CONFIRM_PHRASE, backup: parsed },
      })

      setFile(null)
      setConfirm('')
      if (fileRef.current) fileRef.current.value = ''

      onSaved(t('sys.reloadToSee', { message: result.message }))
    } catch (caught) {
      onError(
        caught instanceof Error
          ? caught.message
          : 'Could not restore that backup.',
      )
    } finally {
      setRestoring(false)
    }
  }

  async function reset() {
    setResetting(true)

    try {
      const payload = await api<{ settings: AppSettings }>(
        '/api/settings/reset',
        { method: 'POST' },
      )

      setSettings(payload.settings)
      setCurrency(payload.settings.currency)
      onSaved(t('sys.settingsReset'))
    } catch (caught) {
      onError(
        caught instanceof Error ? caught.message : 'Could not reset settings.',
      )
    } finally {
      setResetting(false)
    }
  }

  return (
    <Card title={t('sys.title')} subtitle={t('sys.note')}>
      <div className={styles.group}>
        <span className={styles.groupLabel}>{t('sys.backup')}</span>
        <p className={styles.hint}>{t('sys.backupNote')}</p>
        <div className={styles.formActions}>
          <button
            type="button"
            className={styles.submit}
            onClick={() => void backup()}
            disabled={downloading}
          >
            {downloading ? t('sys.preparing') : t('sys.downloadBackup')}
          </button>
        </div>
      </div>

      <div className={styles.group}>
        <span className={styles.groupLabel}>{t('sys.restore')}</span>
        <p className={styles.danger}>
          <strong>{t('sys.restoreWarnStrong')}</strong> {t('sys.restoreWarn')}
        </p>

        <label className={styles.field}>
          <span>{t('sys.backupFile')}</span>
          <input
            ref={fileRef}
            type="file"
            accept="application/json,.json"
            onChange={(event) => setFile(event.target.files?.[0] ?? null)}
          />
        </label>

        {file ? (
          <label className={styles.field}>
            <span>
              {t('sys.typeBefore')}
              <strong>{CONFIRM_PHRASE}</strong>
              {t('sys.typeAfter')}
            </span>
            <input
              value={confirm}
              onChange={(event) => setConfirm(event.target.value)}
              placeholder={CONFIRM_PHRASE}
              spellCheck={false}
            />
          </label>
        ) : null}

        <div className={styles.formActions}>
          <button
            type="button"
            className={styles.dangerButton}
            onClick={() => void restore()}
            disabled={!file || confirm !== CONFIRM_PHRASE || restoring}
          >
            {restoring ? t('sys.restoring') : t('sys.restoreFromBackup')}
          </button>
        </div>
      </div>

      <div className={styles.group}>
        <span className={styles.groupLabel}>{t('sys.resetSettings')}</span>
        <p className={styles.hint}>{t('sys.resetNote')}</p>
        <div className={styles.formActions}>
          <button
            type="button"
            className={styles.ghostButton}
            onClick={() => void reset()}
            disabled={resetting}
          >
            {resetting ? t('sys.resetting') : t('sys.resetToDefaults')}
          </button>
        </div>
      </div>
    </Card>
  )
}

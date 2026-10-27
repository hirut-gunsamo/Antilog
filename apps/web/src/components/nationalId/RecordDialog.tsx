import { useEffect, useState, type FormEvent } from 'react'

import { useAuth } from '../../auth/context'
import { api } from '../../lib/api'
import { count, currency } from '../../lib/format'
import { useT } from '../../lib/i18n'
import { useSettings } from '../../lib/settings'
import type { BranchRow, NationalIdRecord } from '../../lib/types'
import styles from '../inventory/Panel.module.css'

type Staff = { id: string; name: string; role: string }

/** Today as YYYY-MM-DD in the browser's own timezone. */
function todayIso() {
  const now = new Date()
  const offset = now.getTimezoneOffset() * 60_000

  return new Date(now.getTime() - offset).toISOString().slice(0, 10)
}

/**
 * Records a day's National ID print work, or corrects one already recorded.
 *
 * Original and copy prints are entered separately and stay separate — they are
 * separate lines in the branch's books. The dialog shows what the two counts
 * come to at the current rates so the figure is checked before it is saved,
 * not after.
 */
export function RecordDialog({
  record,
  onClose,
  onDone,
}: {
  /** Set when correcting an existing day. */
  record?: NationalIdRecord | null
  onClose: () => void
  onDone: (message: string) => void
}) {
  const t = useT()
  const { user } = useAuth()
  const { settings } = useSettings()

  const editing = record != null
  const isOwner = user?.role === 'OWNER'
  const canRecordForOthers = isOwner || user?.role === 'SUPERVISOR'

  const [date, setDate] = useState(record?.date.slice(0, 10) ?? todayIso())
  const [branchId, setBranchId] = useState(record?.location.id ?? '')
  const [employeeId, setEmployeeId] = useState(record?.recordedBy.id ?? '')
  const [original, setOriginal] = useState(String(record?.originalCount ?? ''))
  const [copy, setCopy] = useState(String(record?.copyCount ?? ''))
  const [notes, setNotes] = useState(record?.notes ?? '')

  const [branches, setBranches] = useState<BranchRow[]>([])

  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose()
    }

    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  // The Owner picks a branch; everyone else records against their own.
  useEffect(() => {
    if (!isOwner || editing) return

    const controller = new AbortController()

    api<{ branches: BranchRow[] }>('/api/branches', {
      signal: controller.signal,
    })
      .then((payload) =>
        setBranches((payload.branches ?? []).filter((b) => b.isActive)),
      )
      .catch(() => undefined)

    return () => controller.abort()
  }, [isOwner, editing])

  // Who the work can be attributed to at the chosen branch.
  const scopedBranch = isOwner ? branchId : (user?.branch?.id ?? '')

  // Tagged with the branch they belong to, so switching branch shows nobody
  // rather than briefly showing the previous branch's staff.
  const [loadedStaff, setLoadedStaff] = useState<{
    forBranch: string
    people: Staff[]
  } | null>(null)

  const staff = loadedStaff?.forBranch === scopedBranch ? loadedStaff.people : []

  useEffect(() => {
    if (!canRecordForOthers || editing || !scopedBranch) return

    const controller = new AbortController()

    api<{ users: (Staff & { branch: { id: string } | null; isActive: boolean })[] }>(
      '/api/users',
      { signal: controller.signal },
    )
      .then((payload) =>
        setLoadedStaff({
          forBranch: scopedBranch,
          people: (payload.users ?? [])
            .filter(
              (person) =>
                person.isActive &&
                person.branch?.id === scopedBranch &&
                person.role !== 'OWNER',
            )
            .map(({ id, name, role }) => ({ id, name, role })),
        }),
      )
      .catch(() => undefined)

    return () => controller.abort()
  }, [canRecordForOthers, editing, scopedBranch])

  const originalValue = Number(original || 0)
  const copyValue = Number(copy || 0)

  const countsValid =
    Number.isInteger(originalValue) &&
    Number.isInteger(copyValue) &&
    originalValue >= 0 &&
    copyValue >= 0 &&
    originalValue + copyValue > 0

  // Shown live from the rates on the row being edited, or today's settings for
  // a new one — the same arithmetic the server will do.
  const originalRate = Number(
    record?.originalRate ?? settings.nationalIdOriginalRate ?? 0,
  )
  const copyRate = Number(record?.copyRate ?? settings.nationalIdCopyRate ?? 0)
  const revenue = originalValue * originalRate + copyValue * copyRate

  const canSubmit =
    !busy &&
    countsValid &&
    (editing || !isOwner || branchId !== '') &&
    date !== ''

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    if (!canSubmit) return

    setBusy(true)
    setError(null)

    try {
      if (editing && record) {
        await api(`/api/national-id/${record.id}`, {
          method: 'PATCH',
          body: {
            originalCount: originalValue,
            copyCount: copyValue,
            notes: notes.trim() || null,
          },
        })

        onDone(t('nid.updated', { date: date }))
      } else {
        await api('/api/national-id', {
          method: 'POST',
          body: {
            date,
            originalCount: originalValue,
            copyCount: copyValue,
            ...(isOwner ? { locationId: branchId } : {}),
            ...(employeeId ? { recordedById: employeeId } : {}),
            ...(notes.trim() ? { notes: notes.trim() } : {}),
          },
        })

        onDone(
          t('nid.recorded', {
            n: count(originalValue + copyValue),
            date: date,
          }),
        )
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t('nid.saveFailed'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className={styles.scrim} onClick={onClose}>
      <aside
        className={styles.panel}
        role="dialog"
        aria-modal="true"
        aria-label={editing ? t('nid.editRecord') : t('nid.addRecord')}
        onClick={(event) => event.stopPropagation()}
      >
        <header className={styles.head}>
          <div>
            <h2>{editing ? t('nid.editRecord') : t('nid.addRecord')}</h2>
            <p>{editing ? t('nid.editNote') : t('nid.addNote')}</p>
          </div>
          <button type="button" onClick={onClose} aria-label={t('common.close')}>
            ✕
          </button>
        </header>

        <form className={styles.body} onSubmit={handleSubmit}>
          <label className={styles.field}>
            <span>
              {t('nid.date')}
              <em>{t('nid.dateNote')}</em>
            </span>
            <input
              type="date"
              value={date}
              onChange={(event) => setDate(event.target.value)}
              disabled={editing}
              required
            />
          </label>

          {isOwner && !editing ? (
            <label className={styles.field}>
              <span>
                {t('common.branch')}
                <em>{t('common.required')}</em>
              </span>
              <select
                value={branchId}
                onChange={(event) => {
                  setBranchId(event.target.value)
                  setEmployeeId('')
                }}
                required
              >
                <option value="">{t('dlg.selectBranch')}</option>
                {branches.map((branch) => (
                  <option key={branch.id} value={branch.id}>
                    {branch.name}
                  </option>
                ))}
              </select>
            </label>
          ) : null}

          {canRecordForOthers && !editing && staff.length > 0 ? (
            <label className={styles.field}>
              <span>
                {t('nid.employee')}
                <em>{t('nid.employeeNote')}</em>
              </span>
              <select
                value={employeeId}
                onChange={(event) => setEmployeeId(event.target.value)}
              >
                <option value="">{t('nid.myself')}</option>
                {staff.map((person) => (
                  <option key={person.id} value={person.id}>
                    {person.name}
                  </option>
                ))}
              </select>
            </label>
          ) : null}

          {editing ? (
            <p className={styles.hint}>
              {t('nid.editingFor', {
                name: record.recordedBy.name,
                branch: record.location.name,
              })}
            </p>
          ) : null}

          {/* The two counts sit side by side and stay separate all the way
              through: they are separate lines in the branch's books. */}
          <div className={styles.countRow}>
            <label className={styles.field}>
              <span>
                {t('nid.originalId')}
                <em>{currency(originalRate)}</em>
              </span>
              <input
                type="number"
                min="0"
                step="1"
                inputMode="numeric"
                value={original}
                onChange={(event) => setOriginal(event.target.value)}
                placeholder="0"
              />
            </label>

            <label className={styles.field}>
              <span>
                {t('nid.copyId')}
                <em>{currency(copyRate)}</em>
              </span>
              <input
                type="number"
                min="0"
                step="1"
                inputMode="numeric"
                value={copy}
                onChange={(event) => setCopy(event.target.value)}
                placeholder="0"
              />
            </label>
          </div>

          {!countsValid && (original !== '' || copy !== '') ? (
            <p className={styles.lineWarn}>{t('nid.atLeastOne')}</p>
          ) : null}

          <div className={styles.saleTotal}>
            <span>
              {t('nid.totalPrints', {
                n: count(originalValue + copyValue),
              })}
            </span>
            <strong className="tabular">{currency(revenue)}</strong>
          </div>

          <label className={styles.field}>
            <span>{t('dlg.note')}</span>
            <input
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
              maxLength={500}
              placeholder={t('nid.notePlaceholder')}
            />
          </label>

          {error ? <p className={styles.error}>{error}</p> : null}

          <div className={styles.actions}>
            <button type="button" className={styles.cancel} onClick={onClose}>
              {t('common.cancel')}
            </button>
            <button
              type="submit"
              className={styles.submit}
              disabled={!canSubmit}
            >
              {busy
                ? t('common.saving')
                : editing
                  ? t('dlg.saveChanges')
                  : t('nid.saveRecord')}
            </button>
          </div>
        </form>
      </aside>
    </div>
  )
}

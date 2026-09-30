import { useEffect, useState, type FormEvent } from 'react'

import { api } from '../../lib/api'
import { useT } from '../../lib/i18n'
import type { AppUser, BranchRow } from '../../lib/types'
import styles from '../inventory/Panel.module.css'

/**
 * Moves a user to a different branch, and — for a supervisor — makes them that
 * branch's supervisor in one transaction.
 *
 * Postgres carries a partial unique index allowing one active supervisor per
 * branch, so swapping one for another cannot be two separate requests: the
 * first would collide. `PATCH /users/branches/:id/supervisor` exists for
 * exactly this, doing both sides together.
 */
export function MoveBranchDialog({
  user,
  onClose,
  onDone,
}: {
  user: AppUser
  onClose: () => void
  onDone: (message: string) => void
}) {
  const [branches, setBranches] = useState<BranchRow[]>([])
  const t = useT()
  const [branchId, setBranchId] = useState(user.branchId ?? '')

  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose()
    }

    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  useEffect(() => {
    const controller = new AbortController()

    api<{ branches: BranchRow[] }>('/api/branches', {
      signal: controller.signal,
    })
      .then((payload) =>
        setBranches((payload.branches ?? []).filter((b) => b.isActive)),
      )
      .catch(() => {
        /* Leaves the select empty; the form cannot be submitted. */
      })

    return () => controller.abort()
  }, [])

  const target = branches.find((entry) => entry.id === branchId)
  const isSupervisor = user.role === 'SUPERVISOR'

  // Moving a supervisor into a branch that already has one would replace them.
  const replaces =
    isSupervisor && target?.supervisor != null && target.supervisor.id !== user.id

  const changed = branchId !== '' && branchId !== user.branchId

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    if (!changed || busy) return

    setBusy(true)
    setError(null)

    try {
      if (isSupervisor) {
        // One transaction: the outgoing supervisor is stood down as the
        // incoming one takes over.
        await api(`/api/users/branches/${branchId}/supervisor`, {
          method: 'PATCH',
          body: { newSupervisorId: user.id },
        })
      } else {
        await api(`/api/users/${user.id}/branch`, {
          method: 'PATCH',
          body: { branchId },
        })
      }

      onDone(
        replaces
          ? t('done.supervisorReplaced', {
              name: user.name,
              branch: target?.name ?? '',
              previous: target?.supervisor?.name ?? '',
            })
          : t('done.userMoved', {
              name: user.name,
              branch: target?.name ?? t('done.newBranch'),
            }),
      )
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : 'Could not move them.',
      )
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
        aria-label={t('a11y.moveName', { name: user.name })}
        onClick={(event) => event.stopPropagation()}
      >
        <header className={styles.head}>
          <div>
            <h2>{t('dlg.changeBranch')}</h2>
            <p>
              {user.name} · {user.branch?.name ?? t('dlg.noBranch')}
            </p>
          </div>
          <button type="button" onClick={onClose} aria-label={t('common.close')}>
            ✕
          </button>
        </header>

        <form className={styles.body} onSubmit={handleSubmit}>
          <label className={styles.field}>
            <span>
              {t('common.branch')}<em>{t('common.required')}</em>
            </span>
            <select
              value={branchId}
              onChange={(event) => setBranchId(event.target.value)}
              required
            >
              <option value="">{t("dlg.selectBranch")}</option>
              {branches.map((entry) => (
                <option key={entry.id} value={entry.id}>
                  {entry.name}
                  {isSupervisor && entry.supervisor
                    ? t('dlg.supervises', { name: entry.supervisor.name })
                    : ''}
                </option>
              ))}
            </select>
          </label>

          {replaces ? (
            <p className={styles.blocked}>
              {t('dlg.replaceWarning', {
                current: target?.supervisor?.name ?? '',
                branch: target?.name ?? '',
                incoming: user.name,
              })}
            </p>
          ) : null}

          {error ? <p className={styles.error}>{error}</p> : null}

          <div className={styles.actions}>
            <button type="button" className={styles.cancel} onClick={onClose}>
              {t('common.cancel')}
            </button>
            <button
              type="submit"
              className={styles.submit}
              disabled={!changed || busy}
            >
              {busy ? t('dlg.moving') : replaces ? t('dlg.replaceSupervisor') : t('dlg.move')}
            </button>
          </div>
        </form>
      </aside>
    </div>
  )
}

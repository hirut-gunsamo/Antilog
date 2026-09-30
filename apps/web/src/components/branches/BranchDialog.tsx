import { useEffect, useState, type FormEvent } from 'react'

import { api } from '../../lib/api'
import { useT } from '../../lib/i18n'
import type { BranchRow } from '../../lib/types'
import styles from '../inventory/Panel.module.css'

/**
 * Create a branch, or rename an existing one.
 *
 * Rename is deliberately the only edit here: the API's PATCH /:id accepts a
 * name and nothing else. Stock-source and open/closed are separate endpoints
 * with their own rules, so they live in the row menu instead.
 */
export function BranchDialog({
  branch,
  onClose,
  onDone,
}: {
  branch?: BranchRow
  onClose: () => void
  onDone: (message: string) => void
}) {
  const t = useT()
  const editing = branch != null

  const [name, setName] = useState(branch?.name ?? '')
  const [isMainStock, setIsMainStock] = useState(branch?.isMainStock ?? false)

  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose()
    }

    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  const trimmed = name.trim()
  const valid = trimmed.length >= 2 && trimmed.length <= 100
  const changed = !editing || trimmed !== branch.name

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    if (!valid || !changed || busy) return

    setBusy(true)
    setError(null)

    try {
      if (editing) {
        await api(`/api/branches/${branch.id}`, {
          method: 'PATCH',
          body: { name: trimmed },
        })

        onDone(t('done.branchRenamed', { old: branch.name, name: trimmed }))
      } else {
        await api('/api/branches', {
          method: 'POST',
          body: { name: trimmed, isMainStock },
        })

        onDone(
          isMainStock
            ? t('done.branchCreatedSource', { name: trimmed })
            : t('done.branchCreated', { name: trimmed }),
        )
      }
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : t('branches.saveFailed'),
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
        aria-label={editing ? `Rename ${branch.name}` : 'Add branch'}
        onClick={(event) => event.stopPropagation()}
      >
        <header className={styles.head}>
          <div>
            <h2>
              {editing
                ? t('branches.dialogRename')
                : t('branches.dialogAdd')}
            </h2>
            <p>
              {editing
                ? t('branches.dialogRenameNote')
                : t('branches.dialogAddNote')}
            </p>
          </div>
          <button type="button" onClick={onClose} aria-label={t('common.close')}>
            ✕
          </button>
        </header>

        <form className={styles.body} onSubmit={handleSubmit}>
          <label className={styles.field}>
            <span>
              {t('branches.nameLabel')}<em>{t('branches.nameHint')}</em>
            </span>
            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
              maxLength={100}
              placeholder="Hawassa"
              autoFocus
              required
            />
          </label>

          {!editing ? (
            <>
              <label className={styles.check}>
                <input
                  type="checkbox"
                  checked={isMainStock}
                  onChange={(event) => setIsMainStock(event.target.checked)}
                />
                <span>
                  <strong>{t('branches.holdsStock')}</strong>
<em>{t('branches.holdsStockNote')}</em>
                </span>
              </label>

              <p className={styles.hint}>
{t('branches.supervisorNote')}
              </p>
            </>
          ) : null}

          {error ? <p className={styles.error}>{error}</p> : null}

          <div className={styles.actions}>
            <button type="button" className={styles.cancel} onClick={onClose}>
              {t('common.cancel')}
            </button>
            <button
              type="submit"
              className={styles.submit}
              disabled={!valid || !changed || busy}
            >
              {busy
                ? t('common.saving')
                : editing
                  ? t('branches.saveName')
                  : t('branches.create')}
            </button>
          </div>
        </form>
      </aside>
    </div>
  )
}

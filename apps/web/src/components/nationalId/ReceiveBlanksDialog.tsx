import { useEffect, useState, type FormEvent } from 'react'

import { useAuth } from '../../auth/context'
import { api } from '../../lib/api'
import { count } from '../../lib/format'
import { useT } from '../../lib/i18n'
import type { BranchRow, NationalIdBlankBalance } from '../../lib/types'
import styles from '../inventory/Panel.module.css'

/**
 * Records blank ID cards arriving at a branch.
 *
 * This is the only thing that raises what a branch has left — printing is what
 * lowers it, and the remaining figure is the difference. There is no box to
 * type a remaining total into, because a typed total could disagree with the
 * print records; this one cannot.
 */
export function ReceiveBlanksDialog({
  balances,
  onClose,
  onDone,
}: {
  balances: NationalIdBlankBalance[]
  onClose: () => void
  onDone: (message: string) => void
}) {
  const t = useT()
  const { user } = useAuth()

  const isOwner = user?.role === 'OWNER'

  const [branchId, setBranchId] = useState('')
  const [original, setOriginal] = useState('')
  const [copy, setCopy] = useState('')
  const [note, setNote] = useState('')

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

  useEffect(() => {
    if (!isOwner) return

    const controller = new AbortController()

    api<{ branches: BranchRow[] }>('/api/branches', { signal: controller.signal })
      .then((payload) =>
        setBranches((payload.branches ?? []).filter((b) => b.isActive)),
      )
      .catch(() => undefined)

    return () => controller.abort()
  }, [isOwner])

  const originalValue = Number(original || 0)
  const copyValue = Number(copy || 0)

  const valid =
    Number.isInteger(originalValue) &&
    Number.isInteger(copyValue) &&
    originalValue >= 0 &&
    copyValue >= 0 &&
    originalValue + copyValue > 0

  const target = isOwner
    ? balances.find((entry) => entry.locationId === branchId)
    : balances[0]

  const canSubmit = !busy && valid && (!isOwner || branchId !== '')

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    if (!canSubmit) return

    setBusy(true)
    setError(null)

    try {
      await api('/api/national-id/blanks', {
        method: 'POST',
        body: {
          originalAdded: originalValue,
          copyAdded: copyValue,
          ...(isOwner ? { locationId: branchId } : {}),
          ...(note.trim() ? { note: note.trim() } : {}),
        },
      })

      onDone(
        t('nid.blanksAdded', {
          original: count(originalValue),
          copy: count(copyValue),
        }),
      )
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
        aria-label={t('nid.receiveBlanks')}
        onClick={(event) => event.stopPropagation()}
      >
        <header className={styles.head}>
          <div>
            <h2>{t('nid.receiveBlanks')}</h2>
            <p>{t('nid.receiveNote')}</p>
          </div>
          <button type="button" onClick={onClose} aria-label={t('common.close')}>
            ✕
          </button>
        </header>

        <form className={styles.body} onSubmit={handleSubmit}>
          {isOwner ? (
            <label className={styles.field}>
              <span>
                {t('common.branch')}
                <em>{t('common.required')}</em>
              </span>
              <select
                value={branchId}
                onChange={(event) => setBranchId(event.target.value)}
                required
              >
                <option value="">{t('dlg.selectBranch')}</option>
                {branches.map((entry) => (
                  <option key={entry.id} value={entry.id}>
                    {entry.name}
                  </option>
                ))}
              </select>
            </label>
          ) : null}

          <div className={styles.countRow}>
            <label className={styles.field}>
              <span>
                {t('nid.originalBlanks')}
                {target ? (
                  <em>
                    {t('nid.haveNow', {
                      n: count(target.originalRemaining),
                    })}
                  </em>
                ) : null}
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
                {t('nid.copyBlanks')}
                {target ? (
                  <em>{t('nid.haveNow', { n: count(target.copyRemaining) })}</em>
                ) : null}
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

          {!valid && (original !== '' || copy !== '') ? (
            <p className={styles.lineWarn}>{t('nid.blanksAtLeastOne')}</p>
          ) : null}

          {target && valid ? (
            <div className={styles.saleTotal}>
              <span>{t('nid.afterThis')}</span>
              <strong className="tabular">
                {t('nid.splitOf', {
                  original: count(target.originalRemaining + originalValue),
                  copy: count(target.copyRemaining + copyValue),
                })}
              </strong>
            </div>
          ) : null}

          <label className={styles.field}>
            <span>{t('dlg.note')}</span>
            <input
              value={note}
              onChange={(event) => setNote(event.target.value)}
              maxLength={300}
              placeholder={t('nid.receivePlaceholder')}
            />
          </label>

          {error ? <p className={styles.error}>{error}</p> : null}

          <div className={styles.actions}>
            <button type="button" className={styles.cancel} onClick={onClose}>
              {t('common.cancel')}
            </button>
            <button type="submit" className={styles.submit} disabled={!canSubmit}>
              {busy ? t('common.saving') : t('nid.addBlanks')}
            </button>
          </div>
        </form>
      </aside>
    </div>
  )
}

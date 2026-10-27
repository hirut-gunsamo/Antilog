import { useCallback, useState } from 'react'

import { api } from '../lib/api'
import { useT } from '../lib/i18n'
import type { ToastKind } from '../lib/toasts'
import styles from './BulkDelete.module.css'

/** Which rows of a table are ticked. */
export function useSelection() {
  const [selected, setSelected] = useState<Set<string>>(new Set())

  const toggle = useCallback((id: string) => {
    setSelected((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  // Ticks every id given, or unticks them all when they already are.
  const toggleAll = useCallback((ids: string[]) => {
    setSelected((current) => {
      const next = new Set(current)
      const all = ids.length > 0 && ids.every((id) => next.has(id))
      for (const id of ids) {
        if (all) next.delete(id)
        else next.add(id)
      }
      return next
    })
  }, [])

  const clear = useCallback(() => setSelected(new Set()), [])

  return { selected, setSelected, toggle, toggleAll, clear }
}

export type Selection = ReturnType<typeof useSelection>

export function SelectAllCell({ ids, selection }: { ids: string[]; selection: Selection }) {
  const t = useT()

  return (
    <th className={styles.tick}>
      <input
        type="checkbox"
        checked={ids.length > 0 && ids.every((id) => selection.selected.has(id))}
        onChange={() => selection.toggleAll(ids)}
        aria-label={t('common.selectAll')}
      />
    </th>
  )
}

export function SelectCell({
  id,
  name,
  selection,
  disabled = false,
}: {
  id: string
  name: string
  selection: Selection
  disabled?: boolean
}) {
  const t = useT()

  return (
    // A tick must not also open the row it sits in.
    <td className={styles.tick} onClick={(event) => event.stopPropagation()}>
      <input
        type="checkbox"
        checked={selection.selected.has(id)}
        disabled={disabled}
        onChange={() => selection.toggle(id)}
        aria-label={t('a11y.selectRow', { name })}
      />
    </td>
  )
}

/** Takes the "Actions" header's place: deletes every ticked row at once. */
export function BulkDeleteButton({
  count,
  busy = false,
  onClick,
}: {
  count: number
  busy?: boolean
  onClick: () => void
}) {
  const t = useT()

  return (
    <button
      type="button"
      className={styles.button}
      disabled={count === 0 || busy}
      onClick={onClick}
    >
      {count > 0 ? t('bulk.deleteN', { n: count }) : t('bulk.delete')}
    </button>
  )
}

/**
 * Asks once, then deletes each id in turn through its own endpoint, so every
 * row keeps the rules its single delete already has. Reports how many went
 * and, for any that did not, the first reason. Resolves false if cancelled.
 */
export async function deleteSelected(
  ids: string[],
  url: (id: string) => string,
  t: ReturnType<typeof useT>,
  push: (kind: ToastKind, text: string) => void,
) {
  if (ids.length === 0) return false
  if (!window.confirm(t('bulk.confirm', { n: ids.length }))) return false

  let deleted = 0
  const reasons: string[] = []

  for (const id of ids) {
    try {
      // The API client always sends a JSON content type, which Fastify
      // refuses with an empty body.
      await api(url(id), { method: 'DELETE', body: {} })
      deleted += 1
    } catch (caught) {
      reasons.push(caught instanceof Error ? caught.message : t('bulk.failedReason'))
    }
  }

  if (deleted > 0) push('success', t('bulk.deleted', { n: deleted }))
  if (reasons.length > 0) {
    push('error', t('bulk.failed', { n: reasons.length, reason: reasons[0] }))
  }

  return true
}

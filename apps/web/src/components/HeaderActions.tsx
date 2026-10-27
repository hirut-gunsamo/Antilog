import { useT } from '../lib/i18n'
import bulk from './BulkDelete.module.css'

/**
 * Edit and Delete for a whole table, side by side in its header row: Edit
 * acts on the one ticked row, Delete on every ticked row. Each shows only
 * when the viewer may use it.
 */
export function HeaderActions({
  canEdit = true,
  editEnabled,
  onEdit,
  canDelete = true,
  deleteCount,
  onDelete,
}: {
  canEdit?: boolean
  editEnabled: boolean
  onEdit: () => void
  canDelete?: boolean
  deleteCount: number
  onDelete: () => void
}) {
  const t = useT()
  if (!canEdit && !canDelete) return null
  return (
    <div style={{ display: 'inline-flex', gap: 8, whiteSpace: 'nowrap' }}>
      {canEdit ? (
        <button type="button" className={bulk.edit} disabled={!editEnabled} onClick={onEdit} title={t('bulk.editHint')}>
          {t('prod.edit')}
        </button>
      ) : null}
      {canDelete ? (
        <button type="button" className={bulk.button} disabled={deleteCount === 0} onClick={onDelete} title={t('bulk.deleteHint')}>
          {deleteCount > 0 ? t('bulk.deleteN', { n: deleteCount }) : t('bulk.delete')}
        </button>
      ) : null}
    </div>
  )
}

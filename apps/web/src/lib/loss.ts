import type { TranslationKey } from './i18n'
import type { ReportableUnit, StockLossReport } from './types'

/**
 * A readable reference, built the same way the other records build theirs:
 * from the date it was raised plus a slice of the id.
 */
export function lossRef(report: StockLossReport) {
  const date = new Date(report.createdAt)

  if (Number.isNaN(date.getTime())) {
    return report.id.slice(-8).toUpperCase()
  }

  const stamp = `${date.getFullYear()}${`${date.getMonth() + 1}`.padStart(2, '0')}${`${date.getDate()}`.padStart(2, '0')}`

  // DMG and LST rather than one prefix: the two read very differently in a
  // list, and which one it is matters more than that it is a write-off.
  const prefix = report.kind === 'DAMAGED' ? 'DMG' : 'LST'

  return `${prefix}-${stamp}-${report.id.slice(-4).toUpperCase()}`
}

export const LOSS_KIND_KEY: Record<StockLossReport['kind'], TranslationKey> = {
  DAMAGED: 'loss.damaged',
  LOST: 'loss.lost',
}

export const LOSS_STATUS_KEY: Record<
  StockLossReport['status'],
  TranslationKey
> = {
  PENDING: 'loss.statusPending',
  APPROVED: 'loss.statusApproved',
  REJECTED: 'loss.statusRejected',
}

/**
 * Whatever identifier a historical write-off's linked unit is known by.
 * Write-offs are reported by quantity now, but a report raised before this
 * change may still carry the specific units it took, and this labels them
 * for that read-only history.
 */
export function unitLabel(unit: ReportableUnit) {
  return (
    unit.iccid ?? unit.imei ?? unit.simNumber ?? unit.serialNumber ??
    unit.id.slice(-8).toUpperCase()
  )
}

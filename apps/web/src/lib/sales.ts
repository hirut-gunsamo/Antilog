import type { TranslationKey } from './i18n'
import type { Sale, SaleStatus } from './types'

// The database identifies a sale by a cuid, which is unreadable and useless to
// quote over a phone. This builds a stable, human reference from the sale's own
// date and id — the same sale always produces the same reference, and it is
// unique because the id suffix is.
//
// It is a display label, not a second identifier: every request still uses the
// real id.
export function saleRef(sale: Sale) {
  const date = new Date(sale.saleDate)

  if (Number.isNaN(date.getTime())) return sale.id.slice(-8).toUpperCase()

  const stamp = `${date.getFullYear()}${`${date.getMonth() + 1}`.padStart(2, '0')}${`${date.getDate()}`.padStart(2, '0')}`

  return `S-${stamp}-${sale.id.slice(-4).toUpperCase()}`
}

export const STATUS_LABEL: Record<SaleStatus, string> = {
  DRAFT: 'Draft',
  SUBMITTED: 'Submitted',
  APPROVED: 'Approved',
  REJECTED: 'Rejected',
}

/** The same four, as keys, so the pill and the CSV can be translated. */
export const STATUS_KEY: Record<SaleStatus, TranslationKey> = {
  DRAFT: 'sales.statusDraft',
  SUBMITTED: 'sales.statusSubmitted',
  APPROVED: 'sales.statusApproved',
  REJECTED: 'sales.statusRejected',
}

export function saleItemCount(sale: Sale) {
  return sale.items.reduce((sum, item) => sum + item.quantity, 0)
}

/** The products on a sale, as one short line for the table. */
export function saleItemSummary(sale: Sale) {
  if (sale.items.length === 0) return '—'
  if (sale.items.length === 1) return sale.items[0].product.name

  return `${sale.items[0].product.name} +${sale.items.length - 1}`
}

export function isSameDay(iso: string, day: Date) {
  const date = new Date(iso)

  return (
    date.getFullYear() === day.getFullYear() &&
    date.getMonth() === day.getMonth() &&
    date.getDate() === day.getDate()
  )
}

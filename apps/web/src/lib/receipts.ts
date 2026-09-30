import type { TranslationKey } from './i18n'
import type { BankReceipt } from './types'

// Same reasoning as sales and requests: a readable label built from the
// record's own date and id. Display only — requests still go by id.
export function receiptRef(receipt: BankReceipt) {
  const date = new Date(receipt.receiptDate)

  if (Number.isNaN(date.getTime())) return receipt.id.slice(-8).toUpperCase()

  const stamp = `${date.getFullYear()}${`${date.getMonth() + 1}`.padStart(2, '0')}${`${date.getDate()}`.padStart(2, '0')}`

  return `RCPT-${stamp}-${receipt.id.slice(-4).toUpperCase()}`
}

export const RECEIPT_STATUS_LABEL: Record<BankReceipt['status'], string> = {
  PENDING: 'Pending',
  VERIFIED: 'Verified',
  REJECTED: 'Rejected',
}

/** The same three as keys, for the pill and the CSV. */
export const RECEIPT_STATUS_KEY: Record<
  BankReceipt['status'],
  TranslationKey
> = {
  PENDING: 'rcpt.statusPending',
  VERIFIED: 'rcpt.statusVerified',
  REJECTED: 'rcpt.statusRejected',
}

/** What the API will accept, so the picker and the error text agree. */
export const RECEIPT_ACCEPT = 'image/jpeg,image/png,image/webp,application/pdf'
export const RECEIPT_MAX_BYTES = 10 * 1024 * 1024

export function isPdf(receipt: BankReceipt) {
  return receipt.fileUrl?.toLowerCase().endsWith('.pdf') ?? false
}

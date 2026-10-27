/** How a customer paid for a National ID order or a Telebirr entry. */
export type Payment = { method: 'CASH' | 'TRANSFER' | 'MIXED'; bank: string; transfer: string }

export const CASH_PAYMENT: Payment = { method: 'CASH', bank: '', transfer: '' }

/** Whether `payment` is complete for a charge of `amount`. */
export function paymentValid(payment: Payment, amount: number) {
  if (payment.method === 'CASH') return true
  if (payment.bank === '') return false
  if (payment.method === 'TRANSFER') return true
  const transfer = Number(payment.transfer)
  return payment.transfer.trim() !== '' && transfer > 0 && transfer < amount
}

/** A saved payment back in the picker's shape, for editing. */
export function paymentOf(row: { paymentMethod?: string | null; transferAmount?: string | number | null; bankName?: string | null }): Payment {
  const method = row.paymentMethod === 'TRANSFER' || row.paymentMethod === 'MIXED' ? row.paymentMethod : 'CASH'
  return {
    method,
    bank: method === 'CASH' ? '' : (row.bankName ?? ''),
    transfer: method === 'MIXED' ? String(Number(row.transferAmount ?? 0)) : '',
  }
}

/** What the API takes: only the transfer part is sent, the rest is cash. */
export function paymentBody(payment: Payment) {
  return {
    paymentMethod: payment.method,
    ...(payment.method !== 'CASH' ? { bankName: payment.bank } : {}),
    ...(payment.method === 'MIXED' ? { transferAmount: Number(payment.transfer) } : {}),
  }
}

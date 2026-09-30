// Stock health, shared by the inventory table and its details panel.
//
// These thresholds mirror the ones the API uses for the dashboard's low-stock
// list (report.service.ts, getLowStock). They are duplicated rather than
// served because the balance endpoints return raw quantities; if the API's
// values change, change these to match.
export const LOW_STOCK_THRESHOLD: Record<string, number> = {
  SIM_CARD: 10,
  PHONE: 5,
  AIRTIME_VOUCHER: 40,
}

export type StockStatus = 'IN_STOCK' | 'LOW_STOCK' | 'OUT_OF_STOCK'

export function stockStatus(category: string, quantity: number): StockStatus {
  if (quantity <= 0) return 'OUT_OF_STOCK'
  if (quantity <= (LOW_STOCK_THRESHOLD[category] ?? 0)) return 'LOW_STOCK'
  return 'IN_STOCK'
}

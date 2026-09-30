import type { TranslationKey } from './i18n'
import type { RequestStatus, StockRequest } from './types'

// Same reasoning as sales: the database key is a cuid, which is unusable in
// conversation. This builds a stable, unique reference from the request's own
// date and id. It is a label, never an identifier — requests still go by id.
export function requestRef(request: StockRequest) {
  const date = new Date(request.createdAt)

  if (Number.isNaN(date.getTime())) return request.id.slice(-8).toUpperCase()

  const stamp = `${date.getFullYear()}${`${date.getMonth() + 1}`.padStart(2, '0')}${`${date.getDate()}`.padStart(2, '0')}`

  return `REQ-${stamp}-${request.id.slice(-4).toUpperCase()}`
}

export const REQUEST_STATUS_LABEL: Record<RequestStatus, string> = {
  PENDING: 'Pending',
  APPROVED: 'Approved',
  REJECTED: 'Rejected',
  FULFILLED: 'Fulfilled',
  CANCELLED: 'Cancelled',
}

/** The same five as keys, so the pill and the CSV can be translated. */
export const REQUEST_STATUS_KEY: Record<RequestStatus, TranslationKey> = {
  PENDING: 'req.statusPending',
  APPROVED: 'req.statusApproved',
  REJECTED: 'req.statusRejected',
  FULFILLED: 'req.statusFulfilled',
  CANCELLED: 'req.statusCancelled',
}

/**
 * Transfer state as a sentence fragment — "a transfer is in transit from…".
 * Typed loosely because the API sends the transfer's status as a plain string.
 */
export const TRANSFER_STATUS_KEY: Record<string, TranslationKey> = {
  PENDING: 'det.transferPending',
  IN_TRANSIT: 'det.transferInTransit',
  RECEIVED: 'det.transferReceived',
  CANCELLED: 'det.transferCancelled',
}

export function requestUnitCount(request: StockRequest) {
  return request.items.reduce((sum, item) => sum + item.quantity, 0)
}

/** Units approved across all lines, or null while nothing is decided. */
export function approvedUnitCount(request: StockRequest) {
  if (request.items.every((item) => item.approvedQuantity === null)) return null

  return request.items.reduce(
    (sum, item) => sum + (item.approvedQuantity ?? 0),
    0,
  )
}

/** True when the reviewer approved less than was asked for on any line. */
export function isPartlyApproved(request: StockRequest) {
  return request.items.some(
    (item) =>
      item.approvedQuantity !== null && item.approvedQuantity < item.quantity,
  )
}

/** "2 items (50 units)", as the design shows it. */
export function requestItemSummary(
  request: StockRequest,
  t: (key: TranslationKey, vars?: Record<string, string | number>) => string,
) {
  const items = request.items.length
  const units = requestUnitCount(request)

  return {
    items: items === 1 ? t('req.oneItem') : t('req.nItems', { n: items }),
    units: units === 1 ? t('dlg.oneUnit') : t('dlg.units', { n: units }),
  }
}

/** Who it came from and who it is addressed to. */
export function requestRoute(
  request: StockRequest,
  t: (key: TranslationKey) => string,
) {
  const from = request.requestedBy.branch?.name ?? t('req.unknownBranch')

  // Every request is addressed to the Owner; the role is carried on the
  // record so this reads from it rather than assuming.
  const to = t(request.requestedTo?.role === 'SUPERVISOR'
    ? 'role.SUPERVISOR'
    : 'role.OWNER')

  return `${from} → ${to}`
}

/**
 * A supervisor's restock ships as one transfer: once every category is
 * decided and something was approved, the Owner sends it with the driver's
 * details.
 */
export function readyToSend(request: StockRequest, userId: string | undefined) {
  return (
    request.requestedBy.role !== 'SALES' &&
    request.status === 'PENDING' &&
    request.requestedTo?.id === userId &&
    request.items.every((item) => item.approvedQuantity !== null) &&
    request.items.some((item) => (item.approvedQuantity ?? 0) > 0)
  )
}

/** One requested item and what became of it, for the requests report. */
export type RequestItemRow = {
  key: string
  /** The request's reference, so its lines read as one request. */
  ref: string
  date: string
  branch: string
  requestedBy: string
  kind: StockRequest['kind']
  category: string
  /** The product category's kind, for a label when the Owner named none. */
  categoryKind: string
  product: string
  requested: number
  approved: number
  rejected: number
  result: 'APPROVED' | 'REJECTED' | 'PARTLY' | 'PENDING' | 'CANCELLED'
}

/**
 * Every item of every request on its own row: how many were asked for, how
 * many approved and how many rejected. Requests decided before items were
 * decided one by one are read from the request's own status.
 */
export function requestItemRows(requests: StockRequest[]): RequestItemRow[] {
  const rows: RequestItemRow[] = []

  for (const request of requests) {
    for (const item of request.items) {
      const asked = item.quantity
      let approved = 0
      let result: RequestItemRow['result']

      if (request.status === 'CANCELLED') {
        result = 'CANCELLED'
      } else if (item.approvedQuantity === null) {
        if (request.status === 'PENDING') result = 'PENDING'
        else if (request.status === 'REJECTED') result = 'REJECTED'
        else {
          approved = asked
          result = 'APPROVED'
        }
      } else {
        approved = item.approvedQuantity
        result = approved === 0 ? 'REJECTED' : approved < asked ? 'PARTLY' : 'APPROVED'
      }

      rows.push({
        key: item.id,
        ref: requestRef(request),
        date: request.createdAt,
        branch: request.requestedBy.branch?.name ?? '—',
        requestedBy: request.requestedBy.name,
        kind: request.kind,
        category: item.product.productCategory?.name ?? '',
        categoryKind: item.product.category,
        product: item.product.name,
        requested: asked,
        approved,
        rejected: result === 'REJECTED' || result === 'PARTLY' ? asked - approved : 0,
        result,
      })
    }
  }

  return rows.sort(
    (a, b) =>
      +new Date(b.date) - +new Date(a.date) ||
      a.ref.localeCompare(b.ref) ||
      a.category.localeCompare(b.category) ||
      a.product.localeCompare(b.product),
  )
}

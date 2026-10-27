import { useEffect, useState } from 'react'

import { useAuth } from '../../auth/context'
import { api } from '../../lib/api'

import { count, shortDate } from '../../lib/format'
import { useT } from '../../lib/i18n'
import {
  REQUEST_STATUS_KEY,
  approvedUnitCount,
  requestRef,
  requestRoute,
  requestUnitCount,
} from '../../lib/requests'
import type { StockRequest } from '../../lib/types'
import { requestStage } from '../../lib/requests'
import styles from '../inventory/Panel.module.css'

export function RequestDetails({
  request,
  onClose,
  onReceived,
  onDispatch,
}: {
  request: StockRequest
  onClose: () => void
  /** Called after the branch confirms the delivery arrived. */
  onReceived?: () => void
  /** The Owner's Approve & send for a supervisor's restock, from here. */
  onDispatch?: () => void
  /** No longer used: items are approved whole, from one page. */
  onDecided?: (updated: StockRequest, message: string) => void
  onError?: (message: string) => void
}) {
  const t = useT()

  // The receiving branch's supervisor (or the Owner) confirms the delivery
  // arrived; that is when its stock is counted in.
  const { user } = useAuth()
  const [receiving, setReceiving] = useState(false)
  const [receiveError, setReceiveError] = useState<string | null>(null)
  const canReceive =
    request.transfer?.status === 'IN_TRANSIT' &&
    (user?.role === 'OWNER' ||
      (user?.role === 'SUPERVISOR' && user.branch?.id === request.transfer.toLocation?.id))

  async function receive() {
    if (!request.transfer) return
    setReceiving(true)
    setReceiveError(null)
    try {
      await api(`/api/transfers/${request.transfer.id}/receive`, { method: 'PATCH', body: {} })
      onReceived?.()
      onClose()
    } catch (caught) {
      setReceiveError(caught instanceof Error ? caught.message : 'Failed.')
    } finally {
      setReceiving(false)
    }
  }
  const approvedUnits = approvedUnitCount(request)

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose()
    }

    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className={styles.scrim} onClick={onClose}>
      <aside
        className={styles.panel}
        role="dialog"
        aria-modal="true"
        aria-label={t('a11y.requestRef', { ref: requestRef(request) })}
        onClick={(event) => event.stopPropagation()}
      >
        <header className={styles.head}>
          <div>
            <h2 className="tabular">{requestRef(request)}</h2>
            <p>{requestRoute(request, t)}</p>
          </div>
          <button type="button" onClick={onClose} aria-label={t('common.close')}>
            ✕
          </button>
        </header>

        <div className={styles.body}>
          <dl className={styles.facts}>
            <div>
              <dt>{t('det.status')}</dt>
              <dd>
                <span
                  className={styles.status}
                  data-state={requestStage(request) === 'WAITING_TO_SEND' ? 'APPROVED' : request.status}
                >
                  {t(REQUEST_STATUS_KEY[requestStage(request) === 'WAITING_TO_SEND' ? 'APPROVED' : request.status])}
                </span>
              </dd>
            </div>
            <div>
              <dt>{t('det.requestedBy')}</dt>
              <dd>{request.requestedBy.name}</dd>
            </div>
            <div>
              <dt>{t('det.branch')}</dt>
              <dd>{request.requestedBy.branch?.name ?? '—'}</dd>
            </div>
            <div>
              <dt>{t('det.raised')}</dt>
              <dd>{shortDate(request.createdAt)}</dd>
            </div>
            <div>
              <dt>{t('det.lines')}</dt>
              <dd className="tabular">{count(request.items.length)}</dd>
            </div>
            <div>
              <dt>{t('det.units')}</dt>
              <dd className="tabular">{count(requestUnitCount(request))}</dd>
            </div>
            {approvedUnits !== null ? (
              <div>
                <dt>{t('det.approvedUnits')}</dt>
                <dd className="tabular">{count(approvedUnits)}</dd>
              </div>
            ) : null}
          </dl>

          <section className={styles.section}>
            <h3>
              {t('det.itemsRequested')}
              <span>{request.items.length}</span>
            </h3>

            <ul className={styles.moves}>
              {request.items.map((item) => (
                <li key={item.id}>
                  <span className={styles.moveWhere}>
                    {item.product.name}
                    <em className={styles.sub}>
                      {item.iccidFrom
                        ? t('iccid.range', { from: item.iccidFrom, to: item.iccidTo ?? '' })
                        : item.product.sku}
                    </em>
                  </span>
                  <span className={`${styles.moveQty} tabular`}>
                    {item.approvedQuantity === null ||
                    item.approvedQuantity === item.quantity
                      ? count(item.quantity)
                      : item.approvedQuantity === 0
                        ? t('det.lineDeclined', { n: count(item.quantity) })
                        : t('det.qtyApprovedOf', {
                            approved: count(item.approvedQuantity),
                            requested: count(item.quantity),
                          })}
                  </span>
                </li>
              ))}
            </ul>
          </section>

          {request.status === 'REJECTED' && request.rejectionReason ? (
            <section className={styles.section}>
              <p className={styles.blocked}>{request.rejectionReason}</p>
            </section>
          ) : null}

          {request.transfer?.driverName ? (
            <section className={styles.section}>
              <h3>{t('det.driver')}</h3>
              <p className={styles.none}>
                {t('det.driverLine', {
                  name: request.transfer.driverName,
                  phone: request.transfer.driverPhone ?? '—',
                  plate: request.transfer.vehiclePlate ?? '—',
                })}
              </p>
            </section>
          ) : null}

          {/* The Owner approves and sends from here, one page. */}
          {onDispatch ? (
            <section className={styles.section}>
              <button type="button" className={styles.submit} onClick={onDispatch}>
                {t(requestStage(request) === 'WAITING_TO_SEND' ? 'appr.send' : 'dispatch.open')}
              </button>
            </section>
          ) : null}

          {canReceive ? (
            <section className={styles.section}>
              <p className={styles.warn}>{t('tr.receiveNote')}</p>
              {receiveError ? <p className={styles.error}>{receiveError}</p> : null}
              <button
                type="button"
                className={styles.submit}
                onClick={() => void receive()}
                disabled={receiving}
              >
                {receiving ? t('prod.saving') : t('tr.received')}
              </button>
            </section>
          ) : null}

        </div>
      </aside>
    </div>
  )
}

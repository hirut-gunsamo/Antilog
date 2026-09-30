import { useEffect, useState } from 'react'

import { useAuth } from '../../auth/context'
import { api } from '../../lib/api'

import { count, shortDate } from '../../lib/format'
import { useT } from '../../lib/i18n'
import {
  REQUEST_STATUS_KEY,
  TRANSFER_STATUS_KEY,
  approvedUnitCount,
  requestRef,
  requestRoute,
  requestUnitCount,
} from '../../lib/requests'
import type { StockRequest } from '../../lib/types'
import { CategoryDecisions } from './CategoryDecisions'
import styles from '../inventory/Panel.module.css'

export function RequestDetails({
  request,
  onClose,
  onReceived,
  onDecided,
  onError,
}: {
  request: StockRequest
  onClose: () => void
  /** Called after the branch confirms the delivery arrived. */
  onReceived?: () => void
  /** Given where the request can be decided: items then show by category. */
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
                <span className={styles.status} data-state={request.status}>
                  {t(REQUEST_STATUS_KEY[request.status])}
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

            {onDecided ? (
              <CategoryDecisions
                request={request}
                onDecided={onDecided}
                onError={onError ?? (() => undefined)}
              />
            ) : (
            <ul className={styles.moves}>
              {request.items.map((item) => (
                <li key={item.id}>
                  <span className={styles.moveWhere}>
                    {item.product.name}
                    <em className={styles.sub}>{item.product.sku}</em>
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
            )}
          </section>

          <section className={styles.section}>
            <h3>{t('det.progress')}</h3>

            {request.status === 'REJECTED' && request.rejectionReason ? (
              <p className={styles.blocked}>{request.rejectionReason}</p>
            ) : request.transfer ? (
              <p className={styles.none}>
                {t('det.transferProgress', {
                  who: request.approvedBy?.name ?? t('det.theOwner'),
                  status: t(
                    TRANSFER_STATUS_KEY[request.transfer.status] ??
                      'det.transferPending',
                  ),
                  from:
                    request.transfer.fromLocation?.name ?? t('done.sourceBranch'),
                  to: request.transfer.toLocation?.name ?? t('det.thisBranch'),
                })}
              </p>
            ) : request.reviewedAt ? (
              <p className={styles.none}>
                {request.approvedBy
                  ? t('det.reviewedOnBy', {
                      when: shortDate(request.reviewedAt),
                      name: request.approvedBy.name,
                    })
                  : t('det.reviewedOn', { when: shortDate(request.reviewedAt) })}
              </p>
            ) : (
              <p className={styles.none}>{t('det.waitingOwner')}</p>
            )}
          </section>

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

          {request.notes ? (
            <section className={styles.section}>
              <h3>{t('det.note')}</h3>
              <p className={styles.none}>{request.notes}</p>
            </section>
          ) : null}
        </div>
      </aside>
    </div>
  )
}

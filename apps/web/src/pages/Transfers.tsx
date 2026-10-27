import { useEffect, useState } from 'react'

import { useAuth } from '../auth/context'
import { Card, Empty } from '../components/Card'
import { NewTransferDialog } from '../components/transfers/NewTransferDialog'
import { ApproveRequestDialog } from '../components/requests/ApproveRequestDialog'
import { NewRequestDialog } from '../components/requests/NewRequestDialog'
import { askedOfBranch, requestRef } from '../lib/requests'
import { Toasts } from '../components/Toasts'
import { api } from '../lib/api'
import { count, shortDate } from '../lib/format'
import { useT, type TranslationKey } from '../lib/i18n'
import { useToasts } from '../lib/toasts'
import type { StockRequest, TransferRow } from '../lib/types'
import base from './Products.module.css'
import styles from './Ibid.module.css'

const STATUS_KEY: Record<TransferRow['status'], TranslationKey> = {
  PENDING: 'tr.statusPending',
  IN_TRANSIT: 'tr.statusOnTheWay',
  RECEIVED: 'tr.statusReceived',
  CANCELLED: 'tr.statusCancelled',
}

/**
 * Stock on the road: restocks from the main warehouse and transfers between
 * branches. The receiving branch presses Received when the driver has
 * unloaded — only then is the stock counted in there.
 */
export default function Transfers() {
  const { user } = useAuth()
  const t = useT()
  const { toasts, push, dismiss } = useToasts()
  const isOwner = user?.role === 'OWNER'

  const [rows, setRows] = useState<TransferRow[] | null>(null)
  const [status, setStatus] = useState<'ALL' | TransferRow['status']>('ALL')
  const [reloadKey, setReloadKey] = useState(0)
  const [creating, setCreating] = useState(false)
  const [busyId, setBusyId] = useState<string | null>(null)

  useEffect(() => {
    const controller = new AbortController()
    api<{ transfers: TransferRow[] }>('/api/transfers', { signal: controller.signal })
      // The Owner's own sends have their own page.
      .then((payload) => setRows((payload.transfers ?? []).filter((row) => !row.directSend)))
      .catch(() => {
        if (!controller.signal.aborted) setRows([])
      })
    return () => controller.abort()
  }, [reloadKey])

  const reload = () => setReloadKey((n) => n + 1)

  // Supervisor to supervisor: what this branch asked of others, and what
  // others asked of it, still waiting to be sent.
  const isSupervisor = user?.role === 'SUPERVISOR'
  const [asking, setAsking] = useState(false)
  const [sending, setSending] = useState<StockRequest | null>(null)
  const [branchRequests, setBranchRequests] = useState<StockRequest[]>([])
  useEffect(() => {
    if (!isSupervisor) return
    const controller = new AbortController()
    api<{ requests: StockRequest[] }>('/api/requests?status=PENDING', { signal: controller.signal })
      .then((payload) =>
        setBranchRequests(
          (payload.requests ?? []).filter(
            (request) =>
              request.requestedBy.role === 'SUPERVISOR' &&
              request.requestedTo?.role === 'SUPERVISOR' &&
              (askedOfBranch(request, user) || request.requestedBy.branch?.id === user?.branch?.id),
          ),
        ),
      )
      .catch(() => undefined)
    return () => controller.abort()
  }, [isSupervisor, reloadKey, user])

  async function rejectAsk(request: StockRequest) {
    const reason = window.prompt(t('tr.rejectReason'))
    if (!reason?.trim()) return
    try {
      await api(`/api/requests/${request.id}/reject`, { method: 'PATCH', body: { rejectionReason: reason.trim() } })
      push('success', t('toast.rejectedRef', { ref: requestRef(request) }))
      reload()
    } catch (caught) {
      push('error', caught instanceof Error ? caught.message : 'Could not save it.')
    }
  }

  // The receiving branch's supervisor counts it in; the Owner only for a
  // branch with no supervisor (the store).
  const canReceive = (row: TransferRow) =>
    row.status === 'IN_TRANSIT' &&
    (isOwner ? (row.toLocation._count?.users ?? 0) === 0 : row.toLocation.id === user?.branch?.id)

  async function receive(row: TransferRow) {
    if (!window.confirm(t('tr.receiveConfirm', { from: row.fromLocation.name }))) return
    setBusyId(row.id)
    try {
      await api(`/api/transfers/${row.id}/receive`, { method: 'PATCH', body: {} })
      push('success', t('tr.receivedToast'))
      reload()
    } catch (caught) {
      push('error', caught instanceof Error ? caught.message : 'Failed.')
    } finally {
      setBusyId(null)
    }
  }

  const shown = (rows ?? []).filter((row) => status === 'ALL' || row.status === status)
  const onTheWay = (rows ?? []).filter((row) => row.status === 'IN_TRANSIT').length

  return (
    <div className={base.page}>
      <header className={base.head}>
        <div className={base.mobileHeading}>
          <h1 className={base.title}>{t('tr.title')}</h1>
          <p className={base.subtitle}>{t('tr.note')}</p>
        </div>
        {isOwner ? (
          <div className={base.headActions}>
            <button type="button" className={base.primary} onClick={() => setCreating(true)}>
              + {t('tr.new')}
            </button>
          </div>
        ) : isSupervisor ? (
          <div className={base.headActions}>
            <button type="button" className={base.primary} onClick={() => setAsking(true)}>
              + {t('tr.askBranch')}
            </button>
          </div>
        ) : null}
      </header>

      {isSupervisor && branchRequests.length > 0 ? (
        <Card title={t('tr.branchRequests')} subtitle={t('tr.branchRequestsNote')}>
          <div className={base.scroll}>
            <table className={base.table}>
              <thead>
                <tr>
                  <th scope="col">{t('req.date')}</th>
                  <th scope="col">{t('tr.route')}</th>
                  <th scope="col">{t('tr.items')}</th>
                  <th scope="col" className={base.actionsCol}>
                    {t('common.actions')}
                  </th>
                </tr>
              </thead>
              <tbody>
                {branchRequests.map((request) => (
                  <tr key={request.id}>
                    <td data-label={t('req.date')}>
                      {shortDate(request.createdAt)}
                      <em className={base.sub}>{requestRef(request)}</em>
                    </td>
                    <td data-label={t('tr.route')} className={base.strong}>
                      {request.requestedTo?.branch?.name ?? '—'} → {request.requestedBy.branch?.name ?? '—'}
                      <em className={base.sub}>{t('tr.forRequest', { name: request.requestedBy.name })}</em>
                    </td>
                    <td data-label={t('tr.items')} style={{ whiteSpace: 'normal' }}>
                      {request.items.map((item) => (
                        <div key={item.id}>
                          {count(item.quantity)} × {item.product.name}
                        </div>
                      ))}
                    </td>
                    <td className={base.actionsCol}>
                      {askedOfBranch(request, user) ? (
                        <>
                          <button type="button" className={base.primary} onClick={() => setSending(request)}>
                            {t('dlg.approveAndTransfer')}
                          </button>{' '}
                          {request.items.every((item) => item.approvedQuantity === null) ? (
                            <button type="button" className={base.secondary} onClick={() => void rejectAsk(request)}>
                              {t('appr.reject')}
                            </button>
                          ) : null}
                        </>
                      ) : (
                        <span className={base.sub}>
                          {t('tr.waitingFor', { branch: request.requestedTo?.branch?.name ?? '—' })}
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      ) : null}

      <Card>
        <div className={styles.filters}>
          <select value={status} onChange={(event) => setStatus(event.target.value as typeof status)} aria-label={t('common.status')}>
            <option value="ALL">{t('prod.allStatusAll')}</option>
            <option value="IN_TRANSIT">{t('tr.statusOnTheWay')}</option>
            <option value="RECEIVED">{t('tr.statusReceived')}</option>
            <option value="CANCELLED">{t('tr.statusCancelled')}</option>
          </select>
          <span style={{ marginLeft: 'auto', fontSize: 12.5, color: 'var(--muted)' }}>
            {t('tr.onTheWayCount', { n: count(onTheWay) })}
          </span>
        </div>

        {rows === null ? (
          <Empty>{t('common.loading')}</Empty>
        ) : shown.length === 0 ? (
          <Empty>{t('tr.none')}</Empty>
        ) : (
          <div className={base.scroll}>
            <table className={base.table}>
              <thead>
                <tr>
                  <th scope="col">{t('req.date')}</th>
                  <th scope="col">{t('tr.route')}</th>
                  <th scope="col">{t('tr.items')}</th>
                  <th scope="col">{t('det.driver')}</th>
                  <th scope="col">{t('common.status')}</th>
                  <th scope="col" className={base.actionsCol}>
                    {t('common.actions')}
                  </th>
                </tr>
              </thead>
              <tbody>
                {shown.map((row) => (
                  <tr key={row.id}>
                    <td data-label={t('req.date')}>
                      {shortDate(row.shippedAt ?? row.createdAt)}
                      <em className={base.sub}>{t(row.request ? 'tr.kindRestock' : 'tr.kindTransfer')}</em>
                    </td>
                    <td data-label={t('tr.route')} className={base.strong}>
                      {row.fromLocation.name} → {row.toLocation.name}
                      {row.request ? <em className={base.sub}>{t('tr.forRequest', { name: row.request.requestedBy.name })}</em> : null}
                    </td>
                    <td data-label={t('tr.items')} style={{ whiteSpace: 'normal' }}>
                      {row.items.map((item) => (
                        <div key={item.id}>
                          {count(item.quantity)} × {item.product.name}
                        </div>
                      ))}
                    </td>
                    <td data-label={t('det.driver')}>
                      {row.driverName ?? '—'}
                      {row.driverName ? (
                        <em className={base.sub}>
                          {row.driverPhone ?? '—'} · {row.vehiclePlate ?? '—'}
                        </em>
                      ) : null}
                    </td>
                    <td data-label={t('common.status')}>
                      <span className={styles.kind} data-kind={row.status === 'RECEIVED' ? 'LOAD' : 'PRINT'}>
                        {t(STATUS_KEY[row.status])}
                      </span>
                      {row.receivedAt ? (
                        <em className={base.sub}>
                          {shortDate(row.receivedAt)}
                          {row.receivedBy ? ` · ${row.receivedBy.name}` : ''}
                        </em>
                      ) : null}
                    </td>
                    <td className={base.actionsCol}>
                      {canReceive(row) ? (
                        <button type="button" className={base.primary} disabled={busyId === row.id} onClick={() => void receive(row)}>
                          {t('tr.received')}
                        </button>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {creating ? (
        <NewTransferDialog
          onClose={() => setCreating(false)}
          onDone={(message) => {
            setCreating(false)
            push('success', message)
            reload()
          }}
        />
      ) : null}

      {asking ? (
        <NewRequestDialog
          kind="RESTOCK"
          branchOnly
          onClose={() => setAsking(false)}
          onDone={(message) => {
            setAsking(false)
            push('success', message)
            reload()
          }}
        />
      ) : null}

      {sending ? (
        <ApproveRequestDialog
          request={sending}
          onClose={() => setSending(null)}
          onDone={(message) => {
            setSending(null)
            push('success', message)
            reload()
          }}
        />
      ) : null}

      <Toasts toasts={toasts} onDismiss={dismiss} />
    </div>
  )
}

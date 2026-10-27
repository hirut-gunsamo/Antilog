import { useEffect, useState, type FormEvent, type ReactNode } from 'react'
import rowStyles from '../components/RowMenu.module.css'
import bulk from '../components/BulkDelete.module.css'
import { HeaderActions } from '../components/HeaderActions'
import { businessDay } from '../lib/tz'
import { useSearchParams } from 'react-router-dom'

import { useAuth } from '../auth/context'
import { Card, Empty } from '../components/Card'
import { Toasts } from '../components/Toasts'
import { api } from '../lib/api'
import { useBranchList } from '../lib/branches'
import { count, currency, shortDate } from '../lib/format'
import { useT, type TranslationKey } from '../lib/i18n'
import { useToasts } from '../lib/toasts'
import type { NidKind, NidOrder, NidOverview, NidRequest } from '../lib/types'
import panel from '../components/inventory/Panel.module.css'
import { PaymentPicker } from '../components/PaymentPicker'
import { CASH_PAYMENT, paymentBody, paymentOf, paymentValid, type Payment } from '../lib/payment'
import base from './Products.module.css'
import styles from './Ibid.module.css'
import pick from './NationalIdOrders.module.css'

const ORDER_STATUS: Record<string, TranslationKey> = {
  REGISTERED: 'nido.stWaiting',
  REQUESTED: 'nido.stWithSupervisor',
  AT_OWNER: 'nido.stWithOwner',
  APPROVED: 'nido.stApproved',
  DONE: 'nido.stDone',
  LEFTOVER: 'nido.stLeftover',
}

const REQUEST_STATUS: Record<NidRequest['status'], TranslationKey> = {
  WITH_SUPERVISOR: 'nido.stWithSupervisor',
  WITH_OWNER: 'nido.stWithOwner',
  APPROVED: 'nido.stApproved',
  RETURNED: 'nido.stReturned',
  RECEIVED: 'nido.stReceived',
}

function todayIso() {
  return new Date().toISOString().slice(0, 10)
}

function Dialog({ title, note, onClose, children }: { title: string; note?: string; onClose: () => void; children: ReactNode }) {
  const t = useT()
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className={panel.scrim} onClick={onClose}>
      <aside className={panel.panel} role="dialog" aria-modal="true" aria-label={title} onClick={(event) => event.stopPropagation()}>
        <header className={panel.head}>
          <div>
            <h2>{title}</h2>
            {note ? <p>{note}</p> : null}
          </div>
          <button type="button" onClick={onClose} aria-label={t('common.close')}>
            ✕
          </button>
        </header>
        {children}
      </aside>
    </div>
  )
}

/**
 * Original ID prints or ID copies for customers. Salespeople register each
 * customer and send the waiting names to their supervisor; the supervisor
 * sends them on to the Owner; the Owner sends them back with how many were
 * done, and the rest become leftovers for the next request.
 */
export default function NationalIdOrders({ kind }: { kind: NidKind }) {
  const { user } = useAuth()
  const t = useT()
  const { toasts, push, dismiss } = useToasts()
  const role = user?.role
  const [searchParams, setSearchParams] = useSearchParams()

  const [data, setData] = useState<NidOverview | null>(null)
  const [reloadKey, setReloadKey] = useState(0)
  const [registering, setRegistering] = useState(false)
  const [editing, setEditing] = useState<NidOrder | null>(null)
  // Sales edit their own from today (or a day the Owner opened) and delete
  // their own names not yet sent; supervisors and the Owner do both.
  const canEditOrder = (row: NidOrder) =>
    role !== 'SALES' ||
    (row.recordedBy.id === user?.id && (row.editable ?? businessDay(new Date(row.createdAt)) === businessDay()))
  const canDeleteOrder = (row: NidOrder) =>
    role !== 'SALES' || (row.recordedBy.id === user?.id && row.status === 'REGISTERED')
  const [tickedOrders, setTickedOrders] = useState<Set<string>>(new Set())
  const [waitingForm, setWaitingForm] = useState(false)
  // Open with the request to show first, or '' for the first one ready.
  const [printedForm, setPrintedForm] = useState<string | null>(null)
  const [pricing, setPricing] = useState(false)
  const [busy, setBusy] = useState(false)

  // Owner shortcuts can land here with ?printed=1, opening the form directly.
  if (role === 'OWNER' && searchParams.get('printed') === '1') {
    setSearchParams({}, { replace: true })
    if (printedForm === null) setPrintedForm('')
  }

  useEffect(() => {
    const controller = new AbortController()
    api<NidOverview>(`/api/nid?kind=${kind}`, { signal: controller.signal })
      // An older server sends requests without their names; read that as none
      // rather than failing the whole page.
      .then((payload) =>
        setData({ ...payload, requests: payload.requests.map((row) => ({ ...row, orders: row.orders ?? [] })) }),
      )
      .catch(() => undefined)
    return () => controller.abort()
  }, [kind, reloadKey])

  const reload = () => setReloadKey((n) => n + 1)
  const price = data?.prices[kind] ?? 0
  const title = t(kind === 'ORIGINAL' ? 'nido.titleOriginal' : 'nido.titleCopy')
  const toSend = (data?.totals.waiting ?? 0) + (data?.totals.leftover ?? 0)
  // The supervisor's salespeople's requests not yet sent on to the Owner.
  const toForward = (data?.requests ?? []).filter((row) => row.status === 'WITH_SUPERVISOR')
  // Requests with names still waiting for the Owner's approval, and those
  // with approved names ready to send back.
  const waitingAtOwner = (data?.requests ?? []).filter(
    (row) =>
      (row.status === 'WITH_OWNER' || row.status === 'APPROVED') &&
      row.orders.some((order) => order.status === 'AT_OWNER'),
  )
  const printableRequests = (data?.requests ?? []).filter(
    (row) => row.status === 'APPROVED' && row.orders.some((order) => order.status === 'APPROVED'),
  )

  const tickedList = (data?.orders ?? []).filter((row) => tickedOrders.has(row.id))
  const editOne = tickedList.length === 1 && canEditOrder(tickedList[0]) ? tickedList[0] : null
  const deletableOrders = tickedList.filter((row) => canDeleteOrder(row))

  async function removeTickedOrders() {
    if (!window.confirm(t('bulk.confirmN', { n: deletableOrders.length }))) return
    let failed = 0
    for (const row of deletableOrders) {
      try {
        await api(`/api/nid/orders/${row.id}`, { method: 'DELETE' })
      } catch {
        failed += 1
      }
    }
    setTickedOrders(new Set())
    if (failed > 0) push('error', t('bulk.someFailed', { n: failed }))
    else push('success', t('nido.removed'))
    reload()
  }

  async function run(path: string, body: unknown, message: string, method = 'PATCH') {
    setBusy(true)
    try {
      await api(path, { method, body })
      push('success', message)
      reload()
    } catch (caught) {
      push('error', caught instanceof Error ? caught.message : 'Failed.')
    } finally {
      setBusy(false)
    }
  }

  async function approveNames(orderIds: string[]) {
    setBusy(true)
    try {
      await api('/api/nid/requests/approve', { method: 'PATCH', body: { orderIds } })
      push('success', t('nido.approvedN', { n: orderIds.length }))
      reload()
    } catch (caught) {
      push('error', caught instanceof Error ? caught.message : 'Failed.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className={base.page}>
      <header className={base.head}>
        <div className={base.mobileHeading}>
          <h1 className={base.title}>{title}</h1>
          <p className={base.subtitle}>{t('nido.note')}</p>
        </div>
        <div className={base.headActions}>
          {role === 'SALES' ? (
            <>
              <button type="button" className={base.primary} onClick={() => setRegistering(true)}>
                + {t('nido.register')}
              </button>
              <button
                type="button"
                className={base.secondary}
                disabled={busy || toSend === 0}
                onClick={() => void run('/api/nid/requests', { kind }, t('nido.sent', { n: toSend }), 'POST')}
              >
                {t('nido.sendRequest', { n: toSend })}
              </button>
            </>
          ) : null}
          {role === 'SUPERVISOR' ? (
            <button
              type="button"
              className={base.primary}
              disabled={busy || toForward.length === 0}
              onClick={() =>
                void run(
                  '/api/nid/requests/forward-all',
                  { kind },
                  t('nido.forwardedAll', { n: toForward.reduce((sum, row) => sum + row.total, 0) }),
                )
              }
            >
              {t('nido.sendAllToOwner', { n: toForward.reduce((sum, row) => sum + row.total, 0) })}
            </button>
          ) : null}
          {role === 'OWNER' ? (
            <>
              <button
                type="button"
                className={base.primary}
                onClick={() => setPrintedForm('')}
              >
                {t('nido.printed')}
              </button>
              <button
                type="button"
                className={base.secondary}
                onClick={() => setWaitingForm(true)}
              >
                {t('nido.waiting')}
              </button>
              <button type="button" className={base.secondary} onClick={() => setPricing(true)}>
                {t('nido.prices')}
              </button>
            </>
          ) : null}
        </div>
      </header>

      <div className={styles.tiles}>
        <div className={styles.main}>
          <strong className="tabular">{currency(price)}</strong>
          <span>{t('nido.priceEach')}</span>
        </div>
        <div>
          <strong className="tabular">{count(data?.totals.waiting ?? 0)}</strong>
          <span>{t('nido.stWaiting')}</span>
        </div>
        <div>
          <strong className="tabular">
            {count((data?.totals.withSupervisor ?? 0) + (data?.totals.withOwner ?? 0))}
          </strong>
          <span>{t('nido.inProgress')}</span>
        </div>
        <div>
          <strong className="tabular">
            {count(data?.totals.done ?? 0)} / {count(data?.totals.leftover ?? 0)}
          </strong>
          <span>{t('nido.doneLeft')}</span>
        </div>
      </div>

      <Card title={t('nido.requests')}>
        {!data ? (
          <Empty>{t('common.loading')}</Empty>
        ) : data.requests.length === 0 ? (
          <Empty>{t('nido.noRequests')}</Empty>
        ) : (
          <div className={base.scroll}>
            <table className={base.table}>
              <thead>
                <tr>
                  <th scope="col">{t('req.date')}</th>
                  <th scope="col">{t('nido.from')}</th>
                  <th scope="col">{t('nido.names')}</th>
                  <th scope="col">{t('common.status')}</th>
                  <th scope="col">{t('nido.result')}</th>
                  <th scope="col" className={base.actionsCol}>
                    {t('common.actions')}
                  </th>
                </tr>
              </thead>
              <tbody>
                {data.requests.map((row) => {
                  return (
                  <tr key={row.id}>
                    <td data-label={t('req.date')}>{shortDate(row.createdAt)}</td>
                    <td data-label={t('nido.from')} className={base.strong}>
                      {row.requestedBy.name}
                      <em className={base.sub}>{row.location.name}</em>
                    </td>
                    <td data-label={t('nido.names')} className="tabular">{count(row.total)}</td>
                    <td data-label={t('common.status')}>
                      <span className={styles.kind} data-kind={row.status === 'RETURNED' || row.status === 'RECEIVED' ? 'LOAD' : 'PRINT'}>
                        {t(REQUEST_STATUS[row.status])}
                      </span>
                    </td>
                    <td data-label={t('nido.result')}>
                      {row.status === 'RETURNED' || row.status === 'RECEIVED'
                        ? t('nido.doneAndLeft', { done: count(row.doneCount ?? 0), left: count(row.leftoverCount ?? 0) })
                        : '—'}
                      {row.note ? <em className={base.sub}>{row.note}</em> : null}
                    </td>
                    <td className={base.actionsCol} style={{ whiteSpace: 'normal' }}>
                      {role === 'SUPERVISOR' && row.status === 'WITH_SUPERVISOR' ? (
                        <button
                          type="button"
                          className={base.primary}
                          disabled={busy}
                          onClick={() => void run(`/api/nid/requests/${row.id}/forward`, {}, t('nido.forwarded'))}
                        >
                          {t('nido.sendToOwner')}
                        </button>
                      ) : null}
                      {role === 'OWNER' && printableRequests.includes(row) ? (
                        <button type="button" className={base.secondary} disabled={busy} onClick={() => setPrintedForm(row.id)}>
                          {t('nido.sendBack')}
                        </button>
                      ) : null}
                      {role === 'SUPERVISOR' && row.status === 'RETURNED' ? (
                        <button
                          type="button"
                          className={base.primary}
                          disabled={busy}
                          onClick={() => void run(`/api/nid/requests/${row.id}/receive`, {}, t('nido.received'))}
                        >
                          {t('nido.receive')}
                        </button>
                      ) : null}
                      {role === 'OWNER' || row.status === 'WITH_SUPERVISOR' ? (
                        <button
                          type="button"
                          className={rowStyles.danger}
                          disabled={busy}
                          onClick={() => {
                            if (window.confirm(t('nido.deleteRequestConfirm', { name: row.requestedBy.name, n: row.total }))) {
                              void run(`/api/nid/requests/${row.id}`, {}, t('nido.requestDeleted'), 'DELETE')
                            }
                          }}
                        >
                          {t('prod.delete')}
                        </button>
                      ) : null}
                    </td>
                  </tr>
                )})}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card title={t('nido.customers')}>
        {!data ? null : data.orders.length === 0 ? (
          <Empty>{t('nido.noCustomers')}</Empty>
        ) : (
          <div className={base.scroll}>
            <table className={base.table}>
              <thead>
                <tr>
                  <th scope="col" className={bulk.tick} />
                  <th scope="col">{t('nido.fullName')}</th>
                  <th scope="col">{t('prod.price')}</th>
                  <th scope="col">{t('common.status')}</th>
                  <th scope="col">{t('req.date')}</th>
                  <th scope="col">{t('ibid.by')}</th>
                  <th scope="col" className={base.actionsCol}>
                    <HeaderActions
                      editEnabled={editOne != null}
                      onEdit={() => editOne && setEditing(editOne)}
                      deleteCount={deletableOrders.length}
                      onDelete={() => void removeTickedOrders()}
                    />
                  </th>
                </tr>
              </thead>
              <tbody>
                {data.orders.map((row) => (
                  <tr key={row.id}>
                    <td className={bulk.tick}>
                      {canEditOrder(row) || canDeleteOrder(row) ? (
                        <input
                          type="checkbox"
                          checked={tickedOrders.has(row.id)}
                          onChange={() =>
                            setTickedOrders((current) => {
                              const next = new Set(current)
                              if (next.has(row.id)) next.delete(row.id)
                              else next.add(row.id)
                              return next
                            })
                          }
                          aria-label={t('bulk.tickRow')}
                        />
                      ) : null}
                    </td>
                    <td data-label={t('nido.fullName')} className={base.strong}>{row.fullName}</td>
                    <td data-label={t('prod.price')} className="tabular">{currency(Number(row.price))}</td>
                    <td data-label={t('common.status')}>
                      <span className={styles.kind} data-kind={row.status === 'DONE' ? 'LOAD' : 'PRINT'}>
                        {t(ORDER_STATUS[row.status])}
                      </span>
                    </td>
                    <td data-label={t('req.date')}>{shortDate(row.createdAt)}</td>
                    <td data-label={t('ibid.by')}>
                      {row.recordedBy.name}
                      <em className={base.sub}>{row.location.name}</em>
                    </td>
                    <td className={base.actionsCol} />
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {registering ? (
        <RegisterDialog
          kind={kind}
          price={price}
          onClose={() => setRegistering(false)}
          onDone={(name) => {
            push('success', t('nido.registered', { name }))
            reload()
          }}
        />
      ) : null}

      {editing ? (
        <RegisterDialog
          kind={kind}
          price={Number(editing.price)}
          editing={editing}
          onClose={() => setEditing(null)}
          onDone={() => {
            setEditing(null)
            push('success', t('nido.edited'))
            reload()
          }}
        />
      ) : null}

      {waitingForm && role === 'OWNER' ? (
        <WaitingDialog
          requests={waitingAtOwner}
          busy={busy}
          onClose={() => setWaitingForm(false)}
          onApprove={(orderIds) => void approveNames(orderIds)}
        />
      ) : null}

      {printedForm !== null && role === 'OWNER' ? (
        <PrintedDialog
          kind={kind}
          requests={printableRequests}
          initialId={printedForm}
          onClose={() => setPrintedForm(null)}
          onDone={(done, left) => {
            setPrintedForm(null)
            push('success', t('nido.returned', { done, left }))
            reload()
          }}
        />
      ) : null}

      {pricing && data ? (
        <PricesDialog
          prices={data.prices}
          branchPrices={data.branchPrices ?? []}
          onClose={() => setPricing(false)}
          onDone={(message) => {
            setPricing(false)
            push('success', message ?? t('nido.pricesSaved'))
            reload()
          }}
        />
      ) : null}

      <Toasts toasts={toasts} onDismiss={dismiss} />
    </div>
  )
}

/** A tick box that can also show "some of these". */
function Check({
  checked,
  partly = false,
  onChange,
  label,
}: {
  checked: boolean
  partly?: boolean
  onChange: (checked: boolean) => void
  label: ReactNode
}) {
  return (
    <label className={pick.row}>
      <input
        type="checkbox"
        checked={checked}
        ref={(element) => {
          if (element) element.indeterminate = partly && !checked
        }}
        onChange={(event) => onChange(event.target.checked)}
      />
      <span>{label}</span>
    </label>
  )
}

/**
 * The Owner's waiting list: every name sent up and not yet approved, by
 * request. The Owner ticks all or some and approves them for printing;
 * the unticked ones keep waiting.
 */
function WaitingDialog({
  requests,
  busy,
  onClose,
  onApprove,
}: {
  requests: NidRequest[]
  busy: boolean
  onClose: () => void
  onApprove: (orderIds: string[]) => void
}) {
  const t = useT()
  const groups = requests.map((row) => ({
    request: row,
    names: row.orders.filter((order) => order.status === 'AT_OWNER'),
  }))
  const allIds = groups.flatMap((group) => group.names.map((name) => name.id))
  const [ticked, setTicked] = useState<Set<string>>(() => new Set())

  function toggle(ids: string[], on: boolean) {
    setTicked((current) => {
      const next = new Set(current)
      ids.forEach((id) => (on ? next.add(id) : next.delete(id)))
      return next
    })
  }

  const chosen = allIds.filter((id) => ticked.has(id))

  return (
    <Dialog title={t('nido.waitingForm')} note={t('nido.waitingNote')} onClose={onClose}>
      <div className={panel.body}>
        {allIds.length === 0 ? (
          <p className={panel.hint}>{t('nido.noneWaitingAtOwner')}</p>
        ) : (
          <>
            <div className={pick.all}>
              <Check
                checked={chosen.length === allIds.length}
                partly={chosen.length > 0}
                onChange={(on) => toggle(allIds, on)}
                label={<strong>{`${t('nido.selectAll')} (${count(allIds.length)})`}</strong>}
              />
            </div>

            {groups.map(({ request, names }) => {
              const ids = names.map((name) => name.id)
              const some = ids.filter((id) => ticked.has(id)).length
              return (
                <section key={request.id} className={pick.group}>
                  <Check
                    checked={some === ids.length}
                    partly={some > 0}
                    onChange={(on) => toggle(ids, on)}
                    label={
                      <>
                        <strong>{request.location.name}</strong>
                        <em className={base.sub}>
                          {`${request.requestedBy.name} · ${shortDate(request.createdAt)} · ${t('nido.nNames', { n: count(ids.length) })}`}
                        </em>
                      </>
                    }
                  />
                  <div className={pick.names}>
                    {names.map((name) => (
                      <div key={name.id} className={pick.line}>
                        <Check
                          checked={ticked.has(name.id)}
                          onChange={(on) => toggle([name.id], on)}
                          label={name.fullName}
                        />
                        <button
                          type="button"
                          className={pick.approve}
                          disabled={busy}
                          onClick={() => onApprove([name.id])}
                        >
                          {t('nido.approve')}
                        </button>
                      </div>
                    ))}
                  </div>
                </section>
              )
            })}
          </>
        )}

        <div className={panel.actions}>
          <button type="button" className={panel.cancel} onClick={onClose}>
            {t('common.close')}
          </button>
          {allIds.length > 0 ? (
            <button
              type="button"
              className={panel.submit}
              disabled={busy || chosen.length === 0}
              onClick={() => onApprove(chosen)}
            >
              {t('nido.approveSelected', { n: count(chosen.length) })}
            </button>
          ) : null}
        </div>
      </div>
    </Dialog>
  )
}

/**
 * The Owner sends a request back. The names approved on the waiting list
 * are listed already ticked, so the count printed comes from them rather
 * than being typed; anything unticked or never approved is a leftover.
 */
function PrintedDialog({
  kind,
  requests,
  initialId,
  onClose,
  onDone,
}: {
  kind: NidKind
  requests: NidRequest[]
  initialId: string
  onClose: () => void
  onDone: (done: number, left: number) => void
}) {
  const t = useT()
  const [requestId, setRequestId] = useState(
    requests.some((row) => row.id === initialId) ? initialId : (requests[0]?.id ?? ''),
  )
  const selected = requests.find((row) => row.id === requestId) ?? null
  const approved = selected ? selected.orders.filter((order) => order.status === 'APPROVED') : []
  const [ticked, setTicked] = useState<Set<string>>(() => new Set(approved.map((order) => order.id)))
  const [note, setNote] = useState('')
  const [returnedOn, setReturnedOn] = useState(todayIso())
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function choose(id: string) {
    const next = requests.find((row) => row.id === id)
    setRequestId(id)
    setTicked(new Set((next?.orders ?? []).filter((order) => order.status === 'APPROVED').map((order) => order.id)))
    setError(null)
  }

  const printedIds = approved.filter((order) => ticked.has(order.id)).map((order) => order.id)
  const done = printedIds.length
  const left = (selected?.orders.length ?? 0) - done

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    if (!selected || busy) return
    setBusy(true)
    setError(null)
    try {
      await api(`/api/nid/requests/${selected.id}/return`, {
        method: 'PATCH',
        body: { printedIds, returnedOn, ...(note.trim() ? { note: note.trim() } : {}) },
      })
      onDone(done, left)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not save it.')
    } finally {
      setBusy(false)
    }
  }

  const doneLabel = t(kind === 'ORIGINAL' ? 'nido.printed' : 'nido.copied')

  return (
    <Dialog title={t('nido.printedForm')} note={t('nido.printedNote')} onClose={onClose}>
      <form className={panel.body} onSubmit={handleSubmit}>
        {!selected ? (
          <p className={panel.hint}>{t('nido.noneApprovedToPrint')}</p>
        ) : (
          <>
            {requests.length > 1 ? (
              <label className={panel.field}>
                <span>{t('nido.requests')}</span>
                <select value={requestId} onChange={(event) => choose(event.target.value)}>
                  {requests.map((row) => (
                    <option key={row.id} value={row.id}>
                      {`${row.location.name} · ${row.requestedBy.name} · ${t('nido.nNames', { n: count(row.orders.filter((order) => order.status === 'APPROVED').length) })}`}
                    </option>
                  ))}
                </select>
              </label>
            ) : (
              <p className={panel.hint}>{`${selected.location.name} · ${selected.requestedBy.name}`}</p>
            )}

            <div className={pick.group}>
              <Check
                checked={done === approved.length}
                partly={done > 0}
                onChange={(on) => setTicked(new Set(on ? approved.map((order) => order.id) : []))}
                label={<strong>{`${doneLabel} (${count(done)} / ${count(approved.length)})`}</strong>}
              />
              <div className={pick.names}>
                {approved.map((order) => (
                  <Check
                    key={order.id}
                    checked={ticked.has(order.id)}
                    onChange={(on) =>
                      setTicked((current) => {
                        const next = new Set(current)
                        if (on) next.add(order.id)
                        else next.delete(order.id)
                        return next
                      })
                    }
                    label={order.fullName}
                  />
                ))}
              </div>
            </div>

            <dl className={panel.facts}>
              <div>
                <dt>{doneLabel}</dt>
                <dd className="tabular">
                  <strong>{count(done)}</strong>
                </dd>
              </div>
              <div>
                <dt>{t('nido.stLeftover')}</dt>
                <dd className="tabular">{count(left)}</dd>
              </div>
            </dl>

            <label className={panel.field}>
              <span>{t('req.date')}</span>
              <input
                type="date"
                value={returnedOn}
                onChange={(event) => setReturnedOn(event.target.value)}
                required
              />
            </label>

            <label className={panel.field}>
              <span>
                {t('dlg.note')}<em>{t('prod.optional')}</em>
              </span>
              <input value={note} onChange={(event) => setNote(event.target.value)} maxLength={300} />
            </label>
          </>
        )}

        {error ? <p className={panel.error}>{error}</p> : null}

        <div className={panel.actions}>
          <button type="button" className={panel.cancel} onClick={onClose}>
            {t('common.close')}
          </button>
          {selected ? (
            <button type="submit" className={panel.submit} disabled={busy}>
              {busy ? t('prod.saving') : t('nido.sendBack')}
            </button>
          ) : null}
        </div>
      </form>
    </Dialog>
  )
}

/** A salesperson registers one customer; the form stays open for the next. */
export function RegisterDialog({
  kind,
  price,
  editing,
  onClose,
  onDone,
}: {
  kind: NidKind
  price: number
  /** A customer being corrected: the name and how they paid; the price stays. */
  editing?: NidOrder
  onClose: () => void
  onDone: (name: string) => void
}) {
  const t = useT()
  const [fullName, setFullName] = useState(editing?.fullName ?? '')
  const [payment, setPayment] = useState<Payment>(editing ? paymentOf(editing) : CASH_PAYMENT)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const valid =
    fullName.trim().split(/\s+/).length >= 2 && fullName.trim().length >= 3 && paymentValid(payment, price)

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    if (!valid || busy) return
    setBusy(true)
    setError(null)
    try {
      await api(editing ? `/api/nid/orders/${editing.id}` : '/api/nid/orders', {
        method: editing ? 'PATCH' : 'POST',
        body: { ...(editing ? {} : { kind }), fullName: fullName.trim(), ...paymentBody(payment) },
      })
      onDone(fullName.trim())
      if (editing) return
      setFullName('')
      setPayment(CASH_PAYMENT)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not save it.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog
      title={t(editing ? 'nido.editTitle' : kind === 'ORIGINAL' ? 'nido.registerOriginal' : 'nido.registerCopy')}
      note={editing ? undefined : t('nido.registerNote')}
      onClose={onClose}
    >
      <form className={panel.body} onSubmit={handleSubmit}>
        <label className={panel.field}>
          <span>
            {t('nido.fullName')}<em>{t('nido.fullNameNote')}</em>
          </span>
          <input value={fullName} onChange={(event) => setFullName(event.target.value)} maxLength={150} autoFocus required />
        </label>

        <dl className={panel.facts}>
          <div>
            <dt>{t('prod.price')}</dt>
            <dd className="tabular">
              <strong>{currency(price)}</strong>
            </dd>
          </div>
        </dl>

        <PaymentPicker value={payment} onChange={setPayment} amount={price} />

        {error ? <p className={panel.error}>{error}</p> : null}

        <div className={panel.actions}>
          <button type="button" className={panel.cancel} onClick={onClose}>
            {t('common.close')}
          </button>
          <button type="submit" className={panel.submit} disabled={!valid || busy}>
            {busy ? t('prod.saving') : t(editing ? 'common.save' : 'nido.register')}
          </button>
        </div>
      </form>
    </Dialog>
  )
}

/**
 * The Owner sets the price of a printed ID and of a copy: the default, or a
 * branch's own. The branch is chosen first, so it is clear which price is
 * being changed.
 */
function PricesDialog({
  prices,
  branchPrices,
  onClose,
  onDone,
}: {
  prices: Record<NidKind, number>
  branchPrices: NonNullable<NidOverview['branchPrices']>
  onClose: () => void
  onDone: (message?: string) => void
}) {
  const t = useT()
  const branches = useBranchList()
  const [branchId, setBranchId] = useState('')
  const own = branchPrices.find((row) => row.branchId === branchId) ?? null
  const shown = own ?? prices
  const [original, setOriginal] = useState(String(prices.ORIGINAL))
  const [copy, setCopy] = useState(String(prices.COPY))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const valid = Number(original) >= 0 && Number(copy) >= 0 && original.trim() !== '' && copy.trim() !== ''
  const branchName = branches.find(([id]) => id === branchId)?.[1] ?? ''

  function choose(id: string) {
    const next = branchPrices.find((row) => row.branchId === id) ?? prices
    setBranchId(id)
    setOriginal(String(next.ORIGINAL))
    setCopy(String(next.COPY))
    setError(null)
  }

  async function send(request: () => Promise<unknown>, message?: string) {
    setBusy(true)
    setError(null)
    try {
      await request()
      onDone(message)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not save it.')
    } finally {
      setBusy(false)
    }
  }

  function handleSubmit(event: FormEvent) {
    event.preventDefault()
    if (!valid || busy) return
    void send(() =>
      branchId === ''
        ? api('/api/settings', {
            method: 'PATCH',
            body: { nationalIdOriginalRate: Number(original), nationalIdCopyRate: Number(copy) },
          })
        : api(`/api/nid/prices/${branchId}`, {
            method: 'PUT',
            body: { ORIGINAL: Number(original), COPY: Number(copy) },
          }),
    )
  }

  return (
    <Dialog title={t('nido.prices')} note={t('nido.pricesNote')} onClose={onClose}>
      <form className={panel.body} onSubmit={handleSubmit}>
        <label className={panel.field}>
          <span>{t('common.branch')}</span>
          <select value={branchId} onChange={(event) => choose(event.target.value)} autoFocus>
            <option value="">{t('nido.priceDefault')}</option>
            {branches.map(([id, name]) => {
              const set = branchPrices.find((row) => row.branchId === id)
              return (
                <option key={id} value={id}>
                  {set ? `${name} · ${currency(set.ORIGINAL)} / ${currency(set.COPY)}` : name}
                </option>
              )
            })}
          </select>
          {branchId !== '' ? (
            <small className={panel.hint}>{t(own ? 'nido.priceOwn' : 'nido.priceUsesDefault')}</small>
          ) : null}
        </label>

        <label className={panel.field}>
          <span>{t('nido.priceOriginal')}</span>
          <input type="number" inputMode="decimal" min="0" step="0.01" value={original} onChange={(event) => setOriginal(event.target.value)} required />
        </label>
        <label className={panel.field}>
          <span>{t('nido.priceCopy')}</span>
          <input type="number" inputMode="decimal" min="0" step="0.01" value={copy} onChange={(event) => setCopy(event.target.value)} required />
        </label>

        {branchId !== '' && !own ? (
          <p className={panel.hint}>
            {`${t('nido.priceDefault')}: ${currency(shown.ORIGINAL)} / ${currency(shown.COPY)}`}
          </p>
        ) : null}

        {error ? <p className={panel.error}>{error}</p> : null}

        <div className={panel.actions}>
          <button type="button" className={panel.cancel} onClick={onClose}>
            {t('common.cancel')}
          </button>
          {own ? (
            <button
              type="button"
              className={panel.cancel}
              disabled={busy}
              onClick={() =>
                void send(
                  () => api(`/api/nid/prices/${branchId}`, { method: 'DELETE' }),
                  t('nido.priceReset', { name: branchName }),
                )
              }
            >
              {t('nido.priceUseDefault')}
            </button>
          ) : null}
          <button type="submit" className={panel.submit} disabled={!valid || busy}>
            {busy ? t('prod.saving') : t('common.save')}
          </button>
        </div>
      </form>
    </Dialog>
  )
}

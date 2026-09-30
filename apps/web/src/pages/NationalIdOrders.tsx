import { useEffect, useState, type FormEvent, type ReactNode } from 'react'

import { useAuth } from '../auth/context'
import { Card, Empty } from '../components/Card'
import { Toasts } from '../components/Toasts'
import { api } from '../lib/api'
import { count, currency, shortDate } from '../lib/format'
import { useT, type TranslationKey } from '../lib/i18n'
import { useToasts } from '../lib/toasts'
import type { NidKind, NidOverview, NidRequest } from '../lib/types'
import panel from '../components/inventory/Panel.module.css'
import base from './Products.module.css'
import styles from './Ibid.module.css'

const ORDER_STATUS: Record<string, TranslationKey> = {
  REGISTERED: 'nido.stWaiting',
  REQUESTED: 'nido.stWithSupervisor',
  AT_OWNER: 'nido.stWithOwner',
  DONE: 'nido.stDone',
  LEFTOVER: 'nido.stLeftover',
}

const REQUEST_STATUS: Record<NidRequest['status'], TranslationKey> = {
  WITH_SUPERVISOR: 'nido.stWithSupervisor',
  WITH_OWNER: 'nido.stWithOwner',
  RETURNED: 'nido.stReturned',
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

  const [data, setData] = useState<NidOverview | null>(null)
  const [reloadKey, setReloadKey] = useState(0)
  const [registering, setRegistering] = useState(false)
  const [returning, setReturning] = useState<NidRequest | null>(null)
  const [pricing, setPricing] = useState(false)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    const controller = new AbortController()
    api<NidOverview>(`/api/nid?kind=${kind}`, { signal: controller.signal })
      .then(setData)
      .catch(() => undefined)
    return () => controller.abort()
  }, [kind, reloadKey])

  const reload = () => setReloadKey((n) => n + 1)
  const price = data?.prices[kind] ?? 0
  const title = t(kind === 'ORIGINAL' ? 'nido.titleOriginal' : 'nido.titleCopy')
  const toSend = (data?.totals.waiting ?? 0) + (data?.totals.leftover ?? 0)

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
          {role === 'OWNER' ? (
            <button type="button" className={base.secondary} onClick={() => setPricing(true)}>
              {t('nido.prices')}
            </button>
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
                {data.requests.map((row) => (
                  <tr key={row.id}>
                    <td data-label={t('req.date')}>{shortDate(row.createdAt)}</td>
                    <td data-label={t('nido.from')} className={base.strong}>
                      {row.requestedBy.name}
                      <em className={base.sub}>{row.location.name}</em>
                    </td>
                    <td data-label={t('nido.names')} className="tabular">{count(row.total)}</td>
                    <td data-label={t('common.status')}>
                      <span className={styles.kind} data-kind={row.status === 'RETURNED' ? 'LOAD' : 'PRINT'}>
                        {t(REQUEST_STATUS[row.status])}
                      </span>
                    </td>
                    <td data-label={t('nido.result')}>
                      {row.status === 'RETURNED'
                        ? t('nido.doneAndLeft', { done: count(row.doneCount ?? 0), left: count(row.leftoverCount ?? 0) })
                        : '—'}
                      {row.note ? <em className={base.sub}>{row.note}</em> : null}
                    </td>
                    <td className={base.actionsCol}>
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
                      {role === 'OWNER' && row.status === 'WITH_OWNER' ? (
                        <button type="button" className={base.primary} onClick={() => setReturning(row)}>
                          {t('nido.sendBack')}
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

      <Card title={t('nido.customers')}>
        {!data ? null : data.orders.length === 0 ? (
          <Empty>{t('nido.noCustomers')}</Empty>
        ) : (
          <div className={base.scroll}>
            <table className={base.table}>
              <thead>
                <tr>
                  <th scope="col">{t('nido.fullName')}</th>
                  <th scope="col">{t('prod.price')}</th>
                  <th scope="col">{t('common.status')}</th>
                  <th scope="col">{t('req.date')}</th>
                  <th scope="col">{t('ibid.by')}</th>
                  <th scope="col" />
                </tr>
              </thead>
              <tbody>
                {data.orders.map((row) => (
                  <tr key={row.id}>
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
                    <td>
                      {row.status === 'REGISTERED' && (role !== 'SALES' || row.recordedBy.id === user?.id) ? (
                        <button
                          type="button"
                          className={styles.remove}
                          onClick={() => {
                            if (window.confirm(t('nido.removeConfirm', { name: row.fullName }))) {
                              void run(`/api/nid/orders/${row.id}`, {}, t('nido.removed'), 'DELETE')
                            }
                          }}
                        >
                          {t('prod.delete')}
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

      {returning ? (
        <ReturnDialog
          request={returning}
          onClose={() => setReturning(null)}
          onDone={(done, left) => {
            setReturning(null)
            push('success', t('nido.returned', { done, left }))
            reload()
          }}
        />
      ) : null}

      {pricing && data ? (
        <PricesDialog
          prices={data.prices}
          onClose={() => setPricing(false)}
          onDone={() => {
            setPricing(false)
            push('success', t('nido.pricesSaved'))
            reload()
          }}
        />
      ) : null}

      <Toasts toasts={toasts} onDismiss={dismiss} />
    </div>
  )
}

/** A salesperson registers one customer; the form stays open for the next. */
function RegisterDialog({ kind, price, onClose, onDone }: { kind: NidKind; price: number; onClose: () => void; onDone: (name: string) => void }) {
  const t = useT()
  const [fullName, setFullName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const valid = fullName.trim().split(/\s+/).length >= 2 && fullName.trim().length >= 3

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    if (!valid || busy) return
    setBusy(true)
    setError(null)
    try {
      await api('/api/nid/orders', { method: 'POST', body: { kind, fullName: fullName.trim() } })
      onDone(fullName.trim())
      setFullName('')
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not save it.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog title={t(kind === 'ORIGINAL' ? 'nido.registerOriginal' : 'nido.registerCopy')} note={t('nido.registerNote')} onClose={onClose}>
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

        {error ? <p className={panel.error}>{error}</p> : null}

        <div className={panel.actions}>
          <button type="button" className={panel.cancel} onClick={onClose}>
            {t('common.close')}
          </button>
          <button type="submit" className={panel.submit} disabled={!valid || busy}>
            {busy ? t('prod.saving') : t('nido.register')}
          </button>
        </div>
      </form>
    </Dialog>
  )
}

/** The Owner sends a request back with how many were done; the rest are leftovers. */
function ReturnDialog({ request, onClose, onDone }: { request: NidRequest; onClose: () => void; onDone: (done: number, left: number) => void }) {
  const t = useT()
  const [done, setDone] = useState(String(request.total))
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const value = Number(done)
  const valid = done.trim() !== '' && Number.isInteger(value) && value >= 0 && value <= request.total
  const left = valid ? request.total - value : 0

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    if (!valid || busy) return
    setBusy(true)
    setError(null)
    try {
      await api(`/api/nid/requests/${request.id}/return`, {
        method: 'PATCH',
        body: { doneCount: value, ...(note.trim() ? { note: note.trim() } : {}) },
      })
      onDone(value, left)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not save it.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog
      title={t(request.kind === 'ORIGINAL' ? 'nido.returnOriginal' : 'nido.returnCopy')}
      note={`${request.requestedBy.name} · ${request.location.name} · ${t('nido.nNames', { n: request.total })}`}
      onClose={onClose}
    >
      <form className={panel.body} onSubmit={handleSubmit}>
        <label className={panel.field}>
          <span>
            {t(request.kind === 'ORIGINAL' ? 'nido.howManyPrinted' : 'nido.howManyCopied')}
            <em>{t('nido.outOf', { n: request.total })}</em>
          </span>
          <input type="number" inputMode="numeric" min="0" max={request.total} step="1" value={done} onChange={(event) => setDone(event.target.value)} autoFocus required />
        </label>

        <dl className={panel.facts}>
          <div>
            <dt>{t('nido.stDone')}</dt>
            <dd className="tabular">{valid ? count(value) : '—'}</dd>
          </div>
          <div>
            <dt>{t('nido.stLeftover')}</dt>
            <dd className="tabular">
              <strong>{valid ? count(left) : '—'}</strong>
            </dd>
          </div>
        </dl>

        <label className={panel.field}>
          <span>
            {t('dlg.note')}<em>{t('prod.optional')}</em>
          </span>
          <input value={note} onChange={(event) => setNote(event.target.value)} maxLength={300} />
        </label>

        {error ? <p className={panel.error}>{error}</p> : null}

        <div className={panel.actions}>
          <button type="button" className={panel.cancel} onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button type="submit" className={panel.submit} disabled={!valid || busy}>
            {busy ? t('prod.saving') : t('nido.sendBack')}
          </button>
        </div>
      </form>
    </Dialog>
  )
}

/** The Owner sets the price of a printed ID and of a copy. */
function PricesDialog({ prices, onClose, onDone }: { prices: Record<NidKind, number>; onClose: () => void; onDone: () => void }) {
  const t = useT()
  const [original, setOriginal] = useState(String(prices.ORIGINAL))
  const [copy, setCopy] = useState(String(prices.COPY))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const valid = Number(original) >= 0 && Number(copy) >= 0 && original.trim() !== '' && copy.trim() !== ''

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    if (!valid || busy) return
    setBusy(true)
    setError(null)
    try {
      await api('/api/settings', {
        method: 'PATCH',
        body: { nationalIdOriginalRate: Number(original), nationalIdCopyRate: Number(copy) },
      })
      onDone()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not save it.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog title={t('nido.prices')} note={t('nido.pricesNote')} onClose={onClose}>
      <form className={panel.body} onSubmit={handleSubmit}>
        <label className={panel.field}>
          <span>{t('nido.priceOriginal')}</span>
          <input type="number" inputMode="decimal" min="0" step="0.01" value={original} onChange={(event) => setOriginal(event.target.value)} required />
        </label>
        <label className={panel.field}>
          <span>{t('nido.priceCopy')}</span>
          <input type="number" inputMode="decimal" min="0" step="0.01" value={copy} onChange={(event) => setCopy(event.target.value)} required />
        </label>

        {error ? <p className={panel.error}>{error}</p> : null}

        <div className={panel.actions}>
          <button type="button" className={panel.cancel} onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button type="submit" className={panel.submit} disabled={!valid || busy}>
            {busy ? t('prod.saving') : t('common.save')}
          </button>
        </div>
      </form>
    </Dialog>
  )
}

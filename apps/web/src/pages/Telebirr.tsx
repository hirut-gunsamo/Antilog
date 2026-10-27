import { useEffect, useState } from 'react'
import bulk from '../components/BulkDelete.module.css'
import { HeaderActions } from '../components/HeaderActions'
import { businessDay } from '../lib/tz'
import { useSavedState } from '../lib/savedState'

import { useAuth } from '../auth/context'
import { Card, Empty } from '../components/Card'
import { LoadTelebirrDialog, RecordTelebirrDialog } from '../components/telebirr/TelebirrDialogs'
import { Toasts } from '../components/Toasts'
import { api } from '../lib/api'
import { useBranchList } from '../lib/branches'
import { count, currency, shortDate } from '../lib/format'
import { useT } from '../lib/i18n'
import { useToasts } from '../lib/toasts'
import { EditLoadDialog } from '../components/ibid/EditLoadDialog'
import type { TelebirrSummary } from '../lib/types'
import base from './Products.module.css'
import styles from './Ibid.module.css'

function isoDay(date: Date) {
  return businessDay(date)
}

const KIND_KEY = { CASH_IN: 'tb.cashIn', AIRTIME: 'tb.airtime', LOAD: 'ibid.kindLoad' } as const

/**
 * Telebirr: each branch has its own Telebirr account. The Owner loads money
 * into a branch; that branch's sellers record cash-ins and airtime sold from
 * it, and both come off that branch's balance. The report splits cash-in and
 * airtime by branch and by seller for the chosen dates.
 */
export default function Telebirr() {
  const { user } = useAuth()
  const t = useT()
  const { toasts, push, dismiss } = useToasts()
  const isOwner = user?.role === 'OWNER'
  const branchList = useBranchList()

  const now = new Date()
  const [from, setFrom] = useSavedState('telebirr:from', isoDay(new Date(now.getFullYear(), now.getMonth(), 1)))
  const [to, setTo] = useSavedState('telebirr:to', isoDay(now))
  const [branch, setBranch] = useState('')

  const [data, setData] = useState<TelebirrSummary | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [reloadKey, setReloadKey] = useState(0)
  const [loading, setLoading] = useState(false)
  const [recording, setRecording] = useState(false)

  useEffect(() => {
    const controller = new AbortController()
    const query = new URLSearchParams({ from, to })
    if (isOwner && branch) query.set('branchId', branch)

    api<TelebirrSummary>(`/api/telebirr?${query}`, { signal: controller.signal })
      .then((payload) => {
        setData(payload)
        setError(null)
      })
      .catch((caught: unknown) => {
        if (controller.signal.aborted) return
        setError(caught instanceof Error ? caught.message : 'Could not load.')
      })

    return () => controller.abort()
  }, [from, to, branch, isOwner, reloadKey])

  // A load being corrected.
  const [editingLoad, setEditingLoad] = useState<TelebirrSummary['entries'][number] | null>(null)
  const [editingEntry, setEditingEntry] = useState<TelebirrSummary['entries'][number] | null>(null)

  // The Owner changes anything; a supervisor their branch's cash-ins and
  // airtime; a seller edits only their own from today.
  const canEdit = (entry: TelebirrSummary['entries'][number]) =>
    isOwner ||
    (entry.kind !== 'LOAD' &&
      (user?.role === 'SUPERVISOR' ||
        (entry.by.id === user?.id && (entry.editable ?? businessDay(new Date(entry.at)) === businessDay()))))
  // Sellers remove the same entries they may edit.
  const canDelete = (entry: TelebirrSummary['entries'][number]) =>
    isOwner || (entry.kind !== 'LOAD' && (user?.role === 'SUPERVISOR' || (user?.role === 'SALES' && canEdit(entry))))
  const anyActions = (data?.entries ?? []).some((entry) => canEdit(entry) || canDelete(entry))
  // Ticked rows: Edit acts on one, Delete on all of them.
  const [ticked, setTicked] = useState<Set<string>>(new Set())
  const keyOf = (entry: TelebirrSummary['entries'][number]) => `${entry.kind}-${entry.id}`
  const tickedRows = (data?.entries ?? []).filter((entry) => ticked.has(keyOf(entry)))
  const editOne = tickedRows.length === 1 && canEdit(tickedRows[0]) ? tickedRows[0] : null
  const deletableRows = tickedRows.filter((entry) => canDelete(entry))

  async function removeTicked() {
    if (!window.confirm(t('ibid.removeConfirm'))) return
    let failed = 0
    for (const entry of deletableRows) {
      try {
        await api(`/api/telebirr/${entry.kind === 'LOAD' ? 'loads' : 'transactions'}/${entry.id}`, { method: 'DELETE' })
      } catch {
        failed += 1
      }
    }
    setTicked(new Set())
    if (failed > 0) push('error', t('bulk.someFailed', { n: failed }))
    else push('success', t('ibid.removed'))
    reload()
  }
  const reload = () => setReloadKey((n) => n + 1)


  const splitTable = (
    title: string,
    rows: { id: string; name: string; sub?: string; cashIn: number; airtime: number; count: number }[],
  ) => (
    <Card>
      <h2 className={styles.sectionTitle}>{title}</h2>
      {rows.length === 0 ? (
        <Empty>{t('tb.none')}</Empty>
      ) : (
        <div className={base.scroll}>
          <table className={base.table}>
            <thead>
              <tr>
                <th scope="col">{t('prod.name')}</th>
                <th scope="col">{t('tb.cashIn')}</th>
                <th scope="col">{t('tb.airtime')}</th>
                <th scope="col">{t('ibid.total')}</th>
                <th scope="col">{t('tb.count')}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id}>
                  <td data-label={t('prod.name')} className={base.strong}>
                    {row.name}
                    {row.sub ? <em className={base.sub}>{row.sub}</em> : null}
                  </td>
                  <td data-label={t('tb.cashIn')} className="tabular">{currency(row.cashIn)}</td>
                  <td data-label={t('tb.airtime')} className="tabular">{currency(row.airtime)}</td>
                  <td data-label={t('ibid.total')} className={`${base.strong} tabular`}>{currency(row.cashIn + row.airtime)}</td>
                  <td data-label={t('tb.count')} className="tabular">{count(row.count)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  )

  return (
    <div className={base.page}>
      <header className={base.head}>
        <div className={base.mobileHeading}>
          <h1 className={base.title}>{t('tb.title')}</h1>
          <p className={base.subtitle}>{t('tb.note')}</p>
        </div>
        <div className={base.headActions}>
          {isOwner ? (
            <button type="button" className={base.secondary} onClick={() => setLoading(true)}>
              + {t('tb.load')}
            </button>
          ) : null}
          {/* Supervisors and sellers see what is left in their branch's own
              account right beside the button that spends it. */}
          {!isOwner ? (
            <div className={styles.headBalance}>
              {t('tb.branchBalance')}:
              {/* Keyed on the amount, so a new figure eases in. */}
              <strong key={data?.balance ?? 'none'} className="tabular">
                {/* Just the figure, e.g. 100,000: the label says what it is. */}
                {data ? count(Math.round(Number(data.balance))) : '—'}
              </strong>
            </div>
          ) : null}
          <button type="button" className={base.primary} onClick={() => setRecording(true)}>
            + {t('tb.record')}
          </button>
        </div>
      </header>

      <div className={styles.tiles}>
        <div className={styles.main}>
          <strong className="tabular">{data ? currency(Number(data.balance)) : '—'}</strong>
          <span>{t(isOwner && !branch ? 'tb.balanceAll' : 'tb.balance')}</span>
        </div>
        <div>
          <strong className="tabular">{data ? currency(data.period.cashIn) : '—'}</strong>
          <span>{t('tb.cashInPeriod')}</span>
        </div>
        <div>
          <strong className="tabular">{data ? currency(data.period.airtime) : '—'}</strong>
          <span>{t('tb.airtimePeriod')}</span>
        </div>
        <div>
          <strong className="tabular">{data ? currency(data.today.cashIn + data.today.airtime) : '—'}</strong>
          <span>{t('tb.today')}</span>
        </div>
      </div>

      <Card>
        <div className={styles.filters} style={{ marginBottom: 0 }}>
          <label>
            {t('ibid.from')}
            <input type="date" value={from} max={to} onChange={(event) => setFrom(event.target.value)} />
          </label>
          <label>
            {t('ibid.to')}
            <input type="date" value={to} min={from} onChange={(event) => setTo(event.target.value)} />
          </label>
          {isOwner ? (
            <select value={branch} onChange={(event) => setBranch(event.target.value)} aria-label={t('common.branch')}>
              <option value="">{t('inv.allBranches')}</option>
              {branchList.map(([id, name]) => (
                <option key={id} value={id}>
                  {name}
                </option>
              ))}
            </select>
          ) : null}
          {isOwner && data ? (
            <span style={{ marginLeft: 'auto', fontSize: 12.5, color: 'var(--muted)' }}>
              {t('tb.loadedPeriod', { amount: currency(data.loadedInPeriod) })}
            </span>
          ) : null}
        </div>
        {error ? <Empty>{error}</Empty> : null}
      </Card>

      {/* The Owner's view of every branch's own account. */}
      {isOwner && data ? (
        <Card>
          <h2 className={styles.sectionTitle}>{t('tb.branchBalances')}</h2>
          {data.balances.length === 0 ? (
            <Empty>{t('tb.none')}</Empty>
          ) : (
            <div className={base.scroll}>
              <table className={base.table}>
                <thead>
                  <tr>
                    <th scope="col">{t('common.branch')}</th>
                    <th scope="col">{t('tb.balance')}</th>
                  </tr>
                </thead>
                <tbody>
                  {data.balances.map((row) => (
                    <tr key={row.id}>
                      <td data-label={t('common.branch')} className={base.strong}>{row.name}</td>
                      <td data-label={t('tb.balance')} className={`${base.strong} tabular`}>
                        {currency(row.balance)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      ) : null}

      {data && user?.role !== 'SALES' ? splitTable(t('tb.byBranch'), data.byBranch) : null}
      {data ? splitTable(t('tb.bySeller'), data.bySeller.map((row) => ({ ...row, sub: row.branch }))) : null}

      <Card>
        <h2 className={styles.sectionTitle}>{t('ibid.history')}</h2>
        {!data ? (
          <Empty>{t('common.loading')}</Empty>
        ) : data.entries.length === 0 ? (
          <Empty>{t('ibid.noEntries')}</Empty>
        ) : (
          <div className={base.scroll}>
            <table className={base.table}>
              <thead>
                <tr>
                  {anyActions ? <th scope="col" className={bulk.tick} /> : null}
                  <th scope="col">{t('req.date')}</th>
                  <th scope="col">{t('ibid.entry')}</th>
                  <th scope="col">{t('ibid.amountBirr')}</th>
                  <th scope="col">{t('common.branch')}</th>
                  <th scope="col">{t('ibid.by')}</th>
                  <th scope="col">{t('tb.customerPhone')}</th>
                  {anyActions ? (
                    <th scope="col">
                      <HeaderActions
                        editEnabled={editOne != null}
                        onEdit={() => editOne && (editOne.kind === 'LOAD' ? setEditingLoad(editOne) : setEditingEntry(editOne))}
                        deleteCount={deletableRows.length}
                        onDelete={() => void removeTicked()}
                      />
                    </th>
                  ) : null}
                </tr>
              </thead>
              <tbody>
                {data.entries.map((entry) => (
                  <tr key={`${entry.kind}-${entry.id}`}>
                    {anyActions ? (
                      <td className={bulk.tick}>
                        {canEdit(entry) || canDelete(entry) ? (
                          <input
                            type="checkbox"
                            checked={ticked.has(keyOf(entry))}
                            onChange={() =>
                              setTicked((current) => {
                                const next = new Set(current)
                                if (next.has(keyOf(entry))) next.delete(keyOf(entry))
                                else next.add(keyOf(entry))
                                return next
                              })
                            }
                            aria-label={t('bulk.tickRow')}
                          />
                        ) : null}
                      </td>
                    ) : null}
                    <td data-label={t('req.date')}>{shortDate(entry.at)}</td>
                    <td data-label={t('ibid.entry')}>
                      <span className={styles.kind} data-kind={entry.kind === 'LOAD' ? 'LOAD' : 'PRINT'}>
                        {t(KIND_KEY[entry.kind])}
                      </span>
                      {entry.note ? <em className={base.sub}>{entry.note}</em> : null}
                    </td>
                    <td data-label={t('ibid.amountBirr')} className={`${base.strong} tabular`}>
                      {entry.kind === 'LOAD' ? '+' : '−'}
                      {currency(Number(entry.amount))}
                    </td>
                    <td data-label={t('common.branch')}>{entry.branch?.name ?? '—'}</td>
                    <td data-label={t('ibid.by')}>{entry.by.name}</td>
                    <td data-label={t('tb.customerPhone')}>{entry.customerPhone ?? '—'}</td>
                    {anyActions ? <td /> : null}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {loading ? (
        <LoadTelebirrDialog
          balances={data?.balances ?? []}
          initialBranchId={branch || undefined}
          onClose={() => setLoading(false)}
          onDone={(amount, branchName) => {
            setLoading(false)
            push('success', t('tb.loaded', { amount: currency(amount), branch: branchName }))
            reload()
          }}
        />
      ) : null}

      {recording ? (
        <RecordTelebirrDialog
          balance={Number(data?.balance ?? 0)}
          balances={data?.balances ?? []}
          onClose={() => setRecording(false)}
          onDone={(message) => {
            setRecording(false)
            push('success', message)
            reload()
          }}
        />
      ) : null}

      {editingEntry ? (
        <RecordTelebirrDialog
          balance={Number(data?.balance ?? 0)}
          balances={data?.balances ?? []}
          editing={editingEntry}
          onClose={() => setEditingEntry(null)}
          onDone={(message) => {
            setEditingEntry(null)
            push('success', message)
            reload()
          }}
        />
      ) : null}

      {editingLoad ? (
        <EditLoadDialog
          path="/api/telebirr/loads"
          load={editingLoad}
          onClose={() => setEditingLoad(null)}
          onDone={(amount) => {
            setEditingLoad(null)
            push('success', t('load.saved', { amount: currency(amount) }))
            reload()
          }}
        />
      ) : null}

      <Toasts toasts={toasts} onDismiss={dismiss} />
    </div>
  )
}

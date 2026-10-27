import { useEffect, useState } from 'react'
import rowStyles from '../components/RowMenu.module.css'
import { businessDay } from '../lib/tz'
import { useSavedState } from '../lib/savedState'

import { useAuth } from '../auth/context'
import { Card, Empty } from '../components/Card'
import { LoadIbidDialog, PrintIbidDialog } from '../components/ibid/IbidDialogs'
import { Toasts } from '../components/Toasts'
import { api } from '../lib/api'
import { useBranchList } from '../lib/branches'
import { count, currency, shortDate } from '../lib/format'
import { cartaText } from '../lib/ibid'
import { useT } from '../lib/i18n'
import { useToasts } from '../lib/toasts'
import { EditLoadDialog } from '../components/ibid/EditLoadDialog'
import type { IbidSummary } from '../lib/types'
import base from './Products.module.css'
import panel from '../components/inventory/Panel.module.css'
import styles from './Ibid.module.css'

function isoDay(date: Date) {
  return businessDay(date)
}

/**
 * Ibid: digital airtime bought as one birr balance.
 *
 * The Owner loads the balance; each branch supervisor records the Ibid they
 * print, and it comes off the balance. The report shows, for the chosen dates,
 * how much of each value every branch printed. Printing is not selling.
 */
export default function Ibid() {
  const { user } = useAuth()
  const t = useT()
  const { toasts, push, dismiss } = useToasts()
  const isOwner = user?.role === 'OWNER'
  const branchList = useBranchList()

  const now = new Date()
  const [from, setFrom] = useSavedState('ibid:from', isoDay(new Date(now.getFullYear(), now.getMonth(), 1)))
  const [to, setTo] = useSavedState('ibid:to', isoDay(now))
  const [branch, setBranch] = useState('')

  const [data, setData] = useState<IbidSummary | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [reloadKey, setReloadKey] = useState(0)
  const [loading, setLoading] = useState(false)
  const [printing, setPrinting] = useState(false)
  const [viewingLoads, setViewingLoads] = useState(false)

  useEffect(() => {
    const controller = new AbortController()
    const query = new URLSearchParams({ from, to })
    if (isOwner && branch) query.set('branchId', branch)

    api<IbidSummary>(`/api/ibid?${query}`, { signal: controller.signal })
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
  const [editingLoad, setEditingLoad] = useState<IbidSummary['entries'][number] | null>(null)
  const [editingPrint, setEditingPrint] = useState<IbidSummary['entries'][number] | null>(null)
  const reload = () => setReloadKey((n) => n + 1)
  const values = data?.values ?? [10, 15, 25, 50, 100]

  async function remove(entry: IbidSummary['entries'][number]) {
    if (!window.confirm(t('ibid.removeConfirm'))) return

    try {
      await api(`/api/ibid/${entry.kind === 'LOAD' ? 'loads' : 'prints'}/${entry.id}`, {
        method: 'DELETE',
      })
      push('success', t('ibid.removed'))
      reload()
    } catch (caught) {
      push('error', caught instanceof Error ? caught.message : 'Failed.')
    }
  }

  return (
    <div className={base.page}>
      <header className={base.head}>
        <div className={base.mobileHeading}>
          <h1 className={base.title}>{t('ibid.title')}</h1>
          <p className={base.subtitle}>{t('ibid.note')}</p>
        </div>

        {/* The Owner loads the balance and follows it; supervisors print. */}
        <div className={base.headActions}>
          {isOwner ? (
            <>
              <button type="button" className={base.primary} onClick={() => setLoading(true)}>
                + {t('ibid.load')}
              </button>
              <button type="button" className={base.secondary} onClick={() => setViewingLoads(true)}>
                {t('ibid.viewLoads')}
              </button>
            </>
          ) : (
            <>
              {/* What is left to print from; tapping it re-reads the figure. */}
              <button
                type="button"
                className={base.secondary}
                onClick={reload}
                title={t('ibid.balance')}
              >
                {t('ibid.balanceShort')}:{' '}
                <strong className="tabular">{data ? currency(Number(data.balance)) : '—'}</strong>
              </button>
              <button type="button" className={base.primary} onClick={() => setPrinting(true)}>
                + {t('ibid.print')}
              </button>
            </>
          )}
        </div>
      </header>

      <div className={styles.tiles}>
        <div className={styles.main}>
          <strong className="tabular">{data ? currency(Number(data.balance)) : '—'}</strong>
          <span>{t(isOwner && !branch ? 'ibid.balanceAll' : 'ibid.balance')}</span>
        </div>
        {isOwner ? (
          <button type="button" className={styles.tileButton} onClick={() => setViewingLoads(true)}>
            <strong className="tabular">{data ? currency(data.loadedInPeriod) : '—'}</strong>
            <span>{t('ibid.loadedPeriod')} · {t('ibid.view')}</span>
          </button>
        ) : null}
        <div>
          <strong className="tabular">{data ? currency(data.printedInPeriod) : '—'}</strong>
          <span>{t('ibid.printedPeriod')}</span>
        </div>
        <div>
          <strong className="tabular">{data ? currency(data.printedToday) : '—'}</strong>
          <span>{t('ibid.printedToday')}</span>
        </div>
      </div>

      {/* The Owner's view of every branch's own EVD balance. */}
      {isOwner && data ? (
        <Card>
          <h2 className={styles.sectionTitle}>{t('ibid.branchBalances')}</h2>
          <div className={base.scroll}>
            <table className={base.table}>
              <thead>
                <tr>
                  <th scope="col">{t('common.branch')}</th>
                  <th scope="col">{t('ibid.balance')}</th>
                </tr>
              </thead>
              <tbody>
                {data.balances.map((row) => (
                  <tr key={row.id}>
                    <td data-label={t('common.branch')} className={base.strong}>{row.name}</td>
                    <td data-label={t('ibid.balance')} className={`${base.strong} tabular`}>
                      {currency(row.balance)}
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
        </div>

        <h2 className={styles.sectionTitle}>{t('ibid.report')}</h2>

        {error ? <Empty>{error}</Empty> : null}

        {!data ? (
          <Empty>{t('common.loading')}</Empty>
        ) : data.byBranch.length === 0 ? (
          <Empty>{t('ibid.noPrints')}</Empty>
        ) : (
          <div className={base.scroll}>
            <table className={base.table}>
              <thead>
                <tr>
                  <th scope="col">{t('common.branch')}</th>
                  {values.map((value) => (
                    <th scope="col" key={value}>
                      EVD {value}
                    </th>
                  ))}
                  <th scope="col">{t('ibid.total')}</th>
                </tr>
              </thead>
              <tbody>
                {data.byBranch.map((row) => (
                  <tr key={row.branchId}>
                    <td data-label={t('common.branch')} className={base.strong}>
                      {row.name}
                    </td>
                    {values.map((value) => {
                      const cell = row.values[value]
                      return (
                        <td key={value} data-label={`EVD ${value}`} className="tabular">
                          {cell ? currency(cell.amount) : '—'}
                          {cell ? (
                            <em className={base.sub}>{cartaText(t, cell.cards)}</em>
                          ) : null}
                        </td>
                      )
                    })}
                    <td data-label={t('ibid.total')} className={`${base.strong} tabular`}>
                      {currency(row.total)}
                      <em className={base.sub}>{cartaText(t, row.cards)}</em>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card>
        <h2 className={styles.sectionTitle}>{t('ibid.history')}</h2>

        {!data ? null : data.entries.length === 0 ? (
          <Empty>{t('ibid.noEntries')}</Empty>
        ) : (
          <div className={base.scroll}>
            <table className={base.table}>
              <thead>
                <tr>
                  <th scope="col">{t('req.date')}</th>
                  <th scope="col">{t('ibid.entry')}</th>
                  <th scope="col">{t('common.branch')}</th>
                  <th scope="col">{t('ibid.value')}</th>
                  <th scope="col">{t('ibid.amountBirr')}</th>
                  <th scope="col">{t('ibid.cards')}</th>
                  <th scope="col">{t('ibid.by')}</th>
                  <th scope="col" />
                </tr>
              </thead>
              <tbody>
                {data.entries.map((entry) => (
                  <tr key={`${entry.kind}-${entry.id}`}>
                    <td data-label={t('req.date')}>{shortDate(entry.at)}</td>
                    <td data-label={t('ibid.entry')}>
                      <span className={styles.kind} data-kind={entry.kind}>
                        {t(entry.kind === 'LOAD' ? 'ibid.kindLoad' : 'ibid.kindPrint')}
                      </span>
                      {entry.note ? <em className={base.sub}>{entry.note}</em> : null}
                    </td>
                    <td data-label={t('common.branch')}>{entry.branch?.name ?? '—'}</td>
                    <td data-label={t('ibid.value')}>{entry.denomination ? `EVD ${entry.denomination}` : '—'}</td>
                    <td data-label={t('ibid.amountBirr')} className={`${base.strong} tabular`}>
                      {entry.kind === 'LOAD' ? '+' : '−'}
                      {currency(Number(entry.amount))}
                    </td>
                    <td data-label={t('ibid.cards')} className="tabular">
                      {entry.cards != null ? `${cartaText(t, entry.cards)} (${count(entry.cards)})` : '—'}
                    </td>
                    <td data-label={t('ibid.by')}>{entry.by.name}</td>
                    <td>
                      {/* A print can be corrected by whoever made it on the
                          day, and by the Owner any time. */}
                      {entry.kind === 'PRINT' &&
                      (isOwner ||
                        (entry.by.id === user?.id && new Date(entry.at).toDateString() === new Date().toDateString())) ? (
                        <button type="button" className={rowStyles.action} onClick={() => setEditingPrint(entry)}>
                          {t('load.edit')}
                        </button>
                      ) : null}
                      {isOwner && entry.kind === 'LOAD' ? (
                        <button type="button" className={rowStyles.action} onClick={() => setEditingLoad(entry)}>
                          {t('load.edit')}
                        </button>
                      ) : null}
                      {isOwner ? (
                        <button type="button" className={rowStyles.danger} onClick={() => void remove(entry)}>
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

      {viewingLoads && data ? (
        <div className={panel.scrim} onClick={() => setViewingLoads(false)}>
          <aside
            className={panel.panel}
            role="dialog"
            aria-modal="true"
            aria-label={t('ibid.loadsTitle')}
            onClick={(event) => event.stopPropagation()}
          >
            <header className={panel.head}>
              <div>
                <h2>{t('ibid.loadsTitle')}</h2>
                <p>
                  {shortDate(`${from}T12:00:00`)} – {shortDate(`${to}T12:00:00`)}
                </p>
              </div>
              <button type="button" onClick={() => setViewingLoads(false)} aria-label={t('common.close')}>
                ✕
              </button>
            </header>

            <div className={panel.body}>
              <dl className={panel.facts}>
                <div>
                  <dt>{t('ibid.loadedPeriod')}</dt>
                  <dd className="tabular">
                    <strong>{currency(data.loadedInPeriod)}</strong>
                  </dd>
                </div>
                <div>
                  <dt>{t('ibid.balance')}</dt>
                  <dd className="tabular">{currency(Number(data.balance))}</dd>
                </div>
              </dl>

              {data.entries.filter((entry) => entry.kind === 'LOAD').length === 0 ? (
                <p className={panel.none}>{t('ibid.noLoads')}</p>
              ) : (
                <ul className={panel.moves}>
                  {data.entries
                    .filter((entry) => entry.kind === 'LOAD')
                    .map((entry) => (
                      <li key={entry.id}>
                        <span className={panel.moveType} data-type="STOCK_IN">
                          +{currency(Number(entry.amount))}
                        </span>
                        <span className={panel.moveWhere}>
                          {entry.branch ? `${entry.branch.name} · ` : ''}
                          {entry.by.name}
                          {entry.note ? ` · ${entry.note}` : ''}
                        </span>
                        <span className={panel.moveWhen}>{shortDate(entry.at)}</span>
                        {entry.kind === 'LOAD' ? (
                          <button type="button" className={rowStyles.action} onClick={() => setEditingLoad(entry)}>
                            {t('load.edit')}
                          </button>
                        ) : null}
                        <button type="button" className={rowStyles.danger} onClick={() => void remove(entry)}>
                          {t('prod.delete')}
                        </button>
                      </li>
                    ))}
                </ul>
              )}
            </div>
          </aside>
        </div>
      ) : null}

      {loading ? (
        <LoadIbidDialog
          balances={data?.balances ?? []}
          initialBranchId={branch || undefined}
          onClose={() => setLoading(false)}
          onDone={(amount, branchName) => {
            setLoading(false)
            push('success', t('ibid.loaded', { amount: currency(amount), branch: branchName }))
            reload()
          }}
        />
      ) : null}

      {editingPrint ? (
        <PrintIbidDialog
          values={values}
          balance={Number(data?.balance ?? 0)}
          balances={data?.balances ?? []}
          editing={{
            id: editingPrint.id,
            denomination: editingPrint.denomination,
            cards: editingPrint.cards,
            amount: String(editingPrint.amount),
            note: editingPrint.note,
            branch: editingPrint.branch,
          }}
          onClose={() => setEditingPrint(null)}
          onDone={(message) => {
            setEditingPrint(null)
            push('success', message)
            reload()
          }}
        />
      ) : null}

      {printing ? (
        <PrintIbidDialog
          values={values}
          balance={Number(data?.balance ?? 0)}
          balances={data?.balances ?? []}
          onClose={() => setPrinting(false)}
          onDone={(message) => {
            setPrinting(false)
            push('success', message)
            reload()
          }}
        />
      ) : null}

      {editingLoad ? (
        <EditLoadDialog
          path="/api/ibid/loads"
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

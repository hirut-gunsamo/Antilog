import { useEffect, useState } from 'react'

import { useAuth } from '../auth/context'
import { Card, Empty } from '../components/Card'
import { LoadTelebirrDialog, RecordTelebirrDialog } from '../components/telebirr/TelebirrDialogs'
import { Toasts } from '../components/Toasts'
import { api } from '../lib/api'
import { useBranchList } from '../lib/branches'
import { count, currency, shortDate } from '../lib/format'
import { useT } from '../lib/i18n'
import { useToasts } from '../lib/toasts'
import type { TelebirrSummary } from '../lib/types'
import base from './Products.module.css'
import styles from './Ibid.module.css'

function isoDay(date: Date) {
  return `${date.getFullYear()}-${`${date.getMonth() + 1}`.padStart(2, '0')}-${`${date.getDate()}`.padStart(2, '0')}`
}

const KIND_KEY = { CASH_IN: 'tb.cashIn', AIRTIME: 'tb.airtime', LOAD: 'ibid.kindLoad' } as const

/**
 * Telebirr: the Owner loads money; sellers record cash-ins and airtime sold
 * from it, and both come off the balance. The report splits cash-in and
 * airtime by branch and by seller for the chosen dates.
 */
export default function Telebirr() {
  const { user } = useAuth()
  const t = useT()
  const { toasts, push, dismiss } = useToasts()
  const isOwner = user?.role === 'OWNER'
  const branchList = useBranchList()

  const now = new Date()
  const [from, setFrom] = useState(isoDay(new Date(now.getFullYear(), now.getMonth(), 1)))
  const [to, setTo] = useState(isoDay(now))
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

  const reload = () => setReloadKey((n) => n + 1)

  async function remove(entry: TelebirrSummary['entries'][number]) {
    if (!window.confirm(t('ibid.removeConfirm'))) return
    try {
      await api(`/api/telebirr/${entry.kind === 'LOAD' ? 'loads' : 'transactions'}/${entry.id}`, { method: 'DELETE' })
      push('success', t('ibid.removed'))
      reload()
    } catch (caught) {
      push('error', caught instanceof Error ? caught.message : 'Failed.')
    }
  }

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
          <button type="button" className={base.primary} onClick={() => setRecording(true)}>
            + {t('tb.record')}
          </button>
        </div>
      </header>

      <div className={styles.tiles}>
        <div className={styles.main}>
          <strong className="tabular">{data ? currency(Number(data.balance)) : '—'}</strong>
          <span>{t('tb.balance')}</span>
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
                  <th scope="col">{t('req.date')}</th>
                  <th scope="col">{t('ibid.entry')}</th>
                  <th scope="col">{t('ibid.amountBirr')}</th>
                  <th scope="col">{t('common.branch')}</th>
                  <th scope="col">{t('ibid.by')}</th>
                  <th scope="col">{t('tb.customerPhone')}</th>
                  {isOwner ? <th scope="col" /> : null}
                </tr>
              </thead>
              <tbody>
                {data.entries.map((entry) => (
                  <tr key={`${entry.kind}-${entry.id}`}>
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
                    {isOwner ? (
                      <td>
                        <button type="button" className={styles.remove} onClick={() => void remove(entry)}>
                          {t('prod.delete')}
                        </button>
                      </td>
                    ) : null}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {loading ? (
        <LoadTelebirrDialog
          onClose={() => setLoading(false)}
          onDone={(amount) => {
            setLoading(false)
            push('success', t('tb.loaded', { amount: currency(amount) }))
            reload()
          }}
        />
      ) : null}

      {recording ? (
        <RecordTelebirrDialog
          balance={Number(data?.balance ?? 0)}
          onClose={() => setRecording(false)}
          onDone={(message) => {
            setRecording(false)
            push('success', message)
            reload()
          }}
        />
      ) : null}

      <Toasts toasts={toasts} onDismiss={dismiss} />
    </div>
  )
}

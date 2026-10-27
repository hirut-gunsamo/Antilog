import { useEffect, useState } from 'react'
import rowStyles from '../components/RowMenu.module.css'
import { businessDay } from '../lib/tz'

import { useAuth } from '../auth/context'
import { Card, Empty } from '../components/Card'
import { DeductionDialog } from '../components/deductions/DeductionDialog'
import { Toasts } from '../components/Toasts'
import { api } from '../lib/api'
import { useBranchList } from '../lib/branches'
import { count, currency, shortDate } from '../lib/format'
import { useT } from '../lib/i18n'
import { useToasts } from '../lib/toasts'
import type { Deduction } from '../lib/types'
import base from './Products.module.css'
import styles from './Ibid.module.css'

function thisMonth() {
  return businessDay().slice(0, 7)
}

/**
 * Deductions: what is taken off someone's pay for goods short or lost on a
 * day. Supervisors and salespeople record and see their own; the Owner sees
 * everyone's by branch and may record for anyone. A month's total is what
 * Pay Salary deducts.
 */
export default function Deductions() {
  const { user } = useAuth()
  const t = useT()
  const { toasts, push, dismiss } = useToasts()
  const isOwner = user?.role === 'OWNER'
  const branchList = useBranchList()

  const [month, setMonth] = useState(thisMonth())
  const [branch, setBranch] = useState('')
  const [rows, setRows] = useState<Deduction[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [reloadKey, setReloadKey] = useState(0)
  const [adding, setAdding] = useState(false)

  useEffect(() => {
    const controller = new AbortController()
    const query = new URLSearchParams({ month })
    if (isOwner && branch) query.set('branchId', branch)

    api<{ deductions: Deduction[] }>(`/api/deductions?${query}`, { signal: controller.signal })
      .then((payload) => {
        setRows(payload.deductions ?? [])
        setError(null)
      })
      .catch((caught: unknown) => {
        if (controller.signal.aborted) return
        setError(caught instanceof Error ? caught.message : 'Could not load.')
      })

    return () => controller.abort()
  }, [month, branch, isOwner, reloadKey])

  const reload = () => setReloadKey((n) => n + 1)

  async function remove(row: Deduction) {
    if (!window.confirm(t('ded.deleteConfirm'))) return
    try {
      await api(`/api/deductions/${row.id}`, { method: 'DELETE', body: {} })
      push('success', t('ded.deleted'))
      reload()
    } catch (caught) {
      push('error', caught instanceof Error ? caught.message : 'Failed.')
    }
  }

  const total = (rows ?? []).reduce((sum, row) => sum + Number(row.total), 0)
  const items = (rows ?? []).reduce(
    (sum, row) => sum + row.lines.reduce((acc, line) => acc + (line.productId ? line.quantity : 0), 0),
    0,
  )

  return (
    <div className={base.page}>
      <header className={base.head}>
        <div className={base.mobileHeading}>
          <h1 className={base.title}>{t('ded.title')}</h1>
          <p className={base.subtitle}>{t(isOwner ? 'ded.noteOwner' : 'ded.note')}</p>
        </div>
        <div className={base.headActions}>
          <button type="button" className={base.primary} onClick={() => setAdding(true)}>
            + {t('ded.add')}
          </button>
        </div>
      </header>

      <div className={styles.tiles}>
        <div className={styles.main}>
          <strong className="tabular">{rows ? currency(total) : '—'}</strong>
          <span>{t('ded.monthTotal')}</span>
        </div>
        <div>
          <strong className="tabular">{rows ? count(rows.length) : '—'}</strong>
          <span>{t('ded.days')}</span>
        </div>
        <div>
          <strong className="tabular">{rows ? count(items) : '—'}</strong>
          <span>{t('ded.items')}</span>
        </div>
      </div>

      <Card>
        <div className={styles.filters} style={{ marginBottom: 0 }}>
          <label>
            {t('pay.month')}
            <input type="month" value={month} onChange={(event) => setMonth(event.target.value || thisMonth())} />
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
        {error ? <Empty>{error}</Empty> : null}
      </Card>

      <Card title={t('ded.entries')}>
        {rows === null ? (
          <Empty>{t('common.loading')}</Empty>
        ) : rows.length === 0 ? (
          <Empty>{t('ded.none')}</Empty>
        ) : (
          <div className={base.scroll}>
            <table className={base.table}>
              <thead>
                <tr>
                  <th scope="col">{t('req.date')}</th>
                  {isOwner ? <th scope="col">{t('pay.employee')}</th> : null}
                  {isOwner ? <th scope="col">{t('common.branch')}</th> : null}
                  <th scope="col">{t('ded.itemsCol')}</th>
                  <th scope="col">{t('ded.total')}</th>
                  <th scope="col" />
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id}>
                    <td data-label={t('req.date')}>{shortDate(row.day)}</td>
                    {isOwner ? (
                      <td data-label={t('pay.employee')} className={base.strong}>
                        {row.user.name}
                      </td>
                    ) : null}
                    {isOwner ? <td data-label={t('common.branch')}>{row.user.branch?.name ?? '—'}</td> : null}
                    <td data-label={t('ded.itemsCol')}>
                      {row.lines.map((line) => (
                        <span key={line.id} style={{ display: 'block' }}>
                          {line.productId ? (
                            <>
                              {line.label} × <span className="tabular">{count(line.quantity)}</span> ·{' '}
                            </>
                          ) : (
                            <>{t('ded.moneyLine')} · </>
                          )}
                          <span className="tabular">{currency(Number(line.amount))}</span>
                        </span>
                      ))}
                      {row.note ? <em className={base.sub}>{row.note}</em> : null}
                    </td>
                    <td data-label={t('ded.total')} className={`${base.strong} tabular`}>
                      {currency(Number(row.total))}
                    </td>
                    <td>
                      <button type="button" className={rowStyles.danger} onClick={() => void remove(row)}>
                        {t('prod.delete')}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {adding ? (
        <DeductionDialog
          onClose={() => setAdding(false)}
          onDone={(amount) => {
            setAdding(false)
            push('success', t('ded.saved', { amount: currency(amount) }))
            reload()
          }}
        />
      ) : null}

      <Toasts toasts={toasts} onDismiss={dismiss} />
    </div>
  )
}

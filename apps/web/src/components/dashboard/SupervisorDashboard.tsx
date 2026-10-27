import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'

import { api } from '../../lib/api'
import { CollectCashDialog } from '../cash/CollectCashDialog'
import { Toasts } from '../Toasts'
import { useToasts } from '../../lib/toasts'
import { count, currency, shortDate } from '../../lib/format'
import { useT, type TranslationKey } from '../../lib/i18n'
import { approvedUnitCount, requestRef, requestUnitCount } from '../../lib/requests'
import type {
  CurrentUser,
  Dashboard,
  Notifications,
  StockRequest,
  TeamCashRow,
} from '../../lib/types'
import { Card, Empty } from '../Card'
import { StatCard } from '../StatCard'
import styles from './SupervisorDashboard.module.css'

/**
 * The supervisor's dashboard: what is waiting on them, and who on the team is
 * holding cash.
 *
 * The API scopes every figure to the supervisor's own branch, so "today" and
 * the cash table are the branch's, never the organisation's.
 */
export function SupervisorDashboard({
  data,
  user,
}: {
  data: Dashboard
  user: CurrentUser
}) {
  const t = useT()

  const [pending, setPending] = useState<Notifications | null>(null)

  // Who is still holding cash, read fresh: the dashboard figures are a
  // snapshot from page load, and a collection has to work off the amount the
  // person is holding at this moment.
  const [liveCash, setLiveCash] = useState<TeamCashRow[] | null>(null)
  const [approvedToday, setApprovedToday] = useState<{ requests: StockRequest[]; handbacks: StockRequest[] } | null>(null)
  const [collecting, setCollecting] = useState<TeamCashRow | null>(null)
  const [reloadKey, setReloadKey] = useState(0)
  const { toasts, push, dismiss } = useToasts()

  useEffect(() => {
    const controller = new AbortController()

    // The same source as the bell, so the two can never disagree about what
    // is outstanding.
    api<Notifications>('/api/notifications', { signal: controller.signal })
      .then((payload) => setPending(payload))
      .catch(() => {
        if (controller.signal.aborted) return
        setPending({ notifications: [], actionCount: 0, total: 0 })
      })

    return () => controller.abort()
  }, [])

  useEffect(() => {
    const controller = new AbortController()

    api<{ team: TeamCashRow[] }>('/api/cash-collections/team', {
      signal: controller.signal,
    })
      .then((payload) => setLiveCash(payload.team ?? []))
      .catch(() => {
        if (controller.signal.aborted) return
        setLiveCash([])
      })

    return () => controller.abort()
  }, [reloadKey])

  useEffect(() => {
    const controller = new AbortController()
    const isToday = (value: string) => {
      const when = new Date(value)
      const now = new Date()
      return (
        when.getFullYear() === now.getFullYear() &&
        when.getMonth() === now.getMonth() &&
        when.getDate() === now.getDate()
      )
    }

    Promise.all([
      api<{ requests: StockRequest[] }>('/api/requests?kind=ISSUE&status=APPROVED', { signal: controller.signal }),
      api<{ requests: StockRequest[] }>('/api/requests?kind=RETURN&status=APPROVED', { signal: controller.signal }),
    ])
      .then(([issues, returns]) => {
        const onlyToday = (list: StockRequest[]) =>
          list
            .filter(
              (row) =>
                row.requestedBy.role === 'SALES' &&
                row.approvedBy?.id === user.id &&
                row.reviewedAt != null &&
                isToday(row.reviewedAt),
            )
            .sort((a, b) => (b.reviewedAt ?? '').localeCompare(a.reviewedAt ?? ''))

        setApprovedToday({
          requests: onlyToday(issues.requests ?? []),
          handbacks: onlyToday(returns.requests ?? []),
        })
      })
      .catch(() => {
        if (controller.signal.aborted) return
        setApprovedToday({ requests: [], handbacks: [] })
      })

    return () => controller.abort()
  }, [reloadKey, user.id])

  const decisions = (pending?.notifications ?? []).filter(
    (item) => item.tone === 'action',
  )

  // Largest unbanked amount first: that is who to talk to before closing.
  const team = [...data.cashPosition.salespeople].sort(
    (a, b) => b.inHand - a.inHand,
  )

  const lowStock = data.lowStock.slice(0, 6)

  // Only offer to collect from someone who is actually holding something, and
  // collect against the live figure rather than the page-load snapshot.
  const holdingNow = (id: string) =>
    (liveCash ?? []).find((row) => row.id === id && row.inHand > 0)
  const liveInHand = (id: string) =>
    (liveCash ?? []).find((row) => row.id === id)?.inHand
  const teamYadere = liveCash
    ? liveCash.reduce((sum, row) => sum + row.inHand, 0)
    : data.cashPosition.totals.inHand

  return (
    <>
      <div className={styles.tiles}>
        <StatCard
          label={t('dash.branchSalesToday')}
          value={currency(data.today.revenue)}
          icon="cart"
          tone="green"
          to="/sales"
        />
        <StatCard
          label={t('dash.teamCashInHand')}
          value={currency(teamYadere)}
          icon="cash"
          tone="emerald"
          to="/receipts"
        />
        <StatCard
          label={t('dash.toApprove')}
          value={pending ? count(pending.actionCount) : '—'}
          icon="clipboard"
          tone="red"
          to="/approvals"
        />
        <StatCard
          label={t('dash.lowStockCount')}
          value={count(data.lowStock.length)}
          icon="box"
          tone="blue"
          to="/inventory"
        />
      </div>

      <Card title={t('dash.needsDecision')} subtitle={t('dash.needsDecisionNote')}>
        {!pending ? (
          <Empty>{t('common.loading')}</Empty>
        ) : decisions.length === 0 ? (
          <Empty>{t('dash.nothingWaiting')}</Empty>
        ) : (
          <div className={styles.todo}>
            {decisions.map((item) => (
              <Link key={item.kind} className={styles.todoItem} to={item.href}>
                <strong>
                  {t(`notif.${item.kind}` as TranslationKey, {
                    n: count(item.count),
                  })}
                </strong>
                {item.sample.length > 0 ? (
                  <em>{item.sample.join(', ')}</em>
                ) : null}
              </Link>
            ))}
          </div>
        )}
      </Card>

      <Card
        title={`${t('dash.today')} · ${t('req.statusApproved')}`}
        subtitle={t('dash.todayNote')}
        action={
          <Link className={styles.viewAll} to="/requests">
            {t('common.viewAll')}
          </Link>
        }
      >
        {!approvedToday ? (
          <Empty>{t('common.loading')}</Empty>
        ) : approvedToday.requests.length === 0 && approvedToday.handbacks.length === 0 ? (
          <Empty>{t('dash.nothingWaiting')}</Empty>
        ) : (
          <div className={styles.subItems}>
            <Link className={styles.subItem} to="/requests/sales">
              {t('hold.takeItems')}
            </Link>
            <Link className={styles.subItem} to="/requests/sales?tab=HANDBACK">
              {t('hold.handBack')}
            </Link>
          </div>
        )}

        {approvedToday && (approvedToday.requests.length > 0 || approvedToday.handbacks.length > 0) ? (
          <div className={styles.dailyApprovals}>
            <section className={styles.dailyBox}>
              <h3>{t('hold.takeItems')}</h3>
              {approvedToday.requests.length === 0 ? (
                <p className={styles.none}>—</p>
              ) : (
                <ul>
                  {approvedToday.requests.map((row) => (
                    <li key={row.id}>
                      <strong>{requestRef(row)} · {row.requestedBy.name}</strong>
                      <span>{t('dlg.units', { n: count(approvedUnitCount(row) ?? requestUnitCount(row)) })}</span>
                      <em>{shortDate(row.reviewedAt ?? row.createdAt)}</em>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section className={styles.dailyBox}>
              <h3>{t('hold.handBack')}</h3>
              {approvedToday.handbacks.length === 0 ? (
                <p className={styles.none}>—</p>
              ) : (
                <ul>
                  {approvedToday.handbacks.map((row) => (
                    <li key={row.id}>
                      <strong>{requestRef(row)} · {row.requestedBy.name}</strong>
                      <span>{t('dlg.units', { n: count(approvedUnitCount(row) ?? requestUnitCount(row)) })}</span>
                      <em>
                        {row.leftOnHand != null ? currency(Number(row.leftOnHand)) : '—'}
                      </em>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>
        ) : null}
      </Card>

      {/* Two columns that end level: the team table with low stock under it,
          beside the week's chart, which stretches to match. */}
      <div className={styles.split}>
        <div className={styles.side}>
          <Card
            title={t('dash.myTeam')}
            subtitle={t('dash.myTeamNote')}
            action={
              <Link className={styles.viewAll} to="/receipts">
                {t('common.viewAll')}
              </Link>
            }
          >
            {team.length === 0 ? (
              <Empty>{t('dash.noTeamActivity')}</Empty>
            ) : (
              <div className={styles.tableWrap}>
                <table className={styles.table}>
                  <thead>
                    <tr>
                      <th>{t('dash.name')}</th>
                      <th>{t('dash.collected')}</th>
                      <th>{t('cash.handedOver')}</th>
                      <th>{t('dash.cashInHand')}</th>
                      <th aria-label={t('cash.collect')} />
                    </tr>
                  </thead>
                  <tbody>
                    {team.map((person) => (
                      <tr key={person.id}>
                        <td>{person.name}</td>
                        <td className="tabular">{currency(person.sold)}</td>
                        <td className="tabular">
                          {currency(person.handedOver)}
                        </td>
                        <td
                          className="tabular"
                          data-owing={(liveInHand(person.id) ?? person.inHand) > 0}
                        >
                          {currency(liveInHand(person.id) ?? person.inHand)}
                        </td>
                        <td>
                          {holdingNow(person.id) ? (
                            <button
                              type="button"
                              className={styles.collect}
                              onClick={() => setCollecting(holdingNow(person.id)!)}
                            >
                              {t('cash.collect')}
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

          <Card
            fill
            className={styles.grow}
            title={t('dash.lowStock')}
            subtitle={user.branch ? user.branch.name : t('dash.yourBranch')}
            action={
              <Link className={styles.viewAll} to="/inventory">
                {t('common.viewAll')}
              </Link>
            }
          >
            {lowStock.length === 0 ? (
              <Empty>{t('dash.allAboveReorder')}</Empty>
            ) : (
              <ul className={styles.lowList}>
                {lowStock.map((row) => (
                  <li key={row.id}>
                    <span>{row.name}</span>
                    <strong className="tabular" data-out={row.quantity === 0}>
                      {count(row.quantity)}
                    </strong>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>

        <Card fill title={t('dash.last7Title')}>
          <div className={styles.chartFooter}>
            <div>
              <strong>{currency(data.last7Days.totalSales)}</strong>
              <span>{t('dash.totalSales')}</span>
            </div>
            <div>
              <strong className="tabular">
                {count(data.last7Days.transactions)}
              </strong>
              <span>{t('dash.transactions')}</span>
            </div>
          </div>
        </Card>
      </div>

      {collecting ? (
        <CollectCashDialog
          seller={collecting}
          onClose={() => setCollecting(null)}
          onDone={(message) => {
            setCollecting(null)
            push('success', message)
            setReloadKey((n) => n + 1)
          }}
        />
      ) : null}

      <Toasts toasts={toasts} onDismiss={dismiss} />
    </>
  )
}

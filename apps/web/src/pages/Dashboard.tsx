import { useEffect, useState } from 'react'
import { businessDay } from '../lib/tz'
import { Link } from 'react-router-dom'

import { useAuth } from '../auth/context'
import { Card, Empty } from '../components/Card'
import { DownloadButton } from '../components/DownloadButton'
import { Toasts } from '../components/Toasts'
import { StatCard } from '../components/StatCard'
import { SalesDashboard } from '../components/dashboard/SalesDashboard'
import { SupervisorDashboard } from '../components/dashboard/SupervisorDashboard'
import { BranchPerformance } from '../components/BranchPerformance'
import { SendToBranchDialog } from '../components/transfers/SendToBranchDialog'
import base from './Products.module.css'
import { icons } from '../components/icons'
import { api, downloadCsv, OfflineError } from '../lib/api'
import { useT, type TranslationKey } from '../lib/i18n'
import { useSync } from '../lib/sync'
import { useToasts } from '../lib/toasts'
import { count, currency } from '../lib/format'
import type { Dashboard as DashboardData } from '../lib/types'
import styles from './Dashboard.module.css'

const RANGES = [
  { value: 'today', labelKey: 'dash.rangeToday' },
  { value: 'last7', labelKey: 'dash.rangeLast7' },
  { value: 'month', labelKey: 'dash.rangeMonth' },
  { value: 'year', labelKey: 'dash.rangeYear' },
] as const

type RangeValue = (typeof RANGES)[number]['value']

// Reads as a tail on "Customers served, stock left and revenue …".
const BRANCH_RANGE_SUBTITLE: Record<RangeValue, TranslationKey> = {
  today: 'dash.todayShort',
  last7: 'dash.last7Short',
  month: 'dash.thisMonthShort',
  year: 'dash.thisYearShort',
}

function isoDate(date: Date) {
  return businessDay(date)
}

function ActivityIcon({ name }: { name: keyof typeof icons }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width="15"
      height="15"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {icons[name].map((d, index) => (
        <path key={index} d={d} />
      ))}
    </svg>
  )
}

const QUICK_ACTIONS = [
  { to: '/requests', label: 'Stock Request', icon: 'clipboard', tone: 'violet' },
  { to: '/inventory', label: 'View Stock', icon: 'box', tone: 'amber' },
  { to: '/reports', label: 'Reports', icon: 'chart', tone: 'blue' },
  { to: '/sync', label: 'Sync', icon: 'sync', tone: 'grey' },
] as const

export default function Dashboard() {
  const { user } = useAuth()

  const [data, setData] = useState<DashboardData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [branchRange, setBranchRange] = useState<RangeValue>('month')
  const [downloading, setDownloading] = useState<string | null>(null)

  const { toasts, push, dismiss } = useToasts()
  const [sending, setSending] = useState(false)
  const t = useT()
  // Refetch when the connection returns, so a dashboard opened offline fills
  // itself in instead of waiting for a manual reload.
  const { online } = useSync()

  // Downloads whatever the card is currently showing.
  async function download(path: string, filename: string, tag: string) {
    setDownloading(tag)

    try {
      await downloadCsv(path, filename)
      push('success', t('toast.savedToDownloads', { name: filename }))
    } catch {
      push('error', t('dash.downloadFailed'))
    } finally {
      setDownloading(null)
    }
  }

  useEffect(() => {
    const controller = new AbortController()

    api<{ dashboard: DashboardData }>('/api/reports/dashboard', {
      signal: controller.signal,
    })
      .then((payload) => {
        setData(payload.dashboard)
        setError(null)
      })
      .catch((caught: unknown) => {
        if (controller.signal.aborted) return
        setError(
          caught instanceof OfflineError
            ? t('pwa.dashOffline')
            : caught instanceof Error
              ? caught.message
              : t('dash.loadFailed'),
        )
      })

    return () => controller.abort()
  }, [t, online])

  if (!user) return null

  // Figures already on screen stay put if a later refresh fails (the offline
  // banner says why); the error only stands in when there is nothing to show.
  if (error && !data) {
    return (
      <Card title={t("dash.title")}>
        <Empty>{error}</Empty>
      </Card>
    )
  }

  if (!data) {
    return (
      <div className={styles.page}>
        <div className={styles.tiles}>
          {[0, 1, 2, 3].map((n) => (
            <div key={n} className={styles.skeletonTile} />
          ))}
        </div>
        <div className={styles.split}>
          <div className={styles.skeletonCard} />
          <div className={styles.skeletonCard} />
        </div>
      </div>
    )
  }

  const isOwner = user.role === 'OWNER'

  // One route, three views. A salesperson's day is about their own work and
  // what they still owe, which is a different shape from the branch-wide and
  // org-wide views rather than a smaller version of them.
  if (user.role === 'SALES') {
    return (
      <div className={styles.page}>
        <div className={styles.mobileGreeting}>
          <h2>
            {t('dash.welcome')}, {user.name.split(' ')[0]}!
          </h2>
          <p>{t('dash.todayNote')}</p>
        </div>

        <SalesDashboard data={data} />

        <Toasts toasts={toasts} onDismiss={dismiss} />
      </div>
    )
  }

  // A supervisor runs one branch: the decisions waiting on them and the
  // team's cash come first, not the org-wide comparison.
  if (user.role === 'SUPERVISOR') {
    return (
      <div className={styles.page}>
        <div className={styles.mobileGreeting}>
          <h2>
            {t('dash.welcome')}, {user.name.split(' ')[0]}!
          </h2>
          <p>{t('dash.todayNote')}</p>
        </div>

        <SupervisorDashboard data={data} user={user} />

        <Toasts toasts={toasts} onDismiss={dismiss} />
      </div>
    )
  }

  return (
    <div className={styles.page}>
      {/* Mobile-only greeting; on desktop the shell header carries it. */}
      <div className={styles.mobileGreeting}>
        <h2>{t('dash.welcome')}, {user.name.split(' ')[0]}!</h2>
        <p>{t('dash.todayNote')}</p>
      </div>

      {/* The Owner sends stock to a branch without waiting for a request;
          the branch's supervisor clicks Received when it arrives. */}
      <Card
        title={t('send.title')}
        subtitle={t('send.note')}
        action={
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <Link to="/send" className={base.secondary}>
              {t('send.seeSent')}
            </Link>
            <button type="button" className={base.primary} onClick={() => setSending(true)}>
              {t('send.button')}
            </button>
          </div>
        }
      >
        {null}
      </Card>
      {sending ? (
        <SendToBranchDialog
          onClose={() => setSending(false)}
          onDone={(message) => {
            setSending(false)
            push('success', message)
          }}
        />
      ) : null}

      <div className={styles.tiles}>
        <StatCard
          label={t("dash.simCards")}
          value={count(data.tiles.simCards.value)}
          changePct={data.tiles.simCards.changePct}
          icon="sim"
          tone="green"
          to="/inventory"
        />
        <StatCard
          label={t("dash.phones")}
          value={count(data.tiles.phones.value)}
          changePct={data.tiles.phones.changePct}
          icon="phone"
          tone="blue"
          to="/inventory"
        />
        <StatCard
          label={t("dash.airtimeVouchers")}
          value={count(data.tiles.vouchers.value)}
          changePct={data.tiles.vouchers.changePct}
          icon="ticket"
          tone="red"
          to="/inventory"
        />
        <StatCard
          label={t("dash.cashReceived")}
          value={currency(data.tiles.cashReceived.value)}
          changePct={data.tiles.cashReceived.changePct}
          icon="cash"
          tone="emerald"
          to="/reports"
        />
      </div>

      {/* ---------- Branch performance, full width ---------- */}
      <Card
        title={isOwner ? t('dash.branchPerformance') : t('dash.yourBranch')}
        subtitle={t('dash.branchNote', { when: t(BRANCH_RANGE_SUBTITLE[branchRange]) })}
        action={
          <div className={styles.cardActions}>
            <select
              className={styles.select}
              value={branchRange}
              onChange={(event) =>
                setBranchRange(event.target.value as RangeValue)
              }
              aria-label={t("dash.branchRange")}
            >
              {RANGES.map((option) => (
                <option key={option.value} value={option.value}>
                  {t(option.labelKey)}
                </option>
              ))}
            </select>

            <DownloadButton
              filename={`branches-${isoDate(new Date())}.csv`}
              note={t('dash.stockByBranch')}
              className={styles.iconButton}
              disabled={downloading === 'branches'}
              title={t("dash.downloadBranch")}
              onConfirm={() =>
                download(
                  '/api/reports/inventory?format=csv',
                  `branches-${isoDate(new Date())}.csv`,
                  'branches',
                )
              }
            >
              <ActivityIcon name="download" />
            </DownloadButton>
          </div>
        }
      >
        <BranchPerformance data={data} range={branchRange} />
      </Card>

      <Toasts toasts={toasts} onDismiss={dismiss} />

      {/* ---------- Quick actions (phones) ---------- */}
      <section className={styles.quick}>
        <h2 className={styles.quickTitle}>{t('dash.quickActions')}</h2>
        <div className={styles.quickGrid}>
          {QUICK_ACTIONS.map((action) => (
            <Link key={action.to} to={action.to} className={styles.quickItem}>
              <span
                className={`${styles.quickIcon} ${styles[action.tone]}`}
                aria-hidden="true"
              >
                <ActivityIcon name={action.icon} />
              </span>
              {action.label}
            </Link>
          ))}
        </div>
      </section>
    </div>
  )
}

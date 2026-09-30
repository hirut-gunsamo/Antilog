import { Empty } from './Card'
import { count, currency } from '../lib/format'
import { useT } from '../lib/i18n'
import type { BranchActivity, Dashboard } from '../lib/types'
import styles from './BranchPerformance.module.css'

export type BranchRange = 'today' | 'last7' | 'month' | 'year'

// Every branch in one row: who is selling, how many customers they served,
// what is left on the shelf, and what it earned.
//
// A "customer" is one completed purchase - the system stores no customer
// identities, so the same person buying twice counts twice.
export function BranchPerformance({
  data,
  range = 'month',
}: {
  data: Dashboard
  range?: BranchRange
}) {
  const t = useT()

  // Older payloads only carried the month window; fall back to it so the table
  // still renders if the range bundle is missing.
  const activity: BranchActivity[] =
    data.branchActivityByRange?.[range] ?? data.branchActivity

  // Merge trading with stock so a branch still appears on a month when it has
  // not sold anything.
  const merged = new Map<
    string,
    {
      id: string
      name: string
      customers: number
      units: number
      revenue: number
      staff: number
      stockUnits: number
      stockValue: number
    }
  >()

  for (const branch of data.stock.branches) {
    merged.set(branch.id, {
      id: branch.id,
      name: branch.name,
      customers: 0,
      units: 0,
      revenue: 0,
      staff: 0,
      stockUnits: branch.totalUnits,
      stockValue: branch.stockValue,
    })
  }

  for (const branch of activity) {
    const entry = merged.get(branch.id) ?? {
      id: branch.id,
      name: branch.name,
      customers: 0,
      units: 0,
      revenue: 0,
      staff: 0,
      stockUnits: 0,
      stockValue: 0,
    }

    entry.customers = branch.customers
    entry.units = branch.units
    entry.revenue = branch.revenue
    entry.staff = branch.staff

    merged.set(branch.id, entry)
  }

  const rows = [...merged.values()].sort((a, b) => b.revenue - a.revenue)

  if (rows.length === 0) {
    return <Empty>{t('dash.noBranchData')}</Empty>
  }

  const totals = rows.reduce(
    (sum, row) => ({
      customers: sum.customers + row.customers,
      units: sum.units + row.units,
      revenue: sum.revenue + row.revenue,
      stockUnits: sum.stockUnits + row.stockUnits,
      stockValue: sum.stockValue + row.stockValue,
      staff: sum.staff + row.staff,
    }),
    {
      customers: 0,
      units: 0,
      revenue: 0,
      stockUnits: 0,
      stockValue: 0,
      staff: 0,
    },
  )

  const busiest = rows.reduce(
    (best, row) => (row.customers > best.customers ? row : best),
    rows[0],
  )

  const maxRevenue = Math.max(...rows.map((row) => row.revenue), 1)

  return (
    <div className={styles.scroll}>
      <table className={styles.table}>
        <thead>
          <tr>
            <th className={styles.rankCol} scope="col">
              <span className={styles.srOnly}>{t('common.rank')}</span>
            </th>
            <th scope="col">{t('dash.branch')}</th>
            <th className={styles.num} scope="col">
              {t('dash.salesStaff')}
            </th>
            <th className={styles.num} scope="col">
              {t('dash.customers')}
            </th>
            <th className={styles.num} scope="col">
              {t('dash.itemsSold')}
            </th>
            <th className={styles.num} scope="col">
              {t('dash.stockLeft')}
            </th>
            <th className={styles.num} scope="col">
              {t('dash.stockValue')}
            </th>
            <th className={styles.num} scope="col">
              {t('dash.revenue')}
            </th>
            {/* Left over the bar, which starts at the column's left edge. */}
            <th className={styles.shareCol} scope="col">
              {t('dash.share')}
            </th>
          </tr>
        </thead>

        <tbody>
          {rows.map((row, index) => {
            const share =
              totals.revenue > 0 ? (row.revenue / totals.revenue) * 100 : 0

            return (
              <tr key={row.id}>
                <td className={styles.rankCol}>
                  <span className={styles.rank}>{index + 1}</span>
                </td>
                <td data-label={t('dash.branch')}>
                  <span className={styles.name}>
                    {row.name}
                    {row.customers > 0 && row.id === busiest.id ? (
                      <i className={styles.badge}>{t('dash.busiest')}</i>
                    ) : null}
                    {row.stockUnits === 0 ? (
                      <i className={styles.badgeWarn}>{t('dash.noStock')}</i>
                    ) : null}
                  </span>
                </td>
                <td
                  data-label={t('dash.salesStaff')}
                  className={`${styles.num} tabular ${styles.dim}`}
                >
                  {count(row.staff)}
                </td>
                <td
                  data-label={t('dash.customers')}
                  className={`${styles.num} tabular ${styles.strong}`}
                >
                  {count(row.customers)}
                </td>
                <td
                  data-label={t('dash.itemsSold')}
                  className={`${styles.num} tabular ${styles.dim}`}
                >
                  {count(row.units)}
                </td>
                <td
                  data-label={t('dash.stockLeft')}
                  className={`${styles.num} tabular ${styles.dim}`}
                >
                  {count(row.stockUnits)}
                </td>
                <td
                  data-label={t('dash.stockValue')}
                  className={`${styles.num} tabular ${styles.dim}`}
                >
                  {currency(row.stockValue)}
                </td>
                <td
                  data-label={t('dash.revenue')}
                  className={`${styles.num} tabular ${styles.strong}`}
                >
                  {currency(row.revenue)}
                </td>
                <td data-label={t('dash.share')} className={styles.shareCol}>
                  <span className={styles.shareWrap}>
                    <span className={styles.shareTrack}>
                      <span
                        className={styles.shareFill}
                        style={{
                          width: `${Math.max((row.revenue / maxRevenue) * 100, row.revenue > 0 ? 3 : 0)}%`,
                        }}
                      />
                    </span>
                    <span className={`${styles.sharePct} tabular`}>
                      {share.toFixed(0)}%
                    </span>
                  </span>
                </td>
              </tr>
            )
          })}
        </tbody>

        <tfoot>
          <tr>
            <td className={styles.rankCol} />
            <td data-label={t('dash.branch')}>{t('dash.allBranchesRow')}</td>
            <td data-label={t('dash.salesStaff')} className={`${styles.num} tabular`}>
              {count(totals.staff)}
            </td>
            <td data-label={t('dash.customers')} className={`${styles.num} tabular`}>
              {count(totals.customers)}
            </td>
            <td data-label={t('dash.itemsSold')} className={`${styles.num} tabular`}>
              {count(totals.units)}
            </td>
            <td data-label={t('dash.stockLeft')} className={`${styles.num} tabular`}>
              {count(totals.stockUnits)}
            </td>
            <td data-label={t('dash.stockValue')} className={`${styles.num} tabular`}>
              {currency(totals.stockValue)}
            </td>
            <td data-label={t('dash.revenue')} className={`${styles.num} tabular`}>
              {currency(totals.revenue)}
            </td>
            <td className={styles.shareCol} />
          </tr>
        </tfoot>
      </table>
    </div>
  )
}

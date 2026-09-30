import { Donut } from './charts/Donut'
import { count, currency } from '../lib/format'
import { useT } from '../lib/i18n'
import type { Dashboard } from '../lib/types'
import styles from './OverallInformation.module.css'

// One card carrying the whole picture: stock mix, the headline counts, and
// how each branch traded. Every figure is labelled, which is also the relief
// the brand palette needs on a white surface.
export function OverallInformation({ data }: { data: Dashboard }) {
  const t = useT()

  const slices = [
    {
      key: 'SIM_CARD',
      label: t('dash.simCards'),
      value: data.inventoryByCategory.SIM_CARD,
      color: 'var(--series-1)',
    },
    {
      key: 'AIRTIME_VOUCHER',
      label: t('dash.airtimeVouchers'),
      value: data.inventoryByCategory.AIRTIME_VOUCHER,
      color: 'var(--series-2)',
    },
    {
      key: 'PHONE',
      label: t('dash.phones'),
      value: data.inventoryByCategory.PHONE,
      color: 'var(--series-3)',
    },
  ]

  const customers = data.branchActivity.reduce(
    (sum, branch) => sum + branch.customers,
    0,
  )
  const unitsSold = data.branchActivity.reduce(
    (sum, branch) => sum + branch.units,
    0,
  )
  return (
    <div className={styles.wrap}>
      <Donut slices={slices} size={158} />

      <div className={styles.metrics}>
        <div>
          <span>{t('dash.customersServed')}</span>
          <strong className="tabular">{count(customers)}</strong>
          <em>{t('dash.thisMonthShort')}</em>
        </div>
        <div>
          <span>{t('dash.itemsSold')}</span>
          <strong className="tabular">{count(unitsSold)}</strong>
          <em>{t('dash.thisMonthShort')}</em>
        </div>
        <div>
          <span>{t('dash.branchesTrading')}</span>
          <strong className="tabular">
            {count(data.branchActivity.length)}
          </strong>
          <em>{t('dash.trading')}</em>
        </div>
        <div>
          <span>{t('dash.totalSales')}</span>
          <strong>{currency(data.thisMonth.revenue)}</strong>
          <em>{t('dash.thisMonthShort')}</em>
        </div>
        <div>
          <span>{t('dash.cashBanked')}</span>
          <strong>{currency(data.cashPosition.totals.banked)}</strong>
          <em>{t('dash.banked')}</em>
        </div>
        <div>
          <span>{t('dash.cashInHand')}</span>
          <strong>{currency(data.cashPosition.totals.inHand)}</strong>
          <em>{t('dash.notBanked')}</em>
        </div>
      </div>

    </div>
  )
}

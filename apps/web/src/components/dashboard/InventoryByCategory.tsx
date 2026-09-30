import { useT } from '../../lib/i18n'
import type { Dashboard } from '../../lib/types'
import { Donut } from '../charts/Donut'

/** Stock on hand split by category: the donut from the design. */
export function InventoryByCategory({ data }: { data: Dashboard }) {
  const t = useT()

  const slices = [
    {
      key: 'SIM_CARD',
      label: t('dash.simCards'),
      value: data.inventoryByCategory.SIM_CARD,
      color: 'var(--series-1)',
    },
    {
      key: 'PHONE',
      label: t('dash.phones'),
      value: data.inventoryByCategory.PHONE,
      color: 'var(--series-3)',
    },
    {
      key: 'AIRTIME_VOUCHER',
      label: t('dash.airtimeVouchers'),
      value: data.inventoryByCategory.AIRTIME_VOUCHER,
      color: 'var(--series-2)',
    },
  ]

  return <Donut slices={slices} size={150} />
}

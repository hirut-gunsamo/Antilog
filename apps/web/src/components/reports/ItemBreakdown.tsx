import { Card, Empty } from '../Card'
import { CATEGORY_KEY, count, currency } from '../../lib/format'
import { useT, type TranslationKey } from '../../lib/i18n'
import styles from '../../pages/Reports.module.css'

export type ItemRow = {
  key: string
  name: string
  sku: string
  category: string
  /** The Owner's category name; groups the tables when present. */
  categoryName?: string | null
  /** Per branch id: pieces, and birr where the report has money. */
  at: Record<string, { quantity: number; revenue?: number }>
}

// Airtime first: it is most of what a branch handles.
const ORDER = ['AIRTIME_VOUCHER', 'PHONE', 'SIM_CARD']

/**
 * A report's figures item by item instead of one number per category:
 * Airtime 100 shows as 40 Ibid 50 and 60 Voucher 15. One table per category,
 * one column per branch, a total column and a total row.
 */
export function ItemBreakdown({
  titleKey,
  rows,
  branches,
  money = false,
  alwaysShowPhones = false,
}: {
  titleKey: TranslationKey
  rows: ItemRow[]
  branches: { id: string; name: string }[]
  money?: boolean
  /** Show the phones table even when no phone is in the rows. */
  alwaysShowPhones?: boolean
}) {
  const t = useT()

  const cell = (value: { quantity: number; revenue?: number } | undefined) => (
    <>
      {count(value?.quantity ?? 0)}
      {money ? <em className={styles.sub}>{currency(value?.revenue ?? 0)}</em> : null}
    </>
  )

  const sum = (list: ItemRow[], branchId?: string) =>
    list.reduce(
      (acc, row) => {
        const values = branchId ? [row.at[branchId]] : Object.values(row.at)
        for (const value of values) {
          acc.quantity += value?.quantity ?? 0
          acc.revenue += value?.revenue ?? 0
        }
        return acc
      },
      { quantity: 0, revenue: 0 },
    )

  // One table per category: by the Owner's category name where known, else
  // by kind. Built-in kinds first, in the usual order, then the rest by name.
  const labelOf = (row: ItemRow) =>
    row.categoryName ?? (CATEGORY_KEY[row.category] ? t(CATEGORY_KEY[row.category]) : row.category)
  const groups = [
    ...rows
      .reduce((map, row) => {
        const label = labelOf(row)
        const entry = map.get(label) ?? { key: label, label, rank: ORDER.indexOf(row.category), list: [] as ItemRow[] }
        entry.list.push(row)
        map.set(label, entry)
        return map
      }, new Map<string, { key: string; label: string; rank: number; list: ItemRow[] }>())
      .values(),
  ]
    .map((group) => ({ ...group, list: group.list.sort((a, b) => a.name.localeCompare(b.name)) }))
    .sort((a, b) => (a.rank === -1 ? 99 : a.rank) - (b.rank === -1 ? 99 : b.rank) || a.label.localeCompare(b.label))

  return (
    <>
      {groups.map(({ key, label, list }) => {
        return (
          <Card key={key} title={t(titleKey, { category: label })}>
            <div className={styles.scroll}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th scope="col">{t('prod.name')}</th>
                    {branches.map((entry) => (
                      <th key={entry.id} scope="col">
                        {entry.name}
                      </th>
                    ))}
                    <th scope="col">{t('ibid.total')}</th>
                  </tr>
                </thead>
                <tbody>
                  {list.map((row) => (
                    <tr key={row.key}>
                      <td data-label={t('prod.name')} className={styles.strong}>
                        {row.name}
                        <em className={styles.sub}>{row.sku}</em>
                      </td>
                      {branches.map((entry) => (
                        <td key={entry.id} data-label={entry.name} className="tabular">
                          {cell(row.at[entry.id])}
                        </td>
                      ))}
                      <td data-label={t('ibid.total')} className={`${styles.strong} tabular`}>
                        {cell(sum([row]))}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <td data-label={t('prod.name')}>{t('rep.totalRow')}</td>
                    {branches.map((entry) => (
                      <td key={entry.id} data-label={entry.name} className="tabular">
                        {cell(sum(list, entry.id))}
                      </td>
                    ))}
                    <td data-label={t('ibid.total')} className="tabular">
                      {cell(sum(list))}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </Card>
        )
      })}

      {alwaysShowPhones && !rows.some((row) => row.category === 'PHONE') ? (
        <Card title={t(titleKey, { category: t(CATEGORY_KEY.PHONE) })}>
          <Empty>{t('rep.noPhonesSold')}</Empty>
        </Card>
      ) : null}
    </>
  )
}

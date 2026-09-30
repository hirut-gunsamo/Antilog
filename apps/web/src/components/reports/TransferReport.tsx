import { Card, Empty } from '../Card'
import { count, shortDate } from '../../lib/format'
import { useT } from '../../lib/i18n'
import type { TransferRow } from '../../lib/types'
import styles from '../../pages/Reports.module.css'

/**
 * Completed transfers: which branch sent what to which, and when it arrived.
 * A summary by route first, then every transfer.
 */
export function TransferReport({ rows }: { rows: TransferRow[] }) {
  const t = useT()

  const units = (row: TransferRow) => row.items.reduce((sum, item) => sum + item.quantity, 0)

  const routes = [
    ...rows
      .reduce((map, row) => {
        const key = `${row.fromLocation.id}>${row.toLocation.id}`
        const entry = map.get(key) ?? {
          key,
          from: row.fromLocation.name,
          to: row.toLocation.name,
          transfers: 0,
          units: 0,
        }
        entry.transfers += 1
        entry.units += units(row)
        map.set(key, entry)
        return map
      }, new Map<string, { key: string; from: string; to: string; transfers: number; units: number }>())
      .values(),
  ].sort((a, b) => b.units - a.units)

  return (
    <>
      <Card title={t('rep.transferRoutes')} subtitle={t('rep.transferNote')}>
        {routes.length === 0 ? (
          <Empty>{t('rep.noTransfers')}</Empty>
        ) : (
          <div className={styles.scroll}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th scope="col">{t('tr.from')}</th>
                  <th scope="col">{t('tr.to')}</th>
                  <th scope="col">{t('rep.transfersCount')}</th>
                  <th scope="col">{t('rep.unitsMoved')}</th>
                </tr>
              </thead>
              <tbody>
                {routes.map((route) => (
                  <tr key={route.key}>
                    <td data-label={t('tr.from')} className={styles.strong}>{route.from}</td>
                    <td data-label={t('tr.to')} className={styles.strong}>{route.to}</td>
                    <td data-label={t('rep.transfersCount')} className="tabular">{count(route.transfers)}</td>
                    <td data-label={t('rep.unitsMoved')} className="tabular">{count(route.units)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {rows.length > 0 ? (
        <Card title={t('rep.transfersDone')}>
          <div className={styles.scroll}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th scope="col">{t('tr.statusReceived')}</th>
                  <th scope="col">{t('tr.route')}</th>
                  <th scope="col">{t('tr.items')}</th>
                  <th scope="col">{t('det.driver')}</th>
                  <th scope="col">{t('rep.receivedBy')}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id}>
                    <td data-label={t('tr.statusReceived')}>
                      {row.receivedAt ? shortDate(row.receivedAt) : '—'}
                      <em className={styles.sub}>
                        {t(row.request ? 'tr.kindRestock' : 'tr.kindTransfer')}
                        {row.shippedAt ? ` · ${t('rep.sentOn', { date: shortDate(row.shippedAt) })}` : ''}
                      </em>
                    </td>
                    <td data-label={t('tr.route')} className={styles.strong}>
                      {row.fromLocation.name} → {row.toLocation.name}
                    </td>
                    <td data-label={t('tr.items')} style={{ whiteSpace: 'normal' }}>
                      {row.items.map((item) => (
                        <div key={item.id}>
                          {count(item.quantity)} × {item.product.name}
                        </div>
                      ))}
                    </td>
                    <td data-label={t('det.driver')}>
                      {row.driverName ?? '—'}
                      {row.vehiclePlate ? <em className={styles.sub}>{row.vehiclePlate}</em> : null}
                    </td>
                    <td data-label={t('rep.receivedBy')}>{row.receivedBy?.name ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      ) : null}
    </>
  )
}

import { Card, Empty } from '../Card'
import { CATEGORY_KEY, count, currency, shortDate } from '../../lib/format'
import { useT } from '../../lib/i18n'
import type { ProfitReport as Report } from '../../lib/types'
import styles from '../../pages/Reports.module.css'
import own from './ProfitReport.module.css'

/**
 * The Owner's profit and loss: income, what it cost, and what is left, as a
 * statement and then branch by branch. Items sold without a buying price are
 * called out, because their cost is missing from the figures.
 */
export function ProfitReport({ report }: { report: Report | null }) {
  const t = useT()

  if (!report) {
    return (
      <Card title={t('pl.title')}>
        <Empty>{t('common.loading')}</Empty>
      </Card>
    )
  }

  const { income, costs } = report
  const categoryName = (row: { kind: string; name: string | null }) =>
    row.name ?? (CATEGORY_KEY[row.kind] ? t(CATEGORY_KEY[row.kind]) : row.kind)
  const tone = (value: number) => (value < 0 ? 'loss' : 'profit')

  return (
    <>
      <div className={own.tiles}>
        <div className={own.tile}>
          <span>{t('pl.income')}</span>
          <strong className="tabular">{currency(income.total)}</strong>
        </div>
        <div className={own.tile}>
          <span>{t('pl.costs')}</span>
          <strong className="tabular">{currency(costs.total)}</strong>
        </div>
        <div className={own.tile} data-tone={tone(report.profit)}>
          <span>{t(report.profit < 0 ? 'pl.loss' : 'pl.profit')}</span>
          <strong className="tabular">{currency(Math.abs(report.profit))}</strong>
        </div>
      </div>

      {report.uncosted.quantity > 0 ? (
        <p className={own.warning}>
          {t('pl.uncosted', {
            n: count(report.uncosted.quantity),
            amount: currency(report.uncosted.revenue),
          })}
        </p>
      ) : null}

      <Card title={t('pl.title')} subtitle={t('pl.note')}>
        <table className={own.statement}>
          <tbody>
            <tr className={own.section}>
              <th colSpan={2}>{t('pl.income')}</th>
            </tr>
            {/* Every branch's item sales, with what they were made of. */}
            {income.salesByBranch.map((row) => (
              <tr key={row.id}>
                <td>
                  {t('pl.salesOf', { name: row.name || t('pl.office') })}
                  <span className={own.detail}>
                    {row.byCategory.length > 0
                      ? row.byCategory.map((cat) => `${categoryName(cat)} ${currency(cat.amount)}`).join(' · ')
                      : t('pl.noSalesHere')}
                  </span>
                </td>
                <td className="tabular">{currency(row.amount)}</td>
              </tr>
            ))}
            <tr className={own.subtotal}>
              <td>{t('pl.totalSales')}</td>
              <td className="tabular">{currency(income.sales)}</td>
            </tr>
            <tr>
              <td>{t('pl.nationalId')}</td>
              <td className="tabular">{currency(income.nationalId)}</td>
            </tr>
            <tr className={own.subtotal}>
              <td>{t('pl.totalIncome')}</td>
              <td className="tabular">{currency(income.total)}</td>
            </tr>

            <tr className={own.section}>
              <th colSpan={2}>{t('pl.costs')}</th>
            </tr>
            <tr>
              <td>{t('pl.goods')}</td>
              <td className="tabular">{currency(costs.goods)}</td>
            </tr>
            <tr>
              <td>{t('pl.expenses')}</td>
              <td className="tabular">{currency(costs.expenses)}</td>
            </tr>
            <tr>
              <td>
                {t('pl.payroll')}
                <span className={own.detail}>
                  {t('pl.payrollDetail', {
                    salary: currency(costs.payroll.salary),
                    commission: currency(costs.payroll.commission),
                    bonus: currency(costs.payroll.bonus),
                    deduction: currency(costs.payroll.deduction),
                  })}
                </span>
              </td>
              <td className="tabular">{currency(costs.payroll.net)}</td>
            </tr>
            <tr>
              <td>{t('pl.commission')}</td>
              <td className="tabular">{currency(costs.commission)}</td>
            </tr>
            <tr>
              <td>{t('pl.losses')}</td>
              <td className="tabular">{currency(costs.losses)}</td>
            </tr>
            <tr>
              <td>{t('pl.equipment')}</td>
              <td className="tabular">{currency(costs.equipment)}</td>
            </tr>
            <tr className={own.subtotal}>
              <td>{t('pl.totalCosts')}</td>
              <td className="tabular">{currency(costs.total)}</td>
            </tr>

            <tr className={own.result} data-tone={tone(report.profit)}>
              <td>{t(report.profit < 0 ? 'pl.netLoss' : 'pl.netProfit')}</td>
              <td className="tabular">{currency(report.profit)}</td>
            </tr>
          </tbody>
        </table>
      </Card>

      <Card title={t('pl.byBranch')}>
        {report.byBranch.length === 0 ? (
          <Empty>{t('pl.none')}</Empty>
        ) : (
          <div className={styles.scroll}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th scope="col">{t('common.branch')}</th>
                  <th scope="col">{t('pl.income')}</th>
                  <th scope="col">{t('pl.goodsShort')}</th>
                  <th scope="col">{t('pl.expensesShort')}</th>
                  <th scope="col">{t('pl.payrollShort')}</th>
                  <th scope="col">{t('pl.commissionShort')}</th>
                  <th scope="col">{t('pl.lossesShort')}</th>
                  <th scope="col">{t('pl.equipmentShort')}</th>
                  <th scope="col">{t('pl.profit')}</th>
                </tr>
              </thead>
              <tbody>
                {report.byBranch.map((row) => (
                  <tr key={row.id}>
                    <td data-label={t('common.branch')} className={styles.strong}>
                      {row.name || t('pl.office')}
                    </td>
                    <td data-label={t('pl.income')} className="tabular">{currency(row.income)}</td>
                    <td data-label={t('pl.goodsShort')} className="tabular">{currency(row.goods)}</td>
                    <td data-label={t('pl.expensesShort')} className="tabular">{currency(row.expenses)}</td>
                    <td data-label={t('pl.payrollShort')} className="tabular">{currency(row.payroll)}</td>
                    <td data-label={t('pl.commissionShort')} className="tabular">{currency(row.commission)}</td>
                    <td data-label={t('pl.lossesShort')} className="tabular">{currency(row.losses)}</td>
                    <td data-label={t('pl.equipmentShort')} className="tabular">{currency(row.equipment)}</td>
                    <td data-label={t('pl.profit')} className={`${own.amount} tabular`} data-tone={tone(row.profit)}>
                      {currency(row.profit)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* Each branch's sales, one day per row: what a manager asks first. */}
      <Card title={t('pl.dailySales')} subtitle={t('pl.dailySalesNote')}>
        {report.dailySales.days.length === 0 ? (
          <Empty>{t('pl.noSales')}</Empty>
        ) : (
          <div className={styles.scroll}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th scope="col">{t('req.date')}</th>
                  {report.dailySales.branches.map((entry) => (
                    <th key={entry.id} scope="col">
                      {entry.name || t('pl.office')}
                    </th>
                  ))}
                  <th scope="col">{t('pl.allBranches')}</th>
                </tr>
              </thead>
              <tbody>
                {report.dailySales.days.map((day) => (
                  <tr key={day.date}>
                    <td data-label={t('req.date')} className={styles.strong}>
                      {shortDate(`${day.date}T12:00:00`)}
                    </td>
                    {report.dailySales.branches.map((entry) => (
                      <td key={entry.id} data-label={entry.name || t('pl.office')} className="tabular">
                        {day.byBranch[entry.id] ? currency(day.byBranch[entry.id]) : '—'}
                      </td>
                    ))}
                    <td data-label={t('pl.allBranches')} className={`${styles.strong} tabular`}>
                      {currency(day.total)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* Profit day by day: the same statement, one day per row. */}
      <Card title={t('pl.byDay')} subtitle={t('pl.byDayNote')}>
        {report.byDay.length === 0 ? (
          <Empty>{t('pl.none')}</Empty>
        ) : (
          <div className={styles.scroll}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th scope="col">{t('req.date')}</th>
                  <th scope="col">{t('pl.income')}</th>
                  <th scope="col">{t('pl.goodsShort')}</th>
                  <th scope="col">{t('pl.expensesShort')}</th>
                  <th scope="col">{t('pl.payrollShort')}</th>
                  <th scope="col">{t('pl.commissionShort')}</th>
                  <th scope="col">{t('pl.lossesShort')}</th>
                  <th scope="col">{t('pl.equipmentShort')}</th>
                  <th scope="col">{t('pl.profit')}</th>
                </tr>
              </thead>
              <tbody>
                {report.byDay.map((row) => (
                  <tr key={row.date}>
                    <td data-label={t('req.date')} className={styles.strong}>
                      {shortDate(`${row.date}T12:00:00`)}
                    </td>
                    <td data-label={t('pl.income')} className="tabular">{currency(row.income)}</td>
                    <td data-label={t('pl.goodsShort')} className="tabular">{currency(row.goods)}</td>
                    <td data-label={t('pl.expensesShort')} className="tabular">{currency(row.expenses)}</td>
                    <td data-label={t('pl.payrollShort')} className="tabular">{currency(row.payroll)}</td>
                    <td data-label={t('pl.commissionShort')} className="tabular">{currency(row.commission)}</td>
                    <td data-label={t('pl.lossesShort')} className="tabular">{currency(row.losses)}</td>
                    <td data-label={t('pl.equipmentShort')} className="tabular">{currency(row.equipment)}</td>
                    <td data-label={t('pl.profit')} className={`${own.amount} tabular`} data-tone={tone(row.profit)}>
                      {currency(row.profit)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  )
}

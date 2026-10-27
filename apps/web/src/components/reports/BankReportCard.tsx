import { Fragment, useEffect, useState } from 'react'

import { Card, Empty } from '../Card'
import { api } from '../../lib/api'
import { currency } from '../../lib/format'
import { useT } from '../../lib/i18n'
import type { BankReport } from '../../lib/types'
import styles from '../../pages/Reports.module.css'
import own from './DailyMoneyReport.module.css'

/**
 * What each bank was credited, person by person: the cash each salesperson
 * deposited (verified slips only) and the transfers customers sent for their
 * sales, National ID and Telebirr, with each bank's total.
 */
export function BankReportCard({ from, to, branch, reload }: { from: string; to: string; branch: string; reload: number }) {
  const t = useT()
  const [report, setReport] = useState<BankReport | null>(null)

  useEffect(() => {
    const controller = new AbortController()
    const query = new URLSearchParams()
    if (from) query.set('from', from)
    if (to) query.set('to', to)
    if (branch !== 'ALL') query.set('branchId', branch)
    api<BankReport>(`/api/reports/banks?${query.toString()}`, { signal: controller.signal })
      .then(setReport)
      .catch(() => {
        if (!controller.signal.aborted) setReport({ banks: [], totals: { deposits: 0, transfers: 0, total: 0 } })
      })
    return () => controller.abort()
  }, [from, to, branch, reload])

  function download() {
    if (!report) return
    const lines = [
      ['Bank', 'Salesperson', 'Branch', 'Deposited', 'Transfers', 'Total'],
      ...report.banks.flatMap((bank) => [
        ...bank.people.map((row) => [bank.bank, row.name, row.branch ?? '', row.deposits, row.transfers, row.total]),
        [bank.bank, 'Bank total', '', bank.deposits, bank.transfers, bank.total],
      ]),
      ['All banks', '', '', report.totals.deposits, report.totals.transfers, report.totals.total],
    ]
    const csv = lines.map((line) => line.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(',')).join('\n')
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }))
    const link = document.createElement('a')
    link.href = url
    link.download = `banks-${from || 'all'}-to-${to || 'now'}.csv`
    link.click()
    URL.revokeObjectURL(url)
  }

  return (
    <Card
      title={t('bank.title')}
      subtitle={t('bank.note')}
      action={
        <button type="button" className={styles.quickButton} onClick={download} disabled={!report?.banks.length}>
          {t('rep.download')}
        </button>
      }
    >
      {report === null ? (
        <Empty>{t('common.loading')}</Empty>
      ) : report.banks.length === 0 ? (
        <Empty>{t('bank.none')}</Empty>
      ) : (
        <div className={styles.scroll}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th scope="col">{t('rep.bank')}</th>
                <th scope="col">{t('rep.salesperson')}</th>
                <th scope="col">{t('common.branch')}</th>
                <th scope="col">{t('bank.deposited')}</th>
                <th scope="col">{t('bank.transfers')}</th>
                <th scope="col">{t('bank.total')}</th>
              </tr>
            </thead>
            <tbody>
              {report.banks.map((bank) => (
                <Fragment key={bank.bank}>
                  {bank.people.map((row, index) => (
                    <tr key={row.id}>
                      <td data-label={t('rep.bank')} className={styles.strong}>
                        {index === 0 ? bank.bank : ''}
                      </td>
                      <td data-label={t('rep.salesperson')}>{row.name}</td>
                      <td data-label={t('common.branch')}>{row.branch ?? '—'}</td>
                      <td data-label={t('bank.deposited')} className="tabular">
                        {currency(row.deposits)}
                      </td>
                      <td data-label={t('bank.transfers')} className="tabular">
                        {currency(row.transfers)}
                      </td>
                      <td data-label={t('bank.total')} className="tabular">
                        {currency(row.total)}
                      </td>
                    </tr>
                  ))}
                  <tr className={own.dayTotal}>
                    <td data-label={t('rep.bank')} />
                    <td data-label={t('rep.salesperson')}>{t('bank.bankTotal', { bank: bank.bank })}</td>
                    <td data-label={t('common.branch')} />
                    <td data-label={t('bank.deposited')} className="tabular">
                      {currency(bank.deposits)}
                    </td>
                    <td data-label={t('bank.transfers')} className="tabular">
                      {currency(bank.transfers)}
                    </td>
                    <td data-label={t('bank.total')} className="tabular">
                      {currency(bank.total)}
                    </td>
                  </tr>
                </Fragment>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td data-label={t('rep.bank')}>{t('bank.allBanks')}</td>
                <td data-label={t('rep.salesperson')} />
                <td data-label={t('common.branch')} />
                <td data-label={t('bank.deposited')} className="tabular">
                  {currency(report.totals.deposits)}
                </td>
                <td data-label={t('bank.transfers')} className="tabular">
                  {currency(report.totals.transfers)}
                </td>
                <td data-label={t('bank.total')} className="tabular">
                  {currency(report.totals.total)}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </Card>
  )
}

import { api } from './api'
import { byBranch, groupByDay, type BranchDeposit, type OtherDay } from './salesDays'
import type { Sale } from './types'

/**
 * The sales report as a spreadsheet, laid out like the screen: branch by
 * branch, each salesperson's day on one line, and the branch's total for a
 * day under its salespeople.
 */
export async function downloadSalesDays(from: string, to: string, branch: string, filename: string) {
  const query = new URLSearchParams()
  if (from) query.set('from', from)
  if (to) query.set('to', to)
  if (branch !== 'ALL') query.set('branchId', branch)

  const [salesRes, otherRes] = await Promise.all([
    api<{ sales: Sale[] }>(`/api/sales?${query.toString()}`),
    api<{
      days: OtherDay[]
      opening?: Record<string, number>
      branchDeposits?: BranchDeposit[]
      branchOpening?: Record<string, number>
    }>(`/api/reports/other-daily?${query.toString()}`).catch(() => ({
      days: [] as OtherDay[],
      opening: {},
      branchDeposits: [] as BranchDeposit[],
      branchOpening: {},
    })),
  ])
  const days = groupByDay(
    (salesRes.sales ?? []).filter((sale) => sale.status === 'APPROVED'),
    otherRes.days ?? [],
    otherRes.opening ?? {},
  )

  const header = [
    'Branch', 'Date', 'Salesperson', 'SIM transfers', 'SIM transfer amount', 'Bills', 'Bills amount',
    'SIM cards', 'SIM amount', 'Airtime', 'Airtime amount', 'Phones', 'Phones amount', 'Other', 'Other amount',
    'National ID original', 'National ID copy', 'National ID amount', 'Telebirr', 'Telebirr amount',
    'Deductions', 'Expenses', 'Day total', 'After deductions and expenses',
    'Transfer', 'Cash', 'Sales deposit', 'Yadere deposit', 'Net balance', 'Branch yadere',
  ]
  const money = (value: number) => (Math.round(value * 100) / 100).toFixed(2)
  const lines: (string | number)[][] = [header]
  for (const group of byBranch(days, { deposits: otherRes.branchDeposits, opening: otherRes.branchOpening })) {
    for (const { day, isTotal } of group.rows) {
      lines.push([
        group.branch,
        day.date,
        isTotal ? 'Branch total' : day.salesperson.name,
        day.simTransfer.quantity, money(day.simTransfer.amount),
        day.bills.quantity, money(day.bills.amount),
        day.sims.quantity, money(day.sims.amount),
        day.airtime.quantity, money(day.airtime.amount),
        day.phones.quantity, money(day.phones.amount),
        day.other.quantity, money(day.other.amount),
        day.nidOriginal.count, day.nidCopy.count, money(day.nationalId.amount),
        day.telebirr.count, money(day.telebirr.amount),
        money(day.deductions.amount), money(day.expenses.amount),
        money(day.total), money(day.net),
        money(day.transfer), money(day.cash), money(day.deposits.amount),
        isTotal ? money(day.yadereDeposit) : '', money(day.net),
        isTotal ? money(day.yadere) : '',
      ])
    }
  }

  const escape = (value: string | number) => {
    const text = String(value)
    return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
  }
  const blob = new Blob([lines.map((line) => line.map(escape).join(',')).join('\n')], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  link.remove()
  URL.revokeObjectURL(url)
}

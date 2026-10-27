import type { Sale } from './types'
import { businessDay } from './tz'

export type Figure = { quantity: number; amount: number }

/** National ID or Telebirr money for one person on one day. */
export type OtherMoney = { count: number; amount: number; cash: number; transfer: number }

/** Money taken off a person on a day: products short, or other money. */
export type DayDeductions = {
  amount: number
  items: { label: string | null; quantity: number; amount: number; note: string | null }[]
}

/** Cash a person took to the bank on a day (rejected slips left out). */
export type DayDeposits = {
  amount: number
  items: { bankName: string | null; amount: number; status: string }[]
}

/** As /api/reports/other-daily sends it. */
export type OtherDay = {
  date: string
  person: { id: string; name: string }
  branch: string
  nationalId: OtherMoney
  nidOriginal: Figure2
  nidCopy: Figure2
  telebirr: OtherMoney
  deposits: DayDeposits
  transfers: { bankName: string | null; amount: number }[]
  expenses?: DayExpenses
  deductions: DayDeductions
}

/** Paid out of a person's cash on a day. */
export type DayExpenses = { amount: number; items: { reason: string; amount: number }[] }

/** How many and for how much. */
export type Figure2 = { count: number; amount: number }

export type SalesDay = {
  key: string
  date: string
  salesperson: { id: string; name: string }
  branch: string
  sales: Sale[]
  /** SIM transfers done (a service): how many and for how much. */
  simTransfer: Figure
  /** Bills paid (WiFi, electricity...): how many and for how much. */
  bills: Figure
  sims: Figure
  airtime: Figure
  phones: Figure
  other: Figure
  nationalId: OtherMoney
  nidOriginal: Figure2
  nidCopy: Figure2
  telebirr: OtherMoney
  deposits: DayDeposits
  /** Money customers sent, bank by bank: sales, National ID and Telebirr. */
  banks: { bankName: string; amount: number }[]
  deductions: DayDeductions
  expenses: DayExpenses
  total: number
  /** The day's total less its deductions and expenses. */
  net: number
  /** Cash kept: whatever of the total did not come by transfer. */
  cash: number
  transfer: number
  /** Cash already held when the day began: the branch's yadere (totals only). */
  broughtForward: number
  /** What the supervisor banked of the branch's yadere (totals only). */
  yadereDeposit: number
  /**
   * What the salesperson hands the supervisor at the end of the day: their
   * cash less deductions, expenses and what they banked. They keep nothing.
   */
  handedOver: number
  /** The branch's cash left overnight; only on a branch's total line. */
  yadere: number
  /** Banked beyond the cash on hand (earlier money or a transfer); totals only. */
  overDeposited?: number
}

const zero = (): Figure => ({ quantity: 0, amount: 0 })
const none = (): OtherMoney => ({ count: 0, amount: 0, cash: 0, transfer: 0 })

/**
 * One row per salesperson per day: a supervisor wants "50 SIM cards, 3,000
 * birr of airtime, 2 phones" for the day, not fifty customers one by one.
 */
export function groupByDay(
  sales: Sale[],
  others: OtherDay[] = [],
  /** Per person: cash held before the first day, if known. */
  opening: Record<string, number> = {},
): SalesDay[] {
  const days = new Map<string, SalesDay>()
  const blank = (key: string, date: string, salesperson: { id: string; name: string }, branch: string): SalesDay => ({
    key,
    date,
    salesperson: { id: salesperson.id, name: salesperson.name },
    branch,
    sales: [],
    simTransfer: zero(),
    bills: zero(),
    sims: zero(),
    airtime: zero(),
    phones: zero(),
    other: zero(),
    nationalId: none(),
    nidOriginal: { count: 0, amount: 0 },
    nidCopy: { count: 0, amount: 0 },
    telebirr: none(),
    deposits: { amount: 0, items: [] },
    banks: [],
    deductions: { amount: 0, items: [] },
    expenses: { amount: 0, items: [] },
    total: 0,
    net: 0,
    cash: 0,
    transfer: 0,
    broughtForward: 0,
    yadereDeposit: 0,
    handedOver: 0,
    yadere: 0,
  })
  const bankTotals = new Map<string, Map<string, number>>()
  const toBank = (key: string, bankName: string | null, amount: number) => {
    if (amount <= 0) return
    const banks = bankTotals.get(key) ?? new Map<string, number>()
    const name = bankName?.trim() || '—'
    banks.set(name, (banks.get(name) ?? 0) + amount)
    bankTotals.set(key, banks)
  }
  for (const sale of sales) {
    const when = new Date(sale.saleDate)
    const date = businessDay(when)
    const key = `${date}|${sale.salesperson.id}`
    const day = days.get(key) ?? blank(key, date, sale.salesperson, sale.location.name)
    day.sales.push(sale)
    // Whatever of the total did not come by transfer was paid in cash.
    const saleTotal = Number(sale.totalAmount)
    const transferred = Math.min(Number(sale.transferReceived), saleTotal)
    day.total += saleTotal
    day.transfer += transferred
    day.cash += saleTotal - transferred
    toBank(key, sale.bankName, transferred)
    for (const row of sale.simTransfers ?? []) {
      const done = row.quantity ?? 1
      day.simTransfer.quantity += done
      day.simTransfer.amount += Number(row.price) * done
    }
    for (const bill of sale.billPayments ?? []) {
      day.bills.quantity += 1
      day.bills.amount += Number(bill.amount)
    }
    for (const item of sale.items) {
      const figure =
        item.product.category === 'SIM_CARD'
          ? day.sims
          : item.product.category === 'AIRTIME_VOUCHER'
            ? day.airtime
            : item.product.category === 'PHONE'
              ? day.phones
              : day.other
      figure.quantity += item.quantity
      figure.amount += Number(item.lineTotal)
    }
    days.set(key, day)
  }
  // National ID and Telebirr are money taken that day too, so they add to
  // the day (and make a day of their own when nothing was sold).
  for (const other of others) {
    const key = `${other.date}|${other.person.id}`
    const day = days.get(key) ?? blank(key, other.date, other.person, other.branch)
    day.nationalId = other.nationalId
    day.nidOriginal = other.nidOriginal ?? { count: 0, amount: 0 }
    day.nidCopy = other.nidCopy ?? { count: 0, amount: 0 }
    day.telebirr = other.telebirr
    day.deposits = other.deposits ?? { amount: 0, items: [] }
    day.deductions = other.deductions ?? { amount: 0, items: [] }
    day.expenses = other.expenses ?? { amount: 0, items: [] }
    for (const transfer of other.transfers ?? []) toBank(key, transfer.bankName, transfer.amount)
    day.total += other.nationalId.amount + other.telebirr.amount
    day.cash += other.nationalId.cash + other.telebirr.cash
    day.transfer += other.nationalId.transfer + other.telebirr.transfer
    days.set(key, day)
  }

  // A salesperson keeps nothing overnight: what is left of their cash after
  // deductions, expenses and their own bank slips goes to the supervisor.
  void opening
  for (const day of days.values()) {
    day.handedOver = day.cash - day.deductions.amount - day.expenses.amount - day.deposits.amount
  }

  for (const day of days.values()) {
    // Net balance: the cash the salesperson still hands to the supervisor.
    // Day total less what came by transfer, their deductions, their
    // expenses and what they deposited themselves.
    day.net = day.total - day.transfer - day.deductions.amount - day.expenses.amount - day.deposits.amount
    day.banks = [...(bankTotals.get(day.key) ?? new Map<string, number>()).entries()]
      .map(([bankName, amount]) => ({ bankName, amount }))
      .sort((a, b) => b.amount - a.amount)
  }

  return [...days.values()].sort(
    (a, b) => b.date.localeCompare(a.date) || a.salesperson.name.localeCompare(b.salesperson.name),
  )
}

/** What a supervisor (or the Owner) banked for a branch on a day. */
export type BranchDeposit = {
  date: string
  branch: string
  amount: number
  items: { bankName: string | null; amount: number; status: string; by: string }[]
  /** The supervisor's expenses that day, paid from the branch's money. */
  expenseAmount?: number
  expenses?: { reason: string; amount: number; by: string }[]
}

/** Sum of salespeople's declared yadere for one branch on one day. */
export type BranchYadereDaily = {
  date: string
  branch: string
  amount: number
}

/** Several days added up into one, for a branch's total line. */
export function addUpDays(list: SalesDay[], key: string, label: string, date?: string, branch?: string): SalesDay {
  const sum = (pick: (day: SalesDay) => number) => list.reduce((total, day) => total + pick(day), 0)
  const fig = (pick: (day: SalesDay) => Figure) => ({
    quantity: sum((day) => pick(day).quantity),
    amount: sum((day) => pick(day).amount),
  })
  const money = (pick: (day: SalesDay) => OtherMoney) => ({
    count: sum((day) => pick(day).count),
    amount: sum((day) => pick(day).amount),
    cash: sum((day) => pick(day).cash),
    transfer: sum((day) => pick(day).transfer),
  })
  return {
    key,
    date: date ?? list[0]?.date ?? '',
    salesperson: { id: key, name: label },
    branch: branch ?? list[0]?.branch ?? '',
    sales: list.flatMap((day) => day.sales),
    simTransfer: fig((day) => day.simTransfer),
    bills: fig((day) => day.bills),
    sims: fig((day) => day.sims),
    airtime: fig((day) => day.airtime),
    phones: fig((day) => day.phones),
    other: fig((day) => day.other),
    nationalId: money((day) => day.nationalId),
    nidOriginal: { count: sum((day) => day.nidOriginal.count), amount: sum((day) => day.nidOriginal.amount) },
    nidCopy: { count: sum((day) => day.nidCopy.count), amount: sum((day) => day.nidCopy.amount) },
    telebirr: money((day) => day.telebirr),
    deposits: { amount: sum((day) => day.deposits.amount), items: list.flatMap((day) => day.deposits.items) },
    banks: [],
    deductions: { amount: sum((day) => day.deductions.amount), items: list.flatMap((day) => day.deductions.items) },
    expenses: { amount: sum((day) => day.expenses.amount), items: list.flatMap((day) => day.expenses.items) },
    total: sum((day) => day.total),
    net: sum((day) => day.net),
    cash: sum((day) => day.cash),
    transfer: sum((day) => day.transfer),
    broughtForward: 0,
    yadereDeposit: 0,
    handedOver: sum((day) => day.handedOver),
    yadere: 0,
  }
}

/**
 * The days laid out by branch: each branch's days, newest first, and under
 * each day the branch's total. Salespeople hand their cash to the supervisor
 * at the end of the day; the supervisor's bank slips come off the branch's
 * total, and what is left is the branch's yadere, carried to the next day.
 */
export function byBranch(
  days: SalesDay[],
  extra: { deposits?: BranchDeposit[]; opening?: Record<string, number>; yadere?: BranchYadereDaily[] } = {},
) {
  const deposits = extra.deposits ?? []
  const declared = extra.yadere ?? []
  const names = [...new Set([...days.map((day) => day.branch), ...deposits.map((row) => row.branch), ...declared.map((row) => row.branch)])].sort((a, b) =>
    a.localeCompare(b),
  )

  return names.map((branch) => {
    const mine = days.filter((day) => day.branch === branch)
    const banked = deposits.filter((row) => row.branch === branch)
    const declaredByDay = new Map(declared.filter((row) => row.branch === branch).map((row) => [row.date, row.amount]))
    const dates = [...new Set([...mine.map((day) => day.date), ...banked.map((row) => row.date), ...declaredByDay.keys()])].sort((a, b) =>
      b.localeCompare(a),
    )

    // The branch's yadere carries on day to day: what it held the evening
    // before, plus what the salespeople handed in, less what the supervisor
    // banked. Worked out oldest day first.
    const carried = new Map<string, { opening: number; closing: number; over: number }>()
    for (const date of [...dates].reverse()) {
      // Each day stands alone: yadere is not carried to the next day.
      let running = 0
      const handed = mine.filter((day) => day.date === date).reduce((total, day) => total + day.handedOver, 0)
      const slips = banked.filter((row) => row.date === date).reduce((total, row) => total + row.amount, 0)
      const spent = banked.filter((row) => row.date === date).reduce((total, row) => total + (row.expenseAmount ?? 0), 0)
      const opening = running
      // The supervisor's expenses and bank slips come out of the branch's
      // money too, declared yadere or not: what was banked is no longer held.
      const declared = declaredByDay.get(date)
      const declaredLeft = declared != null ? declared - spent - slips : undefined
      const declaredYadere = declaredLeft != null ? Math.max(0, declaredLeft) : undefined
      // Yadere is cash left after the bank closes, so it never goes below
      // nothing: a slip bigger than the cash (it carried earlier money or a
      // transfer) leaves none, and the excess is shown, not carried.
      const after = running + handed - slips - spent
      running = declaredYadere != null ? declaredYadere : Math.max(0, after)
      const short = declaredLeft != null ? declaredLeft : after
      carried.set(date, { opening, closing: running, over: short < 0 ? -short : 0 })
    }

    const rows: { day: SalesDay; isTotal: boolean; people?: SalesDay[]; slips?: BranchDeposit[] }[] = []
    for (const date of dates) {
      const people = mine
        .filter((day) => day.date === date)
        .sort((a, b) => a.salesperson.name.localeCompare(b.salesperson.name))
      for (const day of people) rows.push({ day, isTotal: false })

      const total = addUpDays(people, `total-${branch}-${date}`, branch, date, branch)
      const slips = banked.filter((row) => row.date === date)
      for (const slip of slips) {
        // The supervisor's slips are the yadere deposit, kept apart from what
        // the salespeople banked themselves (Sales deposit).
        total.yadereDeposit += slip.amount
        total.expenses.amount += slip.expenseAmount ?? 0
        total.expenses.items.push(...(slip.expenses ?? []).map((item) => ({ reason: item.reason, amount: item.amount })))
      }
      total.broughtForward = carried.get(date)?.opening ?? 0
      total.yadere = carried.get(date)?.closing ?? 0
      total.overDeposited = carried.get(date)?.over ?? 0
      // Net balance: yesterday's yadere + today's sales, less what came by
      // transfer, the deductions, the expenses and everything deposited.
      total.net =
        total.broughtForward +
        total.total -
        total.transfer -
        total.deductions.amount -
        total.expenses.amount -
        total.deposits.amount -
        total.yadereDeposit
      rows.push({ day: total, isTotal: true, people, slips })
    }
    return { branch, rows }
  })
}

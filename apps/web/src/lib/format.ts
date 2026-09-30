import type { TranslationKey } from './i18n'

// The currency code the whole app prints.
//
// It lives in a module variable rather than a constant because the Owner sets
// it in Settings: `currency()` is called from dozens of places, most of them
// deep in tables and charts, and threading a prop to all of them would be
// worse than a single value updated once when settings load.
//
// Display only — nothing converts between currencies anywhere.
export const DEFAULT_CURRENCY = 'ETB'

let active = DEFAULT_CURRENCY

export function setCurrency(code: string) {
  active = code || DEFAULT_CURRENCY
}

export function getCurrency() {
  return active
}

const money = new Intl.NumberFormat('en-US', {
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
})

const moneyPrecise = new Intl.NumberFormat('en-US', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})

const counts = new Intl.NumberFormat('en-US')

export function currency(value: number, precise = false) {
  const amount = precise ? moneyPrecise.format(value) : money.format(value)
  return `${active} ${amount}`
}

// Axis ticks and tight tiles: 12.4k rather than 12,400.
export function compact(value: number) {
  if (Math.abs(value) >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`
  if (Math.abs(value) >= 1_000) return `${(value / 1_000).toFixed(1)}k`
  return String(Math.round(value))
}

export function count(value: number) {
  return counts.format(value)
}

export function shortDate(value: string) {
  const date = new Date(value)

  if (Number.isNaN(date.getTime())) return value

  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

export const CATEGORY_KEY: Record<string, TranslationKey> = {
  SIM_CARD: 'inv.simCards',
  AIRTIME_VOUCHER: 'inv.vouchers',
  PHONE: 'inv.phones',
  // Goods in categories the Owner added, where only one label fits.
  OTHER: 'inv.otherItems',
}

// Fixed slot order - a category always keeps its colour, whatever the filter.
export const CATEGORY_ORDER = [
  'SIM_CARD',
  'AIRTIME_VOUCHER',
  'PHONE',
  'OTHER',
] as const

export const CATEGORY_COLORS: Record<string, string> = {
  SIM_CARD: 'var(--series-1)',
  AIRTIME_VOUCHER: 'var(--series-2)',
  PHONE: 'var(--series-3)',
  OTHER: 'var(--series-4, var(--series-1))',
}

type Translate = (
  key: TranslationKey,
  vars?: Record<string, string | number>,
) => string

/** "5 minutes ago", "2 hours ago", then a plain date after a week. */
export function timeAgo(value: string, t: Translate, now = Date.now()) {
  const then = new Date(value).getTime()

  if (Number.isNaN(then)) return value

  const minutes = Math.max(0, Math.round((now - then) / 60_000))

  if (minutes < 1) return t('time.justNow')
  if (minutes < 60) return t('time.minutesAgo', { n: minutes })

  const hours = Math.round(minutes / 60)
  if (hours < 24) return t('time.hoursAgo', { n: hours })

  const days = Math.round(hours / 24)
  if (days < 7) return t('time.daysAgo', { n: days })

  return shortDate(value)
}

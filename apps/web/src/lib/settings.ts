import { createContext, useContext } from 'react'
import { BUSINESS_TZ, businessDay } from './tz'

import type { AppSettings, DateFormat, TimeFormat } from './types'

// Organisation settings, read once at startup and shared. They are the Owner's
// to change and apply to everyone, unlike the per-browser prefs in prefs.ts.

export const DEFAULT_SETTINGS: AppSettings = {
  id: 'app',
  systemName: 'AntiLog',
  defaultLanguage: 'en',
  currency: 'ETB',
  dateFormat: 'medium',
  timeFormat: '24h',
  itemsPerPage: 10,
  lowHoldingSim: 5,
  lowHoldingPhone: 2,
  lowHoldingVoucher: 20,
  nationalIdOriginalRate: '5',
  nationalIdCopyRate: '5',
  simTransferPrice: '0',
  notifySales: true,
  notifyRequests: true,
  notifyApprovals: true,
  notifyLowStock: true,
  notifySystem: false,
  updatedAt: new Date(0).toISOString(),
  updatedById: null,
  updatedBy: null,
}

export const SettingsContext = createContext<{
  settings: AppSettings
  /** Replaces the cached settings after the Owner saves. */
  setSettings: (next: AppSettings) => void
  loading: boolean
}>({
  settings: DEFAULT_SETTINGS,
  setSettings: () => {},
  loading: true,
})

export function useSettings() {
  return useContext(SettingsContext)
}

export const DATE_FORMAT_LABEL: Record<DateFormat, string> = {
  medium: 'Sep 17, 2026',
  short: '17/09/2026',
  iso: '2026-09-17',
  long: '17 September 2026',
}

export const TIME_FORMAT_LABEL: Record<TimeFormat, string> = {
  '24h': '14:30',
  '12h': '2:30 PM',
}

export const CURRENCIES = ['ETB', 'USD', 'EUR', 'GBP', 'KES'] as const

/** Renders a date in the organisation's chosen format. */
export function formatDate(value: string, format: DateFormat) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value

  if (format === 'iso') {
    return businessDay(date)
  }

  if (format === 'short') {
    return date.toLocaleDateString('en-GB', { timeZone: BUSINESS_TZ })
  }

  if (format === 'long') {
    return date.toLocaleDateString('en-GB', {
      timeZone: BUSINESS_TZ,
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    })
  }

  return date.toLocaleDateString('en-US', {
    timeZone: BUSINESS_TZ,
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

export function formatTime(value: string, format: TimeFormat) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''

  return date.toLocaleTimeString(format === '12h' ? 'en-US' : 'en-GB', {
    timeZone: BUSINESS_TZ,
    hour: '2-digit',
    minute: '2-digit',
    hour12: format === '12h',
  })
}

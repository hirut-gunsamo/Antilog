/**
 * The business runs on Ethiopian time. Days are worked out in that time zone
 * whatever the device is set to, so a computer set to another region files a
 * sale, a receipt or a deposit on the same day a phone in Ethiopia does.
 */
export const BUSINESS_TZ = 'Africa/Addis_Ababa'

// en-CA writes dates as YYYY-MM-DD.
const dayFormat = new Intl.DateTimeFormat('en-CA', {
  timeZone: BUSINESS_TZ,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
})

/** The YYYY-MM-DD day a moment falls on in Ethiopia (today by default). */
export function businessDay(date: Date = new Date()) {
  return dayFormat.format(date)
}

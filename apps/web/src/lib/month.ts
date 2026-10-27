/** "2026-09" for the current month, as <input type="month"> uses. */
import { businessDay } from './tz'
export function thisMonth() {
  return businessDay().slice(0, 7)
}

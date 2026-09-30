/** "2026-09" for the current month, as <input type="month"> uses. */
export function thisMonth() {
  const now = new Date()
  return `${now.getFullYear()}-${`${now.getMonth() + 1}`.padStart(2, '0')}`
}

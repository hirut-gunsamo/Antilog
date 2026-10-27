/**
 * An airtime card's value, read from the product's name: "Voucher 10" is a
 * 10-birr card. The name is what the Owner types, so the value is not asked
 * for separately. Null when the name carries no number.
 */
export function valueFromName(name: string): number | null {
  const match = name.match(/\d+/)
  const value = match ? Number(match[0]) : NaN
  return Number.isInteger(value) && value > 0 ? value : null
}

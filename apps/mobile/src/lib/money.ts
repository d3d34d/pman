export function fmtMoney(cents: number): string {
  const sign = cents < 0 ? '-' : ''
  const abs = Math.abs(cents)
  const dollars = Math.floor(abs / 100)
  const rem = abs % 100
  const grouped = dollars.toLocaleString('en-US')
  return rem === 0 ? `${sign}$${grouped}` : `${sign}$${grouped}.${String(rem).padStart(2, '0')}`
}

/** Mirrors MAX_CENTS on the API ($1,000,000). Amounts above this overflow the
 *  32-bit money columns, so reject them here rather than sending them. */
export const MAX_CENTS = 100_000_000

/** "1,400.50" → 140050. Returns null when the text is not a valid amount. */
export function parseMoney(text: string): number | null {
  const cleaned = text.replace(/[$,\s]/g, '')
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) return null
  const [d, c = ''] = cleaned.split('.')
  const value = Number(d) * 100 + Number(c.padEnd(2, '0') || 0)
  if (!Number.isSafeInteger(value) || value > MAX_CENTS) return null
  return value
}

export function centsToInput(cents: number): string {
  return cents % 100 === 0 ? String(cents / 100) : (cents / 100).toFixed(2)
}

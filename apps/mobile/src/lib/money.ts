export function fmtMoney(cents: number): string {
  const sign = cents < 0 ? '-' : ''
  const abs = Math.abs(cents)
  const dollars = Math.floor(abs / 100)
  const rem = abs % 100
  const grouped = dollars.toLocaleString('en-US')
  return rem === 0 ? `${sign}$${grouped}` : `${sign}$${grouped}.${String(rem).padStart(2, '0')}`
}

/** "1,400.50" → 140050. Returns null when the text is not a valid amount. */
export function parseMoney(text: string): number | null {
  const cleaned = text.replace(/[$,\s]/g, '')
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) return null
  const [d, c = ''] = cleaned.split('.')
  return Number(d) * 100 + Number(c.padEnd(2, '0') || 0)
}

export function centsToInput(cents: number): string {
  return cents % 100 === 0 ? String(cents / 100) : (cents / 100).toFixed(2)
}

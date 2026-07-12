const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

export function fmtDate(iso: string | Date | null | undefined): string {
  if (!iso) return '—'
  const d = typeof iso === 'string' ? new Date(iso) : iso
  return `${MONTHS[d.getUTCMonth()].slice(0, 3)} ${d.getUTCDate()}, ${d.getUTCFullYear()}`
}

export function todayStr(): string {
  return new Date().toISOString().slice(0, 10)
}

export function currentPeriod(): string {
  return todayStr().slice(0, 7)
}

export function periodLabel(period: string): string {
  const [y, m] = period.split('-').map(Number)
  return `${MONTHS[m - 1]} ${y}`
}

export function addPeriods(period: string, n: number): string {
  const [y, m] = period.split('-').map(Number)
  const d = new Date(Date.UTC(y, m - 1 + n, 1))
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
}

export function firstOfNextMonth(): string {
  return `${addPeriods(currentPeriod(), 1)}-01`
}

/** Loose YYYY-MM-DD check used before submitting forms. */
export function isDateStr(text: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(text) && !Number.isNaN(new Date(text).getTime())
}

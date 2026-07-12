/** Card-entry helpers. Validation is authoritative on the server; these exist
 *  to make typing a card feel right and to catch typos before a round-trip. */

export function digitsOnly(s: string): string {
  return s.replace(/\D/g, '')
}

export function detectBrand(digits: string): string {
  if (/^4/.test(digits)) return 'VISA'
  if (/^(5[1-5]|2(2[2-9]|[3-6]\d|7[01]|720))/.test(digits)) return 'MASTERCARD'
  if (/^3[47]/.test(digits)) return 'AMEX'
  if (/^6(011|5|4[4-9])/.test(digits)) return 'DISCOVER'
  return 'CARD'
}

export function isAmex(digits: string): boolean {
  return detectBrand(digits) === 'AMEX'
}

export function maxCardDigits(digits: string): number {
  return isAmex(digits) ? 15 : 16
}

export function cvcLength(digits: string): number {
  return isAmex(digits) ? 4 : 3
}

/** Groups as 4-4-4-4, or 4-6-5 for Amex. */
export function formatCardNumber(raw: string): string {
  const d = digitsOnly(raw).slice(0, 16)
  if (isAmex(d)) {
    const a = d.slice(0, 4)
    const b = d.slice(4, 10)
    const c = d.slice(10, 15)
    return [a, b, c].filter(Boolean).join(' ')
  }
  return (d.match(/.{1,4}/g) ?? []).join(' ')
}

/** Renders as MM/YY while typing. */
export function formatExpiry(raw: string): string {
  const d = digitsOnly(raw).slice(0, 4)
  if (d.length <= 2) return d
  return `${d.slice(0, 2)}/${d.slice(2)}`
}

export type Expiry = { expMonth: number; expYear: number }

export function parseExpiry(raw: string): Expiry | null {
  const d = digitsOnly(raw)
  if (d.length !== 4) return null
  const expMonth = Number(d.slice(0, 2))
  if (expMonth < 1 || expMonth > 12) return null
  const expYear = 2000 + Number(d.slice(2))
  return { expMonth, expYear }
}

export function luhnValid(digits: string): boolean {
  if (!/^\d{12,19}$/.test(digits)) return false
  let sum = 0
  let double = false
  for (let i = digits.length - 1; i >= 0; i--) {
    let n = digits.charCodeAt(i) - 48
    if (double) {
      n *= 2
      if (n > 9) n -= 9
    }
    sum += n
    double = !double
  }
  return sum % 10 === 0
}

export function expiryInFuture(e: Expiry): boolean {
  return new Date(Date.UTC(e.expYear, e.expMonth, 1)) > new Date()
}

export function brandGlyph(brand: string): string {
  switch (brand.toUpperCase()) {
    case 'VISA':
      return '💳 Visa'
    case 'MASTERCARD':
      return '💳 Mastercard'
    case 'AMEX':
      return '💳 Amex'
    case 'DISCOVER':
      return '💳 Discover'
    default:
      return '💳 Card'
  }
}

/** Unique per submission; the server uses it to guarantee a single charge. */
export function newIdempotencyKey(): string {
  const rand = Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2)
  return `pay_${Date.now().toString(36)}_${rand.slice(0, 16)}`
}

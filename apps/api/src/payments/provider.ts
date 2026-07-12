// Payment provider seam. The rest of the app only ever talks to this
// interface, so swapping the mock gateway for Stripe (or anything else) is a
// configuration change rather than a rewrite.

export type CardInput = {
  number: string
  expMonth: number
  expYear: number
  cvc: string
}

export type TokenizedCard = {
  token: string
  brand: string
  last4: string
  expMonth: number
  expYear: number
}

export type ChargeInput = {
  token: string
  amountCents: number
  description: string
  idempotencyKey: string
}

export type ChargeResult =
  | { ok: true; providerRef: string }
  | { ok: false; code: string; message: string }

export interface PaymentProvider {
  readonly name: string
  /** Exchanges raw card details for an opaque token. Throws CardError when the card is malformed. */
  tokenizeCard(card: CardInput): Promise<TokenizedCard>
  /** Attempts a charge. A decline is a normal `{ ok: false }` result, not an exception. */
  charge(input: ChargeInput): Promise<ChargeResult>
}

/** Card could not be accepted at all (bad number/expiry/cvc) — a 400, not a decline. */
export class CardError extends Error {
  constructor(
    public code: string,
    message: string,
  ) {
    super(message)
  }
}

// --- shared card helpers ----------------------------------------------------

/** Luhn checksum — the standard card-number integrity check. */
export function luhnValid(digits: string): boolean {
  if (!/^\d{12,19}$/.test(digits)) return false
  let sum = 0
  let double = false
  for (let i = digits.length - 1; i >= 0; i--) {
    let d = digits.charCodeAt(i) - 48
    if (double) {
      d *= 2
      if (d > 9) d -= 9
    }
    sum += d
    double = !double
  }
  return sum % 10 === 0
}

export function detectBrand(digits: string): string {
  if (/^4/.test(digits)) return 'VISA'
  if (/^(5[1-5]|2(2[2-9]|[3-6]\d|7[01]|720))/.test(digits)) return 'MASTERCARD'
  if (/^3[47]/.test(digits)) return 'AMEX'
  if (/^6(011|5|4[4-9])/.test(digits)) return 'DISCOVER'
  return 'CARD'
}

export function normalizeCardNumber(raw: string): string {
  return raw.replace(/[\s-]/g, '')
}

/** Validates shape/expiry/cvc and returns the normalized digits. */
export function assertUsableCard(card: CardInput): string {
  const digits = normalizeCardNumber(card.number)
  if (!luhnValid(digits)) throw new CardError('invalid_number', 'That card number is not valid.')

  if (!Number.isInteger(card.expMonth) || card.expMonth < 1 || card.expMonth > 12) {
    throw new CardError('invalid_expiry_month', 'Expiry month must be between 1 and 12.')
  }
  const now = new Date()
  const endOfExpiryMonth = new Date(Date.UTC(card.expYear, card.expMonth, 1))
  if (endOfExpiryMonth <= now) throw new CardError('expired_card', 'That card has expired.')

  const cvcLen = detectBrand(digits) === 'AMEX' ? 4 : 3
  if (!new RegExp(`^\\d{${cvcLen}}$`).test(card.cvc)) {
    throw new CardError('invalid_cvc', `Security code must be ${cvcLen} digits.`)
  }
  return digits
}

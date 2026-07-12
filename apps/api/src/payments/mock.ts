import { randomBytes } from 'node:crypto'
import {
  assertUsableCard,
  detectBrand,
  type CardInput,
  type ChargeInput,
  type ChargeResult,
  type PaymentProvider,
  type TokenizedCard,
} from './provider.js'

// Test cards, mirroring Stripe's well-known numbers so the behavior a
// developer sees here is the behavior they get after switching providers.
const DECLINE_CARDS: Record<string, { code: string; message: string }> = {
  '4000000000000002': { code: 'card_declined', message: 'Your card was declined.' },
  '4000000000009995': { code: 'insufficient_funds', message: 'Your card has insufficient funds.' },
  '4000000000000127': { code: 'incorrect_cvc', message: 'Your card’s security code is incorrect.' },
  '4000000000000069': { code: 'expired_card', message: 'Your card has expired.' },
  '4000000000000119': { code: 'processing_error', message: 'An error occurred while processing your card.' },
}

const OUTCOMES: Record<string, { code: string; message: string }> = Object.fromEntries(
  Object.values(DECLINE_CARDS).map((d) => [d.code, d]),
)

const TOKEN_RE = /^pm_mock_([a-z_]+)_[0-9a-f]+$/

/**
 * In-process card gateway. It validates cards for real (Luhn, expiry, CVC
 * length) and declines the standard test numbers, so the whole pay-rent
 * journey — including failure paths — is exercised without any account.
 *
 * The card number is never stored anywhere. As with a real gateway, the token
 * is the only durable artifact: the outcome the card should produce is baked
 * into the token at tokenization time, so saved cards keep working across
 * restarts without us retaining the PAN.
 */
export class MockPaymentProvider implements PaymentProvider {
  readonly name = 'MOCK'

  async tokenizeCard(card: CardInput): Promise<TokenizedCard> {
    const digits = assertUsableCard(card)
    const outcome = DECLINE_CARDS[digits]?.code ?? 'ok'
    return {
      token: `pm_mock_${outcome}_${randomBytes(8).toString('hex')}`,
      brand: detectBrand(digits),
      last4: digits.slice(-4),
      expMonth: card.expMonth,
      expYear: card.expYear,
    }
  }

  async charge(input: ChargeInput): Promise<ChargeResult> {
    if (input.amountCents <= 0) {
      return { ok: false, code: 'invalid_amount', message: 'Amount must be greater than zero.' }
    }

    const outcome = TOKEN_RE.exec(input.token)?.[1]
    if (!outcome) {
      return { ok: false, code: 'unknown_payment_method', message: 'This saved card is no longer valid. Please re-add it.' }
    }
    if (outcome !== 'ok') {
      const decline = OUTCOMES[outcome]
      return decline
        ? { ok: false, ...decline }
        : { ok: false, code: 'card_declined', message: 'Your card was declined.' }
    }

    return { ok: true, providerRef: `ch_mock_${randomBytes(10).toString('hex')}` }
  }
}

/** Exposed so the seed and docs can advertise the same numbers. */
export const MOCK_TEST_CARDS = {
  success: '4242424242424242',
  declined: '4000000000000002',
  insufficientFunds: '4000000000009995',
}

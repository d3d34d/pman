import {
  assertUsableCard,
  CardError,
  type CardInput,
  type ChargeInput,
  type ChargeResult,
  type PaymentProvider,
  type TokenizedCard,
} from './provider.js'

const STRIPE_API = 'https://api.stripe.com/v1'

function form(params: Record<string, string | number>): string {
  return Object.entries(params)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
    .join('&')
}

/**
 * Stripe adapter, implemented against the REST API so it needs no extra
 * dependency. Enabled with PAYMENT_PROVIDER=stripe and STRIPE_SECRET_KEY.
 *
 * NOTE ON PCI SCOPE: creating a PaymentMethod from a raw card number
 * server-side is permitted with **test** keys, which is what this adapter does
 * so the existing card form keeps working end-to-end. In production the card
 * must be tokenized on the device (Stripe Elements on web, PaymentSheet on
 * native) and only the resulting `pm_...` id sent here — at which point
 * `tokenizeCard` should be replaced by a call that simply attaches the
 * client-created payment method. `charge()` needs no changes.
 */
export class StripePaymentProvider implements PaymentProvider {
  readonly name = 'STRIPE'

  constructor(private readonly secretKey: string) {}

  private async request(path: string, body: Record<string, string | number>, idempotencyKey?: string) {
    const res = await fetch(`${STRIPE_API}${path}`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${this.secretKey}`,
        'content-type': 'application/x-www-form-urlencoded',
        ...(idempotencyKey ? { 'idempotency-key': idempotencyKey } : {}),
      },
      body: form(body),
    })
    const json = (await res.json()) as {
      id?: string
      status?: string
      card?: { brand?: string; last4?: string; exp_month?: number; exp_year?: number }
      error?: { code?: string; message?: string; decline_code?: string }
    }
    return { ok: res.ok, json }
  }

  async tokenizeCard(card: CardInput): Promise<TokenizedCard> {
    assertUsableCard(card)
    const { ok, json } = await this.request('/payment_methods', {
      type: 'card',
      'card[number]': card.number.replace(/[\s-]/g, ''),
      'card[exp_month]': card.expMonth,
      'card[exp_year]': card.expYear,
      'card[cvc]': card.cvc,
    })
    if (!ok || !json.id) {
      throw new CardError(json.error?.code ?? 'card_error', json.error?.message ?? 'Could not save that card.')
    }
    return {
      token: json.id,
      brand: (json.card?.brand ?? 'card').toUpperCase(),
      last4: json.card?.last4 ?? card.number.slice(-4),
      expMonth: json.card?.exp_month ?? card.expMonth,
      expYear: json.card?.exp_year ?? card.expYear,
    }
  }

  async charge(input: ChargeInput): Promise<ChargeResult> {
    const { ok, json } = await this.request(
      '/payment_intents',
      {
        amount: input.amountCents,
        currency: 'usd',
        payment_method: input.token,
        description: input.description,
        confirm: 'true',
        'automatic_payment_methods[enabled]': 'true',
        'automatic_payment_methods[allow_redirects]': 'never',
      },
      input.idempotencyKey,
    )

    if (!ok || json.status !== 'succeeded') {
      return {
        ok: false,
        code: json.error?.decline_code ?? json.error?.code ?? 'payment_failed',
        message: json.error?.message ?? 'The payment could not be completed.',
      }
    }
    return { ok: true, providerRef: json.id! }
  }
}

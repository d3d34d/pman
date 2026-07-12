import { randomBytes } from 'node:crypto'
import { getLeaseFinance, periodOf } from '../billing.js'
import type { DB } from '../db.js'
import { MockPaymentProvider } from './mock.js'
import type { PaymentProvider } from './provider.js'
import { StripePaymentProvider } from './stripe.js'

export * from './provider.js'
export { MOCK_TEST_CARDS } from './mock.js'

export function createPaymentProvider(env: NodeJS.ProcessEnv = process.env): PaymentProvider {
  if (env.PAYMENT_PROVIDER?.toLowerCase() === 'stripe') {
    const key = env.STRIPE_SECRET_KEY
    if (!key) throw new Error('PAYMENT_PROVIDER=stripe requires STRIPE_SECRET_KEY')
    return new StripePaymentProvider(key)
  }
  return new MockPaymentProvider()
}

export function receiptNumber(now = new Date()): string {
  const stamp = `${now.getUTCFullYear()}${String(now.getUTCMonth() + 1).padStart(2, '0')}`
  return `RCPT-${stamp}-${randomBytes(5).toString('hex').toUpperCase()}`
}

export type PayResult =
  | { ok: true; paymentId: string; receiptNumber: string; amountCents: number; replayed: boolean }
  | { ok: false; code: string; message: string }

export type PaySource = 'PORTAL' | 'AUTOPAY'

// Guards against fat-finger / abusive amounts and integer overflow. $1,000,000.
export const MAX_PAYMENT_CENTS = 100_000_000

/**
 * The stored idempotency key is scoped to both the lease and the source, so:
 *  - a client key chosen by one tenant can't collide with another tenant's
 *    payment (lease prefix), and
 *  - a tenant can't forge the autopay slot for a period (source namespace) —
 *    a portal key always lands under `portal:`, never `autopay:`.
 */
function scopedKey(leaseId: string, source: PaySource, clientKey: string): string {
  const ns = source === 'AUTOPAY' ? 'autopay' : 'portal'
  return `${leaseId}::${ns}:${clientKey}`
}

/**
 * Charges a saved card and, only on success, writes a Payment into the ledger.
 *
 * Idempotent: the attempt's `idempotencyKey` is unique (and lease-scoped), so a
 * retried request (double-tap, flaky network, replayed autopay) returns the
 * original outcome instead of charging twice.
 */
export async function payRent(
  db: DB,
  provider: PaymentProvider,
  input: {
    leaseId: string
    paymentMethodId: string
    amountCents: number
    idempotencyKey: string
    source: PaySource
    receivedDate?: Date
  },
): Promise<PayResult> {
  if (!Number.isInteger(input.amountCents) || input.amountCents <= 0) {
    return { ok: false, code: 'invalid_amount', message: 'Amount must be greater than zero.' }
  }
  if (input.amountCents > MAX_PAYMENT_CENTS) {
    return { ok: false, code: 'amount_too_large', message: 'That amount is too large. Contact your manager for large payments.' }
  }

  const method = await db.paymentMethod.findUnique({ where: { id: input.paymentMethodId } })
  if (!method) return { ok: false, code: 'unknown_payment_method', message: 'That payment method no longer exists.' }
  // A payment method must belong to a tenant on this lease.
  const onLease = await db.leaseTenant.findFirst({ where: { leaseId: input.leaseId, tenantId: method.tenantId } })
  if (!onLease) return { ok: false, code: 'unknown_payment_method', message: 'That payment method cannot be used on this lease.' }

  const key = scopedKey(input.leaseId, input.source, input.idempotencyKey)

  // Claim the idempotency key BEFORE touching the gateway. The unique
  // constraint is what actually prevents a double charge: a concurrent or
  // retried request loses this insert and replays the original outcome
  // instead of charging again.
  let attemptId: string
  try {
    const claimed = await db.paymentAttempt.create({
      data: {
        leaseId: input.leaseId,
        paymentMethodId: method.id,
        amountCents: input.amountCents,
        status: 'PENDING',
        idempotencyKey: key,
      },
    })
    attemptId = claimed.id
  } catch (e) {
    if ((e as { code?: string }).code !== 'P2002') throw e
    return replayOf(db, key)
  }

  const result = await provider.charge({
    token: method.providerToken,
    amountCents: input.amountCents,
    description: `Rent payment (lease ${input.leaseId})`,
    idempotencyKey: input.idempotencyKey,
  })

  if (!result.ok) {
    await db.paymentAttempt.update({
      where: { id: attemptId },
      data: { status: 'FAILED', failureCode: result.code, failureMessage: result.message },
    })
    return { ok: false, code: result.code, message: result.message }
  }

  // The gateway has already taken the money, so a rare receipt-number clash must
  // not fail the payment — retry a few times with fresh numbers.
  let payment
  let receipt = ''
  for (let attempt = 0; ; attempt++) {
    receipt = receiptNumber()
    try {
      payment = await db.payment.create({
        data: {
          leaseId: input.leaseId,
          amountCents: input.amountCents,
          receivedDate: input.receivedDate ?? new Date(),
          method: 'CARD',
          source: input.source,
          receiptNumber: receipt,
          providerRef: result.providerRef,
          paymentMethodId: method.id,
          reference: `${method.brand} ····${method.last4}`,
        },
      })
      break
    } catch (e) {
      if ((e as { code?: string }).code === 'P2002' && attempt < 5) continue
      throw e
    }
  }
  await db.paymentAttempt.update({
    where: { id: attemptId },
    data: { status: 'SUCCEEDED', providerRef: result.providerRef, paymentId: payment.id },
  })

  return { ok: true, paymentId: payment.id, receiptNumber: receipt, amountCents: payment.amountCents, replayed: false }
}

/** Returns the outcome already recorded for an idempotency key. */
async function replayOf(db: DB, idempotencyKey: string): Promise<PayResult> {
  const existing = await db.paymentAttempt.findUnique({
    where: { idempotencyKey },
    include: { payment: true },
  })
  if (existing?.status === 'SUCCEEDED' && existing.payment) {
    return {
      ok: true,
      paymentId: existing.payment.id,
      receiptNumber: existing.payment.receiptNumber ?? '',
      amountCents: existing.payment.amountCents,
      replayed: true,
    }
  }
  if (existing?.status === 'PENDING') {
    return { ok: false, code: 'payment_in_progress', message: 'This payment is already being processed.' }
  }
  return {
    ok: false,
    code: existing?.failureCode ?? 'payment_failed',
    message: existing?.failureMessage ?? 'The payment could not be completed.',
  }
}

export type AutopayOutcome =
  | { status: 'charged'; amountCents: number; receiptNumber: string }
  | { status: 'skipped'; reason: string }
  | { status: 'failed'; code: string; message: string }

/**
 * Charges the amount currently due on a lease, at most once per billing period.
 *
 * Runs on demand (tenant opens the portal, or the manager triggers a sweep).
 * A real deployment would additionally call this from a scheduler. The
 * per-period idempotency key guarantees a period is never charged twice, even
 * if this is invoked repeatedly.
 */
export async function processAutopay(
  db: DB,
  provider: PaymentProvider,
  leaseId: string,
  asOf = new Date(),
): Promise<AutopayOutcome> {
  const autopay = await db.autopay.findUnique({ where: { leaseId }, include: { paymentMethod: true } })
  if (!autopay || !autopay.enabled) return { status: 'skipped', reason: 'autopay_disabled' }

  const period = periodOf(asOf)
  if (autopay.lastRunPeriod === period) return { status: 'skipped', reason: 'already_run_this_period' }

  const finance = await getLeaseFinance(db, leaseId, { asOf })
  if (finance.dueNowCents <= 0) return { status: 'skipped', reason: 'nothing_due' }

  const result = await payRent(db, provider, {
    leaseId,
    paymentMethodId: autopay.paymentMethodId,
    amountCents: finance.dueNowCents,
    // Scoped to autopay:<period> by payRent; the portal namespace can't reach it.
    idempotencyKey: period,
    source: 'AUTOPAY',
    receivedDate: asOf,
  })

  if (!result.ok) return { status: 'failed', code: result.code, message: result.message }

  await db.autopay.update({ where: { leaseId }, data: { lastRunPeriod: period } })
  return { status: 'charged', amountCents: result.amountCents, receiptNumber: result.receiptNumber }
}

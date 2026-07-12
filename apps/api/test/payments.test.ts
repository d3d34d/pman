import path from 'node:path'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { buildApp } from '../src/app.js'
import { createPrisma, type DB } from '../src/db.js'
import { ensureRentCharges, getLeaseFinance, periodOf } from '../src/billing.js'
import { MockPaymentProvider } from '../src/payments/mock.js'
import { payRent, processAutopay } from '../src/payments/index.js'
import { CardError, detectBrand, luhnValid } from '../src/payments/provider.js'
import {
  notifyManagerNewSubmission,
  notifyTenantSubmissionReviewed,
  type EmailMessage,
  type EmailProvider,
  type PushMessage,
  type PushProvider,
} from '../src/notify/index.js'

const dbUrl = `file:${path.resolve('prisma/test.db')}`
let db: DB
let app: FastifyInstance
let provider: MockPaymentProvider

const GOOD_CARD = '4242424242424242'
const DECLINE_CARD = '4000000000000002'
const NSF_CARD = '4000000000009995'

const futureYear = new Date().getUTCFullYear() + 3

beforeAll(async () => {
  db = createPrisma(dbUrl)
  provider = new MockPaymentProvider()
  app = await buildApp({ db, jwtSecret: 'test-secret', paymentProvider: provider, rateLimit: false })
})

afterAll(async () => {
  await app.close()
  await db.$disconnect()
})

beforeEach(async () => {
  await db.$transaction([
    db.message.deleteMany(),
    db.note.deleteMany(),
    db.invite.deleteMany(),
    db.announcement.deleteMany(),
    db.document.deleteMany(),
    db.maintenanceRequest.deleteMany(),
    db.expense.deleteMany(),
    db.autopay.deleteMany(),
    db.paymentAttempt.deleteMany(),
    db.payment.deleteMany(),
    db.paymentMethod.deleteMany(),
    db.charge.deleteMany(),
    db.rentTerm.deleteMany(),
    db.leaseTenant.deleteMany(),
    db.lease.deleteMany(),
    db.tenantProfile.deleteMany(),
    db.unit.deleteMany(),
    db.property.deleteMany(),
    db.user.deleteMany(),
  ])
})

// ---------------------------------------------------------------------------
// Card validation primitives
// ---------------------------------------------------------------------------

describe('card validation', () => {
  it('accepts real card numbers and rejects mistyped ones', () => {
    expect(luhnValid(GOOD_CARD)).toBe(true)
    expect(luhnValid('4242424242424241')).toBe(false)
    expect(luhnValid('1234')).toBe(false)
  })

  it('detects brands', () => {
    expect(detectBrand(GOOD_CARD)).toBe('VISA')
    expect(detectBrand('5555555555554444')).toBe('MASTERCARD')
    expect(detectBrand('378282246310005')).toBe('AMEX')
  })

  it('rejects bad numbers, expiry and cvc at tokenization', async () => {
    await expect(provider.tokenizeCard({ number: '4242424242424241', expMonth: 1, expYear: futureYear, cvc: '123' })).rejects.toBeInstanceOf(CardError)
    await expect(provider.tokenizeCard({ number: GOOD_CARD, expMonth: 13, expYear: futureYear, cvc: '123' })).rejects.toBeInstanceOf(CardError)
    await expect(provider.tokenizeCard({ number: GOOD_CARD, expMonth: 1, expYear: 2020, cvc: '123' })).rejects.toBeInstanceOf(CardError)
    await expect(provider.tokenizeCard({ number: GOOD_CARD, expMonth: 1, expYear: futureYear, cvc: '12' })).rejects.toBeInstanceOf(CardError)
  })

  it('never exposes the card number in the token, only brand + last4', async () => {
    const t = await provider.tokenizeCard({ number: GOOD_CARD, expMonth: 1, expYear: futureYear, cvc: '123' })
    expect(t.token).not.toContain(GOOD_CARD)
    expect(t.last4).toBe('4242')
    expect(t.brand).toBe('VISA')
  })
})

describe('mock gateway declines', () => {
  it('declines the standard test cards with distinct codes', async () => {
    const declined = await provider.tokenizeCard({ number: DECLINE_CARD, expMonth: 1, expYear: futureYear, cvc: '123' })
    const nsf = await provider.tokenizeCard({ number: NSF_CARD, expMonth: 1, expYear: futureYear, cvc: '123' })

    const r1 = await provider.charge({ token: declined.token, amountCents: 100, description: 'x', idempotencyKey: 'k1' })
    const r2 = await provider.charge({ token: nsf.token, amountCents: 100, description: 'x', idempotencyKey: 'k2' })

    expect(r1).toMatchObject({ ok: false, code: 'card_declined' })
    expect(r2).toMatchObject({ ok: false, code: 'insufficient_funds' })
  })

  it('approves a good card', async () => {
    const ok = await provider.tokenizeCard({ number: GOOD_CARD, expMonth: 1, expYear: futureYear, cvc: '123' })
    const r = await provider.charge({ token: ok.token, amountCents: 100, description: 'x', idempotencyKey: 'k3' })
    expect(r.ok).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// payRent against the ledger
// ---------------------------------------------------------------------------

async function scenario(cardNumber = GOOD_CARD, rentCents = 100000) {
  const manager = await db.user.create({ data: { email: 'm@pay.dev', passwordHash: 'x', role: 'MANAGER', name: 'M' } })
  const property = await db.property.create({ data: { managerId: manager.id, name: 'P', address: '1 St' } })
  const unit = await db.unit.create({ data: { propertyId: property.id, label: 'A' } })
  const tenant = await db.tenantProfile.create({ data: { managerId: manager.id, fullName: 'T' } })
  const start = new Date('2026-01-01T00:00:00Z')
  const lease = await db.lease.create({
    data: {
      unitId: unit.id,
      startDate: start,
      dueDay: 1,
      graceDays: 5,
      lateFeeCents: 0,
      tenants: { create: [{ tenantId: tenant.id }] },
      rentTerms: { create: [{ amountCents: rentCents, effectiveFrom: start }] },
    },
  })
  const tok = await provider.tokenizeCard({ number: cardNumber, expMonth: 1, expYear: futureYear, cvc: '123' })
  const method = await db.paymentMethod.create({
    data: {
      tenantId: tenant.id,
      provider: 'MOCK',
      providerToken: tok.token,
      brand: tok.brand,
      last4: tok.last4,
      expMonth: tok.expMonth,
      expYear: tok.expYear,
      isDefault: true,
    },
  })
  return { manager, tenant, lease, method }
}

describe('payRent', () => {
  it('a successful payment lands in the ledger and clears the balance', async () => {
    const { lease, method } = await scenario()
    await ensureRentCharges(db, lease.id, '2026-01')

    const before = await getLeaseFinance(db, lease.id, { asOf: new Date('2026-01-10T00:00:00Z') })
    expect(before.dueNowCents).toBe(100000)

    const res = await payRent(db, provider, {
      leaseId: lease.id,
      paymentMethodId: method.id,
      amountCents: 100000,
      idempotencyKey: 'pay-1',
      source: 'PORTAL',
      receivedDate: new Date('2026-01-10T00:00:00Z'),
    })
    expect(res.ok).toBe(true)
    if (!res.ok) throw new Error('expected success')
    expect(res.receiptNumber).toMatch(/^RCPT-\d{6}-[0-9A-F]{10}$/)

    const after = await getLeaseFinance(db, lease.id, { asOf: new Date('2026-01-10T00:00:00Z') })
    expect(after.dueNowCents).toBe(0)

    const payment = await db.payment.findUnique({ where: { id: res.paymentId } })
    expect(payment).toMatchObject({ method: 'CARD', source: 'PORTAL', amountCents: 100000 })
    expect(payment?.reference).toBe('VISA ····4242')
  })

  it('a declined card creates NO payment — the ledger is untouched', async () => {
    const { lease, method } = await scenario(DECLINE_CARD)
    await ensureRentCharges(db, lease.id, '2026-01')

    const res = await payRent(db, provider, {
      leaseId: lease.id,
      paymentMethodId: method.id,
      amountCents: 100000,
      idempotencyKey: 'pay-decline',
      source: 'PORTAL',
    })
    expect(res).toMatchObject({ ok: false, code: 'card_declined' })

    expect(await db.payment.count({ where: { leaseId: lease.id } })).toBe(0)
    const finance = await getLeaseFinance(db, lease.id, { asOf: new Date('2026-01-10T00:00:00Z') })
    expect(finance.dueNowCents).toBe(100000)

    const attempt = await db.paymentAttempt.findFirst({ where: { leaseId: lease.id, status: 'FAILED' } })
    expect(attempt).toMatchObject({ status: 'FAILED', failureCode: 'card_declined' })
  })

  it('is idempotent: the same key never charges twice', async () => {
    const { lease, method } = await scenario()
    await ensureRentCharges(db, lease.id, '2026-01')
    const args = {
      leaseId: lease.id,
      paymentMethodId: method.id,
      amountCents: 50000,
      idempotencyKey: 'same-key',
      source: 'PORTAL' as const,
    }
    const first = await payRent(db, provider, args)
    const second = await payRent(db, provider, args)

    expect(first.ok).toBe(true)
    expect(second.ok).toBe(true)
    if (!first.ok || !second.ok) throw new Error('expected success')
    expect(second.replayed).toBe(true)
    expect(second.paymentId).toBe(first.paymentId)
    expect(await db.payment.count({ where: { leaseId: lease.id } })).toBe(1)
  })

  it('concurrent double-submit charges exactly once', async () => {
    const { lease, method } = await scenario()
    await ensureRentCharges(db, lease.id, '2026-01')
    const args = {
      leaseId: lease.id,
      paymentMethodId: method.id,
      amountCents: 50000,
      idempotencyKey: 'race-key',
      source: 'PORTAL' as const,
    }
    const results = await Promise.all([payRent(db, provider, args), payRent(db, provider, args)])
    const succeeded = results.filter((r) => r.ok)
    // Exactly one real charge; the loser either replays it or reports in-progress.
    expect(await db.payment.count({ where: { leaseId: lease.id } })).toBe(1)
    expect(succeeded.length).toBeGreaterThanOrEqual(1)
  })

  it('rejects non-positive amounts', async () => {
    const { lease, method } = await scenario()
    const res = await payRent(db, provider, {
      leaseId: lease.id,
      paymentMethodId: method.id,
      amountCents: 0,
      idempotencyKey: 'zero',
      source: 'PORTAL',
    })
    expect(res).toMatchObject({ ok: false, code: 'invalid_amount' })
  })

  it('a partial payment leaves the remainder owing', async () => {
    const { lease, method } = await scenario()
    await ensureRentCharges(db, lease.id, '2026-01')
    await payRent(db, provider, {
      leaseId: lease.id,
      paymentMethodId: method.id,
      amountCents: 40000,
      idempotencyKey: 'partial',
      source: 'PORTAL',
      receivedDate: new Date('2026-01-10T00:00:00Z'),
    })
    const finance = await getLeaseFinance(db, lease.id, { asOf: new Date('2026-01-10T00:00:00Z') })
    expect(finance.dueNowCents).toBe(60000)
  })
})

// ---------------------------------------------------------------------------
// Autopay
// ---------------------------------------------------------------------------

describe('autopay', () => {
  async function withAutopay(cardNumber = GOOD_CARD) {
    const s = await scenario(cardNumber)
    await db.autopay.create({
      data: { leaseId: s.lease.id, tenantId: s.tenant.id, paymentMethodId: s.method.id, enabled: true },
    })
    return s
  }

  it('charges what is due, once, and is a no-op on repeat runs', async () => {
    const { lease } = await withAutopay()
    const asOf = new Date('2026-01-10T00:00:00Z')

    const first = await processAutopay(db, provider, lease.id, asOf)
    expect(first.status).toBe('charged')
    if (first.status === 'charged') expect(first.amountCents).toBe(100000)

    const second = await processAutopay(db, provider, lease.id, asOf)
    expect(second).toMatchObject({ status: 'skipped', reason: 'already_run_this_period' })

    expect(await db.payment.count({ where: { leaseId: lease.id } })).toBe(1)
    const finance = await getLeaseFinance(db, lease.id, { asOf })
    expect(finance.dueNowCents).toBe(0)
  })

  it('skips when nothing is due yet', async () => {
    const { lease } = await withAutopay()
    // Before the Jan 1 due date there is nothing owed.
    const res = await processAutopay(db, provider, lease.id, new Date('2025-12-20T00:00:00Z'))
    expect(res).toMatchObject({ status: 'skipped' })
    expect(await db.payment.count({ where: { leaseId: lease.id } })).toBe(0)
  })

  it('skips when disabled', async () => {
    const { lease } = await withAutopay()
    await db.autopay.update({ where: { leaseId: lease.id }, data: { enabled: false } })
    const res = await processAutopay(db, provider, lease.id, new Date('2026-01-10T00:00:00Z'))
    expect(res).toMatchObject({ status: 'skipped', reason: 'autopay_disabled' })
  })

  it('reports a decline and does not mark the period as run', async () => {
    const { lease } = await withAutopay(DECLINE_CARD)
    const res = await processAutopay(db, provider, lease.id, new Date('2026-01-10T00:00:00Z'))
    expect(res).toMatchObject({ status: 'failed', code: 'card_declined' })

    const autopay = await db.autopay.findUnique({ where: { leaseId: lease.id } })
    expect(autopay?.lastRunPeriod).toBeNull()
    expect(await db.payment.count({ where: { leaseId: lease.id } })).toBe(0)
  })

  it('charges each month separately', async () => {
    const { lease } = await withAutopay()
    await processAutopay(db, provider, lease.id, new Date('2026-01-10T00:00:00Z'))
    await processAutopay(db, provider, lease.id, new Date('2026-02-10T00:00:00Z'))
    expect(await db.payment.count({ where: { leaseId: lease.id } })).toBe(2)
    const finance = await getLeaseFinance(db, lease.id, { asOf: new Date('2026-02-10T00:00:00Z') })
    expect(finance.dueNowCents).toBe(0)
    expect(periodOf(new Date('2026-02-10T00:00:00Z'))).toBe('2026-02')
  })
})

// ---------------------------------------------------------------------------
// Portal HTTP surface
// ---------------------------------------------------------------------------

describe('portal API', () => {
  async function tenantToken() {
    const s = await scenario()
    const user = await db.user.create({
      data: { email: 'emily@pay.dev', passwordHash: 'x', role: 'TENANT', name: 'Emily' },
    })
    await db.tenantProfile.update({ where: { id: s.tenant.id }, data: { userId: user.id } })
    return { ...s, token: app.jwt.sign({ sub: user.id, role: 'TENANT' as const, tv: 0 }) }
  }

  const auth = (token: string) => ({ authorization: `Bearer ${token}` })

  it('adds a card, pays rent, and returns a receipt', async () => {
    const { lease, token } = await tenantToken()
    await ensureRentCharges(db, lease.id, periodOf(new Date()))

    const add = await app.inject({
      method: 'POST',
      url: '/portal/payment-methods',
      headers: auth(token),
      payload: { number: GOOD_CARD, expMonth: 12, expYear: futureYear, cvc: '123' },
    })
    expect(add.statusCode).toBe(201)
    const method = add.json().method
    expect(method).toMatchObject({ brand: 'VISA', last4: '4242' })
    expect(JSON.stringify(method)).not.toContain(GOOD_CARD)

    const pay = await app.inject({
      method: 'POST',
      url: '/portal/pay',
      headers: auth(token),
      payload: { amountCents: 100000, paymentMethodId: method.id, idempotencyKey: 'http-pay-1' },
    })
    expect(pay.statusCode).toBe(200)
    expect(pay.json().receiptNumber).toMatch(/^RCPT-/)

    const receipts = await app.inject({ method: 'GET', url: '/portal/receipts', headers: auth(token) })
    expect(receipts.json().receipts).toHaveLength(1)
  })

  it('surfaces a decline as 402 without recording a payment', async () => {
    const { lease, token } = await tenantToken()
    await ensureRentCharges(db, lease.id, periodOf(new Date()))

    const add = await app.inject({
      method: 'POST',
      url: '/portal/payment-methods',
      headers: auth(token),
      payload: { number: DECLINE_CARD, expMonth: 12, expYear: futureYear, cvc: '123' },
    })
    const method = add.json().method

    const pay = await app.inject({
      method: 'POST',
      url: '/portal/pay',
      headers: auth(token),
      payload: { amountCents: 100000, paymentMethodId: method.id, idempotencyKey: 'http-decline' },
    })
    expect(pay.statusCode).toBe(402)
    expect(pay.json().code).toBe('card_declined')
    expect(await db.payment.count({ where: { leaseId: lease.id } })).toBe(0)
  })

  it('the first card added becomes the default, later ones do not', async () => {
    const { method: seeded, token } = await tenantToken()
    // The scenario already seeded one default card.
    await db.paymentMethod.delete({ where: { id: seeded.id } })

    const first = await app.inject({
      method: 'POST',
      url: '/portal/payment-methods',
      headers: auth(token),
      payload: { number: GOOD_CARD, expMonth: 12, expYear: futureYear, cvc: '123' },
    })
    expect(first.json().method.isDefault).toBe(true)

    const second = await app.inject({
      method: 'POST',
      url: '/portal/payment-methods',
      headers: auth(token),
      payload: { number: '5555555555554444', expMonth: 12, expYear: futureYear, cvc: '123' },
    })
    expect(second.json().method).toMatchObject({ brand: 'MASTERCARD', isDefault: false })

    // Promoting the second demotes the first.
    const promote = await app.inject({
      method: 'POST',
      url: `/portal/payment-methods/${second.json().method.id}/default`,
      headers: auth(token),
    })
    expect(promote.statusCode).toBe(200)

    const list = await app.inject({ method: 'GET', url: '/portal/payment-methods', headers: auth(token) })
    const defaults = list.json().methods.filter((m: { isDefault: boolean }) => m.isDefault)
    expect(defaults).toHaveLength(1)
    expect(defaults[0].brand).toBe('MASTERCARD')
  })

  it('rejects an invalid card number with 400', async () => {
    const { token } = await tenantToken()
    const add = await app.inject({
      method: 'POST',
      url: '/portal/payment-methods',
      headers: auth(token),
      payload: { number: '4242424242424241', expMonth: 12, expYear: futureYear, cvc: '123' },
    })
    expect(add.statusCode).toBe(400)
  })

  it('a tenant cannot pay with another tenant’s card', async () => {
    const a = await tenantToken()
    const outsiderTenant = await db.tenantProfile.create({ data: { managerId: a.manager.id, fullName: 'Other' } })
    const tok = await provider.tokenizeCard({ number: GOOD_CARD, expMonth: 1, expYear: futureYear, cvc: '123' })
    const foreign = await db.paymentMethod.create({
      data: {
        tenantId: outsiderTenant.id,
        provider: 'MOCK',
        providerToken: tok.token,
        brand: 'VISA',
        last4: '4242',
        expMonth: 1,
        expYear: futureYear,
      },
    })

    const pay = await app.inject({
      method: 'POST',
      url: '/portal/pay',
      headers: auth(a.token),
      payload: { amountCents: 1000, paymentMethodId: foreign.id, idempotencyKey: 'cross-tenant' },
    })
    expect(pay.statusCode).toBe(404)
    expect(await db.payment.count()).toBe(0)
  })

  it('autopay can be enabled and blocks deleting the card it uses', async () => {
    const { method, token } = await tenantToken()

    const on = await app.inject({
      method: 'PUT',
      url: '/portal/autopay',
      headers: auth(token),
      payload: { enabled: true, paymentMethodId: method.id },
    })
    expect(on.statusCode).toBe(200)
    expect(on.json().autopay.enabled).toBe(true)

    const del = await app.inject({ method: 'DELETE', url: `/portal/payment-methods/${method.id}`, headers: auth(token) })
    expect(del.statusCode).toBe(400)

    const off = await app.inject({ method: 'PUT', url: '/portal/autopay', headers: auth(token), payload: { enabled: false } })
    expect(off.statusCode).toBe(200)

    const del2 = await app.inject({ method: 'DELETE', url: `/portal/payment-methods/${method.id}`, headers: auth(token) })
    expect(del2.statusCode).toBe(200)
  })

  it('messages round-trip between tenant and manager', async () => {
    const { lease, manager, token } = await tenantToken()
    const managerToken = app.jwt.sign({ sub: manager.id, role: 'MANAGER' as const, tv: 0 })

    const sent = await app.inject({
      method: 'POST',
      url: '/portal/messages',
      headers: auth(token),
      payload: { body: 'The heater is making a noise.' },
    })
    expect(sent.statusCode).toBe(201)

    const inbox = await app.inject({ method: 'GET', url: '/messages', headers: auth(managerToken) })
    expect(inbox.json().threads).toHaveLength(1)
    expect(inbox.json().threads[0].unread).toBe(1)

    const reply = await app.inject({
      method: 'POST',
      url: `/leases/${lease.id}/messages`,
      headers: auth(managerToken),
      payload: { body: 'Sending someone Tuesday.' },
    })
    expect(reply.statusCode).toBe(201)

    const thread = await app.inject({ method: 'GET', url: '/portal/messages', headers: auth(token) })
    expect(thread.json().messages).toHaveLength(2)
  })

  it('statement CSV is scoped to the tenant', async () => {
    const { lease, token } = await tenantToken()
    await ensureRentCharges(db, lease.id, '2026-01')
    const res = await app.inject({ method: 'GET', url: '/portal/statement.csv', headers: auth(token) })
    expect(res.statusCode).toBe(200)
    expect(res.body.split('\n')[0]).toBe('Date,Type,Description,Charge,Payment')
    expect(res.body).toContain('RENT')
  })

  it('a manager cannot reach tenant portal routes', async () => {
    const { manager } = await tenantToken()
    const managerToken = app.jwt.sign({ sub: manager.id, role: 'MANAGER' as const, tv: 0 })
    const res = await app.inject({ method: 'GET', url: '/portal/overview', headers: auth(managerToken) })
    expect(res.statusCode).toBe(403)
  })

  describe('payment submissions (proof + approve/reject)', () => {
    const managerTokenFor = (managerId: string) => app.jwt.sign({ sub: managerId, role: 'MANAGER' as const, tv: 0 })

    it('a tenant submits, and approval writes a payment that clears the balance', async () => {
      const { lease, manager, token } = await tenantToken()
      await ensureRentCharges(db, lease.id, periodOf(new Date()))

      const before = await getLeaseFinance(db, lease.id)
      expect(before.dueNowCents).toBeGreaterThan(0)
      const owed = before.dueNowCents

      const submit = await app.inject({
        method: 'POST',
        url: '/portal/payment-submissions',
        headers: auth(token),
        payload: { amountCents: owed, method: 'ZELLE', paidOn: new Date().toISOString().slice(0, 10), reference: 'Zelle #123' },
      })
      expect(submit.statusCode).toBe(201)
      const subId = submit.json().submission.id

      // Manager sees it pending.
      const mgr = managerTokenFor(manager.id)
      const pending = await app.inject({ method: 'GET', url: '/payment-submissions?status=PENDING', headers: auth(mgr) })
      expect(pending.json().submissions).toHaveLength(1)
      expect(pending.json().submissions[0]).toMatchObject({ amountCents: owed, method: 'ZELLE', status: 'PENDING' })

      // Approve → a Payment appears and the balance clears.
      const approve = await app.inject({ method: 'POST', url: `/payment-submissions/${subId}/approve`, headers: auth(mgr) })
      expect(approve.statusCode).toBe(200)
      expect(approve.json().receiptNumber).toMatch(/^RCPT-/)

      const after = await getLeaseFinance(db, lease.id)
      expect(after.dueNowCents).toBe(0)
      const payment = await db.payment.findFirst({ where: { leaseId: lease.id, source: 'MANUAL' } })
      expect(payment).toMatchObject({ method: 'ZELLE', amountCents: owed })

      // Re-approving is a no-op (already reviewed).
      const again = await app.inject({ method: 'POST', url: `/payment-submissions/${subId}/approve`, headers: auth(mgr) })
      expect(again.json().alreadyReviewed).toBe(true)
      expect(await db.payment.count({ where: { leaseId: lease.id, source: 'MANUAL' } })).toBe(1)
    })

    it('rejecting records the reason and creates no payment', async () => {
      const { lease, manager, token } = await tenantToken()
      await ensureRentCharges(db, lease.id, periodOf(new Date()))
      const submit = await app.inject({
        method: 'POST',
        url: '/portal/payment-submissions',
        headers: auth(token),
        payload: { amountCents: 50000, method: 'CASH', paidOn: new Date().toISOString().slice(0, 10) },
      })
      const subId = submit.json().submission.id

      const mgr = managerTokenFor(manager.id)
      const reject = await app.inject({
        method: 'POST',
        url: `/payment-submissions/${subId}/reject`,
        headers: auth(mgr),
        payload: { reason: "Can't find this in my account" },
      })
      expect(reject.statusCode).toBe(200)
      expect(reject.json().status).toBe('REJECTED')

      expect(await db.payment.count({ where: { leaseId: lease.id, source: 'MANUAL' } })).toBe(0)
      const list = await app.inject({ method: 'GET', url: '/portal/payment-submissions', headers: auth(token) })
      expect(list.json().submissions[0]).toMatchObject({ status: 'REJECTED', reviewNote: "Can't find this in my account" })
    })

    it('a manager cannot review another manager\'s submissions', async () => {
      const a = await tenantToken()
      await ensureRentCharges(db, a.lease.id, periodOf(new Date()))
      const submit = await app.inject({
        method: 'POST',
        url: '/portal/payment-submissions',
        headers: auth(a.token),
        payload: { amountCents: 1000, method: 'OTHER', paidOn: new Date().toISOString().slice(0, 10) },
      })
      const subId = submit.json().submission.id

      const outsider = await db.user.create({ data: { email: 'outsider-sub@pay.dev', passwordHash: 'x', role: 'MANAGER', name: 'X' } })
      const res = await app.inject({ method: 'POST', url: `/payment-submissions/${subId}/approve`, headers: auth(managerTokenFor(outsider.id)) })
      expect(res.statusCode).toBe(404)
    })
  })
})

// ---------------------------------------------------------------------------
// Manager notifications on a new payment submission
// ---------------------------------------------------------------------------

class RecorderPush implements PushProvider {
  readonly name = 'REC'
  calls: { tokens: string[]; message: PushMessage }[] = []
  async send(tokens: string[], message: PushMessage) {
    this.calls.push({ tokens, message })
  }
}
class RecorderEmail implements EmailProvider {
  readonly name = 'REC'
  sent: EmailMessage[] = []
  async send(message: EmailMessage) {
    this.sent.push(message)
  }
}

describe('new-submission notifications', () => {
  async function submissionFor(managerEmail: string, tenantName: string) {
    const s = await scenario()
    await db.user.update({ where: { id: s.manager.id }, data: { email: managerEmail } })
    await db.tenantProfile.update({ where: { id: s.tenant.id }, data: { fullName: tenantName } })
    const submission = await db.paymentSubmission.create({
      data: { leaseId: s.lease.id, tenantId: s.tenant.id, amountCents: 175000, method: 'ZELLE', paidOn: new Date(), reference: 'conf #99' },
    })
    return { ...s, submission }
  }

  it('pushes to the manager\'s devices and emails them, with the amount and tenant', async () => {
    const { manager, submission } = await submissionFor('boss@notify.dev', 'Emily Chen')
    await db.deviceToken.create({ data: { userId: manager.id, token: 'ExponentPushToken[abc123]' } })

    const push = new RecorderPush()
    const email = new RecorderEmail()
    await notifyManagerNewSubmission(db, { push, email }, submission.id)

    // Push: to the manager's token, mentioning the amount, with a deep link.
    expect(push.calls).toHaveLength(1)
    expect(push.calls[0].tokens).toEqual(['ExponentPushToken[abc123]'])
    expect(push.calls[0].message.body).toContain('$1,750')
    expect(push.calls[0].message.body).toContain('Emily Chen')
    expect(push.calls[0].message.data).toMatchObject({ type: 'payment_submission', submissionId: submission.id })

    // Email: to the manager, amount in subject and body.
    expect(email.sent).toHaveLength(1)
    expect(email.sent[0].to).toBe('boss@notify.dev')
    expect(email.sent[0].subject).toContain('$1,750')
    expect(email.sent[0].text).toContain('Emily Chen')
  })

  it('still emails when the manager has no registered devices', async () => {
    const { submission } = await submissionFor('nodev@notify.dev', 'Dan Marino')
    const push = new RecorderPush()
    const email = new RecorderEmail()
    await notifyManagerNewSubmission(db, { push, email }, submission.id)

    expect(push.calls[0].tokens).toEqual([]) // no tokens, but call is made
    expect(email.sent[0].to).toBe('nodev@notify.dev')
  })

  it('notifies the owning manager, not another', async () => {
    const a = await submissionFor('a@notify.dev', 'Tenant A')
    await db.deviceToken.create({ data: { userId: a.manager.id, token: 'ExponentPushToken[aaa]' } })
    // A second, unrelated manager with their own device.
    const other = await db.user.create({ data: { email: 'b@notify.dev', passwordHash: 'x', role: 'MANAGER', name: 'B' } })
    await db.deviceToken.create({ data: { userId: other.id, token: 'ExponentPushToken[bbb]' } })

    const push = new RecorderPush()
    const email = new RecorderEmail()
    await notifyManagerNewSubmission(db, { push, email }, a.submission.id)

    expect(push.calls[0].tokens).toEqual(['ExponentPushToken[aaa]'])
    expect(email.sent[0].to).toBe('a@notify.dev')
  })
})

describe('review notifications to the tenant', () => {
  // A tenant with a linked portal account (User + device) and a submission.
  async function reviewedSetup(status: 'APPROVED' | 'REJECTED', opts?: { reviewNote?: string; withDevice?: boolean }) {
    const s = await scenario()
    const user = await db.user.create({ data: { email: 'tenant@notify.dev', passwordHash: 'x', role: 'TENANT', name: 'Emily' } })
    await db.tenantProfile.update({ where: { id: s.tenant.id }, data: { userId: user.id, fullName: 'Emily Chen' } })
    if (opts?.withDevice !== false) {
      await db.deviceToken.create({ data: { userId: user.id, token: 'ExponentPushToken[tenant-dev]' } })
    }
    const payment =
      status === 'APPROVED'
        ? await db.payment.create({
            data: { leaseId: s.lease.id, amountCents: 120000, receivedDate: new Date(), method: 'ZELLE', source: 'MANUAL', receiptNumber: 'RCPT-TEST-1' },
          })
        : null
    const submission = await db.paymentSubmission.create({
      data: {
        leaseId: s.lease.id,
        tenantId: s.tenant.id,
        amountCents: 120000,
        method: 'ZELLE',
        paidOn: new Date(),
        status,
        reviewNote: opts?.reviewNote ?? null,
        reviewedAt: new Date(),
        paymentId: payment?.id ?? null,
      },
    })
    return { ...s, user, submission }
  }

  it('pushes + emails the tenant on approval, with the receipt number', async () => {
    const { submission } = await reviewedSetup('APPROVED')
    const push = new RecorderPush()
    const email = new RecorderEmail()
    await notifyTenantSubmissionReviewed(db, { push, email }, submission.id)

    expect(push.calls[0].tokens).toEqual(['ExponentPushToken[tenant-dev]'])
    expect(push.calls[0].message.title).toBe('Payment approved')
    expect(push.calls[0].message.body).toContain('$1,200')
    expect(push.calls[0].message.body).toContain('RCPT-TEST-1')
    expect(push.calls[0].message.data).toMatchObject({ type: 'payment_reviewed', screen: '/pay' })
    expect(email.sent[0].to).toBe('tenant@notify.dev')
    expect(email.sent[0].subject).toContain('approved')
  })

  it('tells the tenant why it was rejected', async () => {
    const { submission } = await reviewedSetup('REJECTED', { reviewNote: 'No transfer received' })
    const push = new RecorderPush()
    const email = new RecorderEmail()
    await notifyTenantSubmissionReviewed(db, { push, email }, submission.id)

    expect(push.calls[0].message.title).toBe('Payment not accepted')
    expect(push.calls[0].message.body).toContain('No transfer received')
    expect(email.sent[0].text).toContain('No transfer received')
  })

  it('does nothing while a submission is still pending', async () => {
    const s = await scenario()
    const user = await db.user.create({ data: { email: 'p@notify.dev', passwordHash: 'x', role: 'TENANT', name: 'P' } })
    await db.tenantProfile.update({ where: { id: s.tenant.id }, data: { userId: user.id } })
    const submission = await db.paymentSubmission.create({
      data: { leaseId: s.lease.id, tenantId: s.tenant.id, amountCents: 1000, method: 'CASH', paidOn: new Date() },
    })
    const push = new RecorderPush()
    const email = new RecorderEmail()
    await notifyTenantSubmissionReviewed(db, { push, email }, submission.id)
    expect(push.calls).toHaveLength(0)
    expect(email.sent).toHaveLength(0)
  })

  it('emails the profile contact when the tenant has no portal account', async () => {
    const s = await scenario()
    await db.tenantProfile.update({ where: { id: s.tenant.id }, data: { email: 'contact@notify.dev' } })
    const submission = await db.paymentSubmission.create({
      data: { leaseId: s.lease.id, tenantId: s.tenant.id, amountCents: 5000, method: 'CHECK', paidOn: new Date(), status: 'APPROVED', reviewedAt: new Date() },
    })
    const push = new RecorderPush()
    const email = new RecorderEmail()
    await notifyTenantSubmissionReviewed(db, { push, email }, submission.id)
    expect(push.calls[0].tokens).toEqual([]) // no devices
    expect(email.sent[0].to).toBe('contact@notify.dev')
  })
})

describe('notification center (persisted history + endpoints)', () => {
  const noop = { push: new RecorderPush(), email: new RecorderEmail() }
  const auth = (token: string) => ({ authorization: `Bearer ${token}` })
  const managerTok = (id: string) => app.jwt.sign({ sub: id, role: 'MANAGER' as const, tv: 0 })

  it('records a manager notification with a deep link when a payment is submitted', async () => {
    const s = await scenario()
    const submission = await db.paymentSubmission.create({
      data: { leaseId: s.lease.id, tenantId: s.tenant.id, amountCents: 120000, method: 'ZELLE', paidOn: new Date() },
    })
    await notifyManagerNewSubmission(db, noop, submission.id)

    const list = await app.inject({ method: 'GET', url: '/me/notifications', headers: auth(managerTok(s.manager.id)) })
    expect(list.statusCode).toBe(200)
    expect(list.json().unreadCount).toBe(1)
    expect(list.json().notifications[0]).toMatchObject({ type: 'PAYMENT_SUBMISSION', read: false })
    expect(list.json().notifications[0].data).toMatchObject({ screen: '/payment-approvals', submissionId: submission.id })
  })

  it('records a tenant notification on review, and read-all clears the badge', async () => {
    const s = await scenario()
    const user = await db.user.create({ data: { email: 'nc-tenant@x.dev', passwordHash: 'x', role: 'TENANT', name: 'E' } })
    await db.tenantProfile.update({ where: { id: s.tenant.id }, data: { userId: user.id } })
    const payment = await db.payment.create({
      data: { leaseId: s.lease.id, amountCents: 90000, receivedDate: new Date(), method: 'ZELLE', source: 'MANUAL', receiptNumber: 'RCPT-NC-1' },
    })
    const submission = await db.paymentSubmission.create({
      data: { leaseId: s.lease.id, tenantId: s.tenant.id, amountCents: 90000, method: 'ZELLE', paidOn: new Date(), status: 'APPROVED', reviewedAt: new Date(), paymentId: payment.id },
    })
    await notifyTenantSubmissionReviewed(db, noop, submission.id)

    const tenantToken = app.jwt.sign({ sub: user.id, role: 'TENANT' as const, tv: 0 })

    const count1 = await app.inject({ method: 'GET', url: '/me/notifications/unread-count', headers: auth(tenantToken) })
    expect(count1.json().unreadCount).toBe(1)

    const readAll = await app.inject({ method: 'POST', url: '/me/notifications/read-all', headers: auth(tenantToken), payload: {} })
    expect(readAll.statusCode).toBe(200)

    const count2 = await app.inject({ method: 'GET', url: '/me/notifications/unread-count', headers: auth(tenantToken) })
    expect(count2.json().unreadCount).toBe(0)
    const list = await app.inject({ method: 'GET', url: '/me/notifications', headers: auth(tenantToken) })
    expect(list.json().notifications[0].read).toBe(true)
  })

  it('a user only sees their own notifications', async () => {
    const s = await scenario()
    const submission = await db.paymentSubmission.create({
      data: { leaseId: s.lease.id, tenantId: s.tenant.id, amountCents: 1000, method: 'CASH', paidOn: new Date() },
    })
    await notifyManagerNewSubmission(db, noop, submission.id) // → notification for s.manager

    const outsider = await db.user.create({ data: { email: 'nc-outsider@x.dev', passwordHash: 'x', role: 'MANAGER', name: 'O' } })
    const list = await app.inject({ method: 'GET', url: '/me/notifications', headers: auth(managerTok(outsider.id)) })
    expect(list.json().notifications).toHaveLength(0)
    expect(list.json().unreadCount).toBe(0)
  })
})

import path from 'node:path'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { buildApp } from '../src/app.js'
import { createPrisma, type DB } from '../src/db.js'
import { ensureRentCharges, periodOf } from '../src/billing.js'
import { MockPaymentProvider } from '../src/payments/mock.js'
import { resolveJwtSecret } from '../src/security.js'

const dbUrl = `file:${path.resolve('prisma/test.db')}`
let db: DB
let app: FastifyInstance
let provider: MockPaymentProvider

const GOOD_CARD = '4242424242424242'
const futureYear = new Date().getUTCFullYear() + 3

beforeAll(async () => {
  db = createPrisma(dbUrl)
  provider = new MockPaymentProvider()
  app = await buildApp({ db, jwtSecret: 'test-secret-that-is-long-enough-to-pass', paymentProvider: provider, rateLimit: false })
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

const auth = (token: string) => ({ authorization: `Bearer ${token}` })
async function inject(method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE', url: string, token?: string, payload?: object) {
  const res = await app.inject({ method, url, headers: token ? auth(token) : {}, payload })
  let body: Record<string, unknown> = {}
  try { body = res.json() } catch { /* non-JSON (e.g. file bytes) */ }
  return { status: res.statusCode, body, raw: res }
}

async function manager(email: string) {
  const reg = await inject('POST', '/auth/register', undefined, { name: 'Mgr', email, password: 'password123' })
  return reg.body.token as string
}

// A tenant with a lease, a saved good card, and a portal login token.
async function tenant(email: string, opts?: { card?: string; rentCents?: number }) {
  const mgr = await db.user.create({ data: { email: `mgr-${email}`, passwordHash: 'x', role: 'MANAGER', name: 'M' } })
  const property = await db.property.create({ data: { managerId: mgr.id, name: 'P', address: '1 St' } })
  const unit = await db.unit.create({ data: { propertyId: property.id, label: 'A' } })
  const profile = await db.tenantProfile.create({ data: { managerId: mgr.id, fullName: 'T' } })
  const start = new Date('2026-01-01T00:00:00Z')
  const lease = await db.lease.create({
    data: {
      unitId: unit.id, startDate: start, dueDay: 1, graceDays: 5, lateFeeCents: 0,
      tenants: { create: [{ tenantId: profile.id }] },
      rentTerms: { create: [{ amountCents: opts?.rentCents ?? 100000, effectiveFrom: start }] },
    },
  })
  const user = await db.user.create({ data: { email, passwordHash: 'x', role: 'TENANT', name: 'T', tokenVersion: 0 } })
  await db.tenantProfile.update({ where: { id: profile.id }, data: { userId: user.id } })
  const tok = await provider.tokenizeCard({ number: opts?.card ?? GOOD_CARD, expMonth: 1, expYear: futureYear, cvc: '123' })
  const method = await db.paymentMethod.create({
    data: { tenantId: profile.id, provider: 'MOCK', providerToken: tok.token, brand: tok.brand, last4: tok.last4, expMonth: 1, expYear: futureYear, isDefault: true },
  })
  const token = app.signToken(user)
  return { user, profile, lease, method, token, managerId: mgr.id }
}

// ---------------------------------------------------------------------------
// JWT hardening
// ---------------------------------------------------------------------------

describe('token lifecycle', () => {
  it('issued tokens carry an expiry', async () => {
    const token = await manager('exp@sec.dev')
    const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString())
    expect(payload.exp).toBeGreaterThan(payload.iat)
    expect(payload.tv).toBe(0)
  })

  it('a changed password revokes existing tokens (tokenVersion)', async () => {
    const token = await manager('rotate@sec.dev')
    expect((await inject('GET', '/me', token)).status).toBe(200)

    const change = await inject('POST', '/auth/change-password', token, { currentPassword: 'password123', newPassword: 'newpassword123' })
    expect(change.status).toBe(200)

    // Old token is now dead; the freshly returned one works.
    expect((await inject('GET', '/me', token)).status).toBe(401)
    expect((await inject('GET', '/me', change.body.token as string)).status).toBe(200)
  })

  it('logout-all revokes every session', async () => {
    const token = await manager('logoutall@sec.dev')
    const res = await inject('POST', '/auth/logout-all', token)
    expect(res.status).toBe(200)
    expect((await inject('GET', '/me', token)).status).toBe(401)
  })

  it('a token for a deleted user is rejected', async () => {
    const t = await tenant('ghost@sec.dev')
    await db.paymentMethod.deleteMany({ where: { tenantId: t.profile.id } })
    await db.tenantProfile.update({ where: { id: t.profile.id }, data: { userId: null } })
    await db.user.delete({ where: { id: t.user.id } })
    expect((await inject('GET', '/portal/overview', t.token)).status).toBe(401)
  })

  it('a forged/garbage token is rejected', async () => {
    expect((await inject('GET', '/me', 'not.a.jwt')).status).toBe(401)
    expect((await inject('GET', '/dashboard')).status).toBe(401)
  })
})

describe('secret handling', () => {
  it('production refuses a weak or default secret', () => {
    expect(() => resolveJwtSecret({ NODE_ENV: 'production' } as NodeJS.ProcessEnv)).toThrow()
    expect(() => resolveJwtSecret({ NODE_ENV: 'production', JWT_SECRET: 'short' } as NodeJS.ProcessEnv)).toThrow()
    expect(() =>
      resolveJwtSecret({ NODE_ENV: 'production', JWT_SECRET: 'pman-dev-secret-change-in-production' } as NodeJS.ProcessEnv),
    ).toThrow()
    expect(resolveJwtSecret({ NODE_ENV: 'production', JWT_SECRET: 'x'.repeat(40) } as NodeJS.ProcessEnv)).toHaveLength(40)
  })
})

describe('password policy', () => {
  it('rejects passwords shorter than 8 characters', async () => {
    const res = await inject('POST', '/auth/register', undefined, { name: 'A', email: 'short@sec.dev', password: 'short1' })
    expect(res.status).toBe(400)
  })

  it('accepts an 8+ character password', async () => {
    const res = await inject('POST', '/auth/register', undefined, { name: 'A', email: 'long@sec.dev', password: 'longenough1' })
    expect(res.status).toBe(200)
  })
})

describe('login does not leak account existence', () => {
  it('returns the same generic error for wrong password and unknown email', async () => {
    await inject('POST', '/auth/register', undefined, { name: 'A', email: 'known@sec.dev', password: 'password123' })
    const wrongPw = await inject('POST', '/auth/login', undefined, { email: 'known@sec.dev', password: 'wrongpassword' })
    const unknown = await inject('POST', '/auth/login', undefined, { email: 'nobody@sec.dev', password: 'whatever12' })
    expect(wrongPw.status).toBe(400)
    expect(unknown.status).toBe(400)
    expect(wrongPw.body.error).toBe(unknown.body.error)
  })
})

// ---------------------------------------------------------------------------
// Payment authorization & idempotency
// ---------------------------------------------------------------------------

describe('payment idempotency is tenant-safe', () => {
  it('one tenant\'s idempotency key cannot replay another tenant\'s payment', async () => {
    const a = await tenant('a-pay@sec.dev')
    const b = await tenant('b-pay@sec.dev')
    await ensureRentCharges(db, a.lease.id, periodOf(new Date()))
    await ensureRentCharges(db, b.lease.id, periodOf(new Date()))

    const KEY = 'collision-key'
    const pa = await inject('POST', '/portal/pay', a.token, { amountCents: 1000, paymentMethodId: a.method.id, idempotencyKey: KEY })
    const pb = await inject('POST', '/portal/pay', b.token, { amountCents: 50000, paymentMethodId: b.method.id, idempotencyKey: KEY })

    expect(pa.status).toBe(200)
    expect(pb.status).toBe(200)
    // Distinct payments — b is charged its own amount, not a replay of a.
    expect(pb.body.paymentId).not.toBe(pa.body.paymentId)
    expect(pb.body.amountCents).toBe(50000)
    expect(pb.body.receiptNumber).not.toBe(pa.body.receiptNumber)
  })

  it('a tenant cannot squat the autopay slot with a crafted key', async () => {
    const t = await tenant('squat@sec.dev', { rentCents: 100000 })
    await ensureRentCharges(db, t.lease.id, periodOf(new Date()))
    await db.autopay.create({ data: { leaseId: t.lease.id, tenantId: t.profile.id, paymentMethodId: t.method.id, enabled: true } })

    const period = periodOf(new Date())
    // Attempt to pre-claim the autopay key format via a manual (portal) payment.
    await inject('POST', '/portal/pay', t.token, { amountCents: 1, paymentMethodId: t.method.id, idempotencyKey: `autopay:${t.lease.id}:${period}` })

    // Autopay still runs (not blocked by the crafted key) and clears the balance.
    const overview = await inject('GET', '/portal/overview', t.token)
    expect(overview.status).toBe(200)
    const autopayCharge = await db.payment.findFirst({ where: { leaseId: t.lease.id, source: 'AUTOPAY' } })
    expect(autopayCharge).not.toBeNull()
    expect(autopayCharge!.amountCents).toBeGreaterThan(0)
    expect((overview.body as { balanceCents: number }).balanceCents).toBe(0)
  })

  it('cannot pay with a card belonging to another tenant', async () => {
    const a = await tenant('a-card@sec.dev')
    const b = await tenant('b-card@sec.dev')
    await ensureRentCharges(db, a.lease.id, periodOf(new Date()))
    const res = await inject('POST', '/portal/pay', a.token, { amountCents: 1000, paymentMethodId: b.method.id, idempotencyKey: 'x-card-key-long' })
    expect(res.status).toBe(404)
    expect(await db.payment.count({ where: { leaseId: a.lease.id } })).toBe(0)
  })

  it('rejects absurdly large amounts at validation, before the gateway', async () => {
    const t = await tenant('big@sec.dev')
    await ensureRentCharges(db, t.lease.id, periodOf(new Date()))
    const res = await inject('POST', '/portal/pay', t.token, { amountCents: 999_999_999, paymentMethodId: t.method.id, idempotencyKey: 'big-amount-key' })
    expect(res.status).toBe(400)
  })

  // Amounts at or beyond 2^31 must never reach the database: the money columns
  // are 32-bit INTEGERs, and SQLite stores an oversized value happily while
  // Prisma then refuses to read the row back — permanently 500ing the rent
  // roll, dashboard, reports and the tenant's ledger.
  it('rejects money values that would overflow the 32-bit money columns', async () => {
    const t = await tenant('overflow@sec.dev')
    const mgrUser = await db.user.findUniqueOrThrow({ where: { id: t.managerId } })
    const mgrToken = app.signToken(mgrUser)
    const lease = t.lease
    for (const amount of [2_147_483_648, 3_000_000_000, 100_000_001]) {
      const payment = await inject('POST', `/leases/${lease.id}/payments`, mgrToken, {
        amountCents: amount,
        receivedDate: '2026-01-05',
        method: 'CASH',
      })
      expect(payment.status, `payment ${amount}`).toBe(400)

      const charge = await inject('POST', `/leases/${lease.id}/charges`, mgrToken, {
        amountCents: amount,
        dueDate: '2026-01-05',
        description: 'overflow probe',
      })
      expect(charge.status, `charge ${amount}`).toBe(400)
    }
    // The ledger must still be readable afterwards.
    const ledger = await inject('GET', `/leases/${lease.id}/ledger`, mgrToken)
    expect(ledger.status).toBe(200)
  })
})

// ---------------------------------------------------------------------------
// File access control
// ---------------------------------------------------------------------------

describe('file access', () => {
  async function uploadDoc(managerToken: string, leaseId: string) {
    const boundary = '----pmantest'
    const parts =
      `--${boundary}\r\nContent-Disposition: form-data; name="ownerType"\r\n\r\nLEASE\r\n` +
      `--${boundary}\r\nContent-Disposition: form-data; name="ownerId"\r\n\r\n${leaseId}\r\n` +
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="lease.pdf"\r\nContent-Type: application/pdf\r\n\r\n%PDF-1.4 test\r\n` +
      `--${boundary}--\r\n`
    const res = await app.inject({
      method: 'POST',
      url: '/documents',
      headers: { authorization: `Bearer ${managerToken}`, 'content-type': `multipart/form-data; boundary=${boundary}` },
      payload: parts,
    })
    return res
  }

  it('serves a file only with a valid signed token, and 404s without traversal', async () => {
    const t = await tenant('doc@sec.dev')
    const managerToken = app.signToken(await db.user.findFirstOrThrow({ where: { id: t.managerId } }))
    const up = await uploadDoc(managerToken, t.lease.id)
    expect(up.statusCode).toBe(201)
    const url = up.json().document.url as string
    expect(url).toMatch(/^\/files\/.+\?token=/)

    // With the signed token → 200.
    const ok = await app.inject({ method: 'GET', url })
    expect(ok.statusCode).toBe(200)

    // Same file, no token → 400/401 (never served openly).
    const nameOnly = url.split('?')[0]
    const noToken = await app.inject({ method: 'GET', url: nameOnly })
    expect([400, 401]).toContain(noToken.statusCode)

    // Path traversal is refused.
    const traverse = await app.inject({ method: 'GET', url: `/files/..%2f..%2fpackage.json?token=abc` })
    expect([400, 401, 403, 404]).toContain(traverse.statusCode)
  })

  it('rejects a disallowed upload type', async () => {
    const t = await tenant('badfile@sec.dev')
    const managerToken = app.signToken(await db.user.findFirstOrThrow({ where: { id: t.managerId } }))
    const boundary = '----pmantest'
    const parts =
      `--${boundary}\r\nContent-Disposition: form-data; name="ownerType"\r\n\r\nLEASE\r\n` +
      `--${boundary}\r\nContent-Disposition: form-data; name="ownerId"\r\n\r\n${t.lease.id}\r\n` +
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="evil.exe"\r\nContent-Type: application/octet-stream\r\n\r\nMZ\r\n` +
      `--${boundary}--\r\n`
    const res = await app.inject({
      method: 'POST',
      url: '/documents',
      headers: { authorization: `Bearer ${managerToken}`, 'content-type': `multipart/form-data; boundary=${boundary}` },
      payload: parts,
    })
    expect(res.statusCode).toBe(400)
  })
})

// ---------------------------------------------------------------------------
// Account management
// ---------------------------------------------------------------------------

describe('account management', () => {
  it('updates profile and enforces email uniqueness', async () => {
    const t1 = await manager('acct1@sec.dev')
    await manager('acct2@sec.dev')

    const ok = await inject('PATCH', '/me', t1, { name: 'Renamed', phone: '555-0000' })
    expect(ok.status).toBe(200)
    expect(ok.body.user).toMatchObject({ name: 'Renamed', phone: '555-0000' })

    const clash = await inject('PATCH', '/me', t1, { email: 'acct2@sec.dev' })
    expect(clash.status).toBe(400)
  })

  it('change-password requires the correct current password', async () => {
    const t = await manager('pwcheck@sec.dev')
    const wrong = await inject('POST', '/auth/change-password', t, { currentPassword: 'nope12345', newPassword: 'brandnew123' })
    expect(wrong.status).toBe(400)
  })
})

describe('account deletion', () => {
  it('needs the correct password and then kills the session', async () => {
    const token = await manager('del-mgr@sec.dev')
    const wrong = await inject('POST', '/auth/delete-account', token, { password: 'wrongpass1' })
    expect(wrong.status).toBe(400)

    const ok = await inject('POST', '/auth/delete-account', token, { password: 'password123' })
    expect(ok.status).toBe(200)

    // The token is dead and the account can't log in.
    expect((await inject('GET', '/me', token)).status).toBe(401)
    const login = await inject('POST', '/auth/login', undefined, { email: 'del-mgr@sec.dev', password: 'password123' })
    expect(login.status).toBe(400)
  })

  it('deleting a manager removes all their data', async () => {
    // Build a manager with a property, unit, tenant, lease, payment and message.
    const t = await tenant('del-tenant@sec.dev')
    await ensureRentCharges(db, t.lease.id, periodOf(new Date()))
    await inject('POST', '/portal/pay', t.token, { amountCents: 1000, paymentMethodId: t.method.id, idempotencyKey: 'del-pay-key-1' })
    await inject('POST', '/portal/messages', t.token, { body: 'hi manager' })
    const managerToken = app.signToken(await db.user.findFirstOrThrow({ where: { id: t.managerId } }))

    const del = await inject('POST', '/auth/delete-account', managerToken, { password: 'x' /* db user, not via register */ })
    // This manager was created directly with passwordHash 'x' so the password
    // check fails — delete through the service directly to assert cleanup.
    expect(del.status).toBe(400)

    const { deleteAccount } = await import('../src/account.js')
    await deleteAccount(db, t.managerId)

    expect(await db.property.count({ where: { managerId: t.managerId } })).toBe(0)
    expect(await db.lease.count({ where: { id: t.lease.id } })).toBe(0)
    expect(await db.tenantProfile.count({ where: { managerId: t.managerId } })).toBe(0)
    expect(await db.payment.count({ where: { leaseId: t.lease.id } })).toBe(0)
    expect(await db.user.count({ where: { id: t.managerId } })).toBe(0)
  })

  it('deleting a tenant unlinks the profile but keeps the manager\'s records', async () => {
    const t = await tenant('leaving-tenant@sec.dev')
    await ensureRentCharges(db, t.lease.id, periodOf(new Date()))
    const pay = await inject('POST', '/portal/pay', t.token, { amountCents: 1000, paymentMethodId: t.method.id, idempotencyKey: 'keep-receipt-key' })
    expect(pay.status).toBe(200)

    const { deleteAccount } = await import('../src/account.js')
    await deleteAccount(db, t.user.id)

    // Login gone, card gone.
    expect(await db.user.count({ where: { id: t.user.id } })).toBe(0)
    expect(await db.paymentMethod.count({ where: { tenantId: t.profile.id } })).toBe(0)

    // But the manager keeps the profile (unlinked), the lease and the payment.
    const profile = await db.tenantProfile.findUnique({ where: { id: t.profile.id } })
    expect(profile).not.toBeNull()
    expect(profile?.userId).toBeNull()
    expect(await db.lease.count({ where: { id: t.lease.id } })).toBe(1)
    expect(await db.payment.count({ where: { leaseId: t.lease.id } })).toBe(1)
  })
})

// ---------------------------------------------------------------------------
// Card handling is deferred. The Play data-safety declaration and the privacy
// policy both state no card or bank credentials are handled, so these routes
// must not exist unless explicitly switched on.
// ---------------------------------------------------------------------------

describe('card payment routes are off by default', () => {
  it('does not expose the wallet, pay or autopay endpoints without ENABLE_CARD_PAYMENTS', async () => {
    const previous = process.env.ENABLE_CARD_PAYMENTS
    delete process.env.ENABLE_CARD_PAYMENTS
    const locked = await buildApp({
      db,
      jwtSecret: 'test-secret-that-is-long-enough-to-pass',
      paymentProvider: provider,
      rateLimit: false,
    })
    try {
      for (const [method, url] of [
        ['GET', '/portal/payment-methods'],
        ['POST', '/portal/payment-methods'],
        ['POST', '/portal/pay'],
        ['GET', '/portal/autopay'],
        ['PUT', '/portal/autopay'],
      ] as const) {
        const res = await locked.inject({ method, url })
        expect(res.statusCode, `${method} ${url}`).toBe(404)
      }
    } finally {
      await locked.close()
      if (previous !== undefined) process.env.ENABLE_CARD_PAYMENTS = previous
    }
  })
})

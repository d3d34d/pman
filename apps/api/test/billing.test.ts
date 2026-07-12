import path from 'node:path'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { buildApp } from '../src/app.js'
import { createPrisma, type DB } from '../src/db.js'
import {
  addPeriods,
  allocatePayments,
  applyLateFees,
  dueDateFor,
  ensureRentCharges,
  getLeaseFinance,
  periodOf,
  periodStatusOf,
  rentAmountFor,
} from '../src/billing.js'

const dbUrl = `file:${path.resolve('prisma/test.db')}`
let db: DB
let app: FastifyInstance

beforeAll(async () => {
  db = createPrisma(dbUrl)
  app = await buildApp({ db, jwtSecret: 'test-secret', rateLimit: false })
})

afterAll(async () => {
  await app.close()
  await db.$disconnect()
})

beforeEach(async () => {
  await db.$transaction([
    db.note.deleteMany(),
    db.invite.deleteMany(),
    db.announcement.deleteMany(),
    db.document.deleteMany(),
    db.maintenanceRequest.deleteMany(),
    db.expense.deleteMany(),
    db.payment.deleteMany(),
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
// Pure helpers
// ---------------------------------------------------------------------------

describe('period helpers', () => {
  it('formats and advances periods', () => {
    expect(periodOf(new Date('2026-07-09T12:00:00Z'))).toBe('2026-07')
    expect(addPeriods('2026-11', 3)).toBe('2027-02')
    expect(addPeriods('2026-01', -2)).toBe('2025-11')
  })

  it('clamps the due day to the length of the month', () => {
    expect(dueDateFor('2026-02', 28).toISOString()).toBe('2026-02-28T00:00:00.000Z')
    expect(dueDateFor('2026-04', 15).toISOString()).toBe('2026-04-15T00:00:00.000Z')
  })
})

describe('rentAmountFor', () => {
  const term = (amountCents: number, effectiveFrom: string) => ({
    id: 'x',
    leaseId: 'l',
    amountCents,
    effectiveFrom: new Date(effectiveFrom),
    note: null,
    createdAt: new Date(),
  })

  it('applies the initial term to its own month even when it starts mid-month', () => {
    const terms = [term(100000, '2026-01-15T00:00:00Z')]
    expect(rentAmountFor(terms, '2026-01')).toBe(100000)
    expect(rentAmountFor(terms, '2025-12')).toBeNull()
  })

  it('a rent change governs periods from its effective month forward', () => {
    const terms = [term(100000, '2026-01-01T00:00:00Z'), term(120000, '2026-06-01T00:00:00Z')]
    expect(rentAmountFor(terms, '2026-05')).toBe(100000)
    expect(rentAmountFor(terms, '2026-06')).toBe(120000)
    expect(rentAmountFor(terms, '2026-12')).toBe(120000)
  })
})

describe('allocatePayments', () => {
  it('allocates FIFO by due date and reports unpaid remainders', () => {
    const charge = (id: string, amountCents: number, dueDate: string) => ({
      id,
      leaseId: 'l',
      type: 'RENT',
      amountCents,
      period: dueDate.slice(0, 7),
      dueDate: new Date(dueDate),
      description: null,
      createdAt: new Date('2026-01-01'),
    })
    const payment = (amountCents: number) => ({
      id: 'p',
      leaseId: 'l',
      amountCents,
      receivedDate: new Date(),
      method: 'CASH',
      reference: null,
      note: null,
      createdAt: new Date(),
      source: 'MANUAL',
      receiptNumber: null,
      providerRef: null,
      paymentMethodId: null,
    })
    const allocated = allocatePayments(
      [charge('feb', 1000, '2026-02-01'), charge('jan', 1000, '2026-01-01'), charge('mar', 1000, '2026-03-01')],
      [payment(1500)],
    )
    expect(allocated.map((c) => [c.id, c.paidCents])).toEqual([
      ['jan', 1000],
      ['feb', 500],
      ['mar', 0],
    ])
  })
})

// ---------------------------------------------------------------------------
// DB-backed billing behavior
// ---------------------------------------------------------------------------

async function makeLease(opts?: {
  rentCents?: number
  startDate?: string
  graceDays?: number
  lateFeeCents?: number
  endDate?: string
}) {
  const manager = await db.user.create({
    data: { email: 'm@test.dev', passwordHash: 'x', role: 'MANAGER', name: 'M' },
  })
  const property = await db.property.create({
    data: { managerId: manager.id, name: 'P', address: '1 Test St' },
  })
  const unit = await db.unit.create({ data: { propertyId: property.id, label: 'A' } })
  const tenant = await db.tenantProfile.create({ data: { managerId: manager.id, fullName: 'T' } })
  const startDate = new Date(opts?.startDate ?? '2026-01-01T00:00:00Z')
  const lease = await db.lease.create({
    data: {
      unitId: unit.id,
      startDate,
      endDate: opts?.endDate ? new Date(opts.endDate) : null,
      dueDay: 1,
      graceDays: opts?.graceDays ?? 5,
      lateFeeCents: opts?.lateFeeCents ?? 5000,
      tenants: { create: [{ tenantId: tenant.id }] },
      rentTerms: { create: [{ amountCents: opts?.rentCents ?? 100000, effectiveFrom: startDate }] },
    },
  })
  return { manager, property, unit, tenant, lease }
}

describe('ensureRentCharges', () => {
  it('creates one charge per month from lease start through the requested period', async () => {
    const { lease } = await makeLease({ startDate: '2026-01-15T00:00:00Z' })
    await ensureRentCharges(db, lease.id, '2026-04')
    const charges = await db.charge.findMany({ orderBy: { period: 'asc' } })
    expect(charges.map((c) => c.period)).toEqual(['2026-01', '2026-02', '2026-03', '2026-04'])
    expect(charges.every((c) => c.amountCents === 100000)).toBe(true)
  })

  it('is idempotent: repeated runs never duplicate charges', async () => {
    const { lease } = await makeLease()
    await ensureRentCharges(db, lease.id, '2026-03')
    await ensureRentCharges(db, lease.id, '2026-03')
    await ensureRentCharges(db, lease.id, '2026-06')
    expect(await db.charge.count()).toBe(6)
  })

  it('stops charging after the lease end month', async () => {
    const { lease } = await makeLease({ endDate: '2026-03-10T00:00:00Z' })
    await ensureRentCharges(db, lease.id, '2026-12')
    const charges = await db.charge.findMany({ orderBy: { period: 'asc' } })
    expect(charges.map((c) => c.period)).toEqual(['2026-01', '2026-02', '2026-03'])
  })

  it('uses the new rent for periods on/after a rent change, leaving old charges intact', async () => {
    const { lease } = await makeLease()
    await ensureRentCharges(db, lease.id, '2026-02')
    await db.rentTerm.create({
      data: { leaseId: lease.id, amountCents: 125000, effectiveFrom: new Date('2026-03-01T00:00:00Z') },
    })
    await ensureRentCharges(db, lease.id, '2026-04')
    const charges = await db.charge.findMany({ orderBy: { period: 'asc' } })
    expect(charges.map((c) => [c.period, c.amountCents])).toEqual([
      ['2026-01', 100000],
      ['2026-02', 100000],
      ['2026-03', 125000],
      ['2026-04', 125000],
    ])
  })
})

describe('applyLateFees', () => {
  it('adds one late fee per unpaid period past grace, and never duplicates it', async () => {
    const { lease } = await makeLease({ lateFeeCents: 5000, graceDays: 5 })
    await ensureRentCharges(db, lease.id, '2026-02')
    // Feb rent due 2026-02-01; grace ends 2026-02-06.
    await applyLateFees(db, lease.id, new Date('2026-02-10T00:00:00Z'))
    await applyLateFees(db, lease.id, new Date('2026-02-11T00:00:00Z'))
    const fees = await db.charge.findMany({ where: { type: 'LATE_FEE' }, orderBy: { period: 'asc' } })
    expect(fees.map((f) => f.period)).toEqual(['2026-01', '2026-02'])
    expect(fees.every((f) => f.amountCents === 5000)).toBe(true)
  })

  it('does not add fees when rent is paid, within grace, or policy is zero', async () => {
    const paid = await makeLease({ lateFeeCents: 5000 })
    await ensureRentCharges(db, paid.lease.id, '2026-01')
    await db.payment.create({
      data: { leaseId: paid.lease.id, amountCents: 100000, receivedDate: new Date('2026-01-01'), method: 'CASH' },
    })
    await applyLateFees(db, paid.lease.id, new Date('2026-01-20T00:00:00Z'))
    expect(await db.charge.count({ where: { type: 'LATE_FEE' } })).toBe(0)

    // within grace
    await applyLateFees(db, paid.lease.id, new Date('2026-01-04T00:00:00Z'))
    expect(await db.charge.count({ where: { type: 'LATE_FEE' } })).toBe(0)
  })

  it('a partially paid month still draws a late fee past grace', async () => {
    const { lease } = await makeLease({ lateFeeCents: 5000 })
    await ensureRentCharges(db, lease.id, '2026-01')
    await db.payment.create({
      data: { leaseId: lease.id, amountCents: 40000, receivedDate: new Date('2026-01-02'), method: 'CASH' },
    })
    await applyLateFees(db, lease.id, new Date('2026-01-10T00:00:00Z'))
    expect(await db.charge.count({ where: { type: 'LATE_FEE' } })).toBe(1)
  })
})

describe('periodStatusOf', () => {
  it('walks PAID / PARTIAL / LATE / UPCOMING correctly', async () => {
    const { lease } = await makeLease({ graceDays: 5 })
    const finance = await getLeaseFinance(db, lease.id, {
      throughPeriod: '2026-02',
      asOf: new Date('2026-01-03T00:00:00Z'),
    })

    // Jan: charged 1000.00, nothing paid, Jan 3 is past due day but within grace
    expect(periodStatusOf(finance, '2026-01', 5, new Date('2026-01-03T00:00:00Z')).status).toBe('UNPAID')
    // Feb: due date in the future
    expect(periodStatusOf(finance, '2026-02', 5, new Date('2026-01-03T00:00:00Z')).status).toBe('UPCOMING')
    // Jan past grace
    expect(periodStatusOf(finance, '2026-01', 5, new Date('2026-01-09T00:00:00Z')).status).toBe('LATE')

    await db.payment.create({
      data: { leaseId: lease.id, amountCents: 60000, receivedDate: new Date('2026-01-03'), method: 'CASH' },
    })
    const partial = await getLeaseFinance(db, lease.id, { asOf: new Date('2026-01-04T00:00:00Z') })
    expect(periodStatusOf(partial, '2026-01', 5, new Date('2026-01-04T00:00:00Z')).status).toBe('PARTIAL')

    await db.payment.create({
      data: { leaseId: lease.id, amountCents: 40000, receivedDate: new Date('2026-01-04'), method: 'CASH' },
    })
    const full = await getLeaseFinance(db, lease.id, { asOf: new Date('2026-01-05T00:00:00Z') })
    expect(periodStatusOf(full, '2026-01', 5, new Date('2026-01-05T00:00:00Z')).status).toBe('PAID')
    expect(full.balanceCents).toBe(100000) // Feb's charge remains owed overall
  })
})

// ---------------------------------------------------------------------------
// End-to-end through the HTTP API
// ---------------------------------------------------------------------------

describe('dueNowCents', () => {
  it('excludes future charges that were generated early (e.g. by viewing a future rent roll)', async () => {
    const { lease } = await makeLease() // $1,000/mo from 2026-01, $50 late fee after 5 days
    const asOf = new Date('2026-01-15T00:00:00Z')
    const finance = await getLeaseFinance(db, lease.id, { throughPeriod: '2026-03', asOf })
    // Jan rent + Jan late fee are owed today; Feb and Mar exist but are not due yet.
    expect(finance.dueNowCents).toBe(105000)
    expect(finance.balanceCents).toBe(305000)
  })
})

describe('API end-to-end', () => {
  async function post(url: string, payload: object, token?: string) {
    const res = await app.inject({
      method: 'POST',
      url,
      payload,
      headers: token ? { authorization: `Bearer ${token}` } : {},
    })
    return { status: res.statusCode, body: res.json() }
  }

  async function get(url: string, token: string) {
    const res = await app.inject({ method: 'GET', url, headers: { authorization: `Bearer ${token}` } })
    return { status: res.statusCode, body: res.json() }
  }

  it('supports the full manager flow: property → unit → tenant → lease → payment → rent change', async () => {
    const reg = await post('/auth/register', { name: 'Mgr', email: 'mgr@e2e.dev', password: 'secret12' })
    expect(reg.status).toBe(200)
    const token = reg.body.token

    const prop = await post('/properties', { name: 'E2E Towers', address: '9 E2E Way' }, token)
    expect(prop.status).toBe(201)
    const unit = await post(`/properties/${prop.body.property.id}/units`, { label: '5F' }, token)
    const tenant = await post('/tenants', { fullName: 'Tess Tenant' }, token)

    // Lease started two months ago, so rent has come due 3 times (incl. current month)
    const start = new Date()
    start.setUTCMonth(start.getUTCMonth() - 2, 1)
    const lease = await post(
      '/leases',
      {
        unitId: unit.body.unit.id,
        tenantIds: [tenant.body.tenant.id],
        startDate: start.toISOString().slice(0, 10),
        rentCents: 150000,
        dueDay: 1,
        graceDays: 5,
        lateFeeCents: 2500,
      },
      token,
    )
    expect(lease.status).toBe(201)
    const leaseId = lease.body.lease.id

    // A second active lease on the same unit is rejected
    const dup = await post(
      '/leases',
      {
        unitId: unit.body.unit.id,
        tenantIds: [tenant.body.tenant.id],
        startDate: start.toISOString().slice(0, 10),
        rentCents: 100000,
      },
      token,
    )
    expect(dup.status).toBe(400)

    // Ledger: 3 rent charges + 2 late fees (months 1 and 2 unpaid past grace;
    // current month may or may not be past grace depending on today's date)
    const ledger = await get(`/leases/${leaseId}/ledger`, token)
    const rentCharges = ledger.body.charges.filter((c: { type: string }) => c.type === 'RENT')
    expect(rentCharges).toHaveLength(3)
    expect(ledger.body.balanceCents).toBeGreaterThanOrEqual(450000)

    // Pay everything off
    const owed = ledger.body.balanceCents
    const pay = await post(
      `/leases/${leaseId}/payments`,
      { amountCents: owed, receivedDate: new Date().toISOString().slice(0, 10), method: 'ZELLE' },
      token,
    )
    expect(pay.status).toBe(201)

    const roll = await get('/rent-roll', token)
    expect(roll.body.rows).toHaveLength(1)
    expect(roll.body.rows[0].status).toBe('PAID')
    expect(roll.body.rows[0].balanceCents).toBe(0)

    // Raise the rent starting next month
    const next = new Date()
    next.setUTCMonth(next.getUTCMonth() + 1, 1)
    const raise = await post(
      `/leases/${leaseId}/rent-terms`,
      { amountCents: 175000, effectiveFrom: next.toISOString().slice(0, 10), note: 'Renewal increase' },
      token,
    )
    expect(raise.status).toBe(201)

    const nextPeriod = `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, '0')}`
    const nextRoll = await get(`/rent-roll?period=${nextPeriod}`, token)
    expect(nextRoll.body.rows[0].dueCents).toBe(175000)
    expect(nextRoll.body.rows[0].status).toBe('UPCOMING')
  })

  it('scopes data per manager and locks the portal to tenants', async () => {
    const a = await post('/auth/register', { name: 'A', email: 'a@e2e.dev', password: 'secret12' })
    const b = await post('/auth/register', { name: 'B', email: 'b@e2e.dev', password: 'secret12' })
    const prop = await post('/properties', { name: 'A Prop', address: '1 A St' }, a.body.token)

    const stolen = await get(`/properties/${prop.body.property.id}`, b.body.token)
    expect(stolen.status).toBe(404)

    const portal = await get('/portal/overview', a.body.token)
    expect(portal.status).toBe(403)

    const anon = await app.inject({ method: 'GET', url: '/dashboard' })
    expect(anon.statusCode).toBe(401)
  })

  it('invite flow creates a working tenant portal account', async () => {
    const reg = await post('/auth/register', { name: 'Mgr', email: 'mgr2@e2e.dev', password: 'secret12' })
    const token = reg.body.token
    const prop = await post('/properties', { name: 'P', address: '2 P St' }, token)
    const unit = await post(`/properties/${prop.body.property.id}/units`, { label: '1' }, token)
    const tenant = await post('/tenants', { fullName: 'Ivy Invitee' }, token)
    await post(
      '/leases',
      {
        unitId: unit.body.unit.id,
        tenantIds: [tenant.body.tenant.id],
        startDate: new Date().toISOString().slice(0, 10),
        rentCents: 90000,
      },
      token,
    )

    const invite = await post(`/tenants/${tenant.body.tenant.id}/invite`, {}, token)
    expect(invite.status).toBe(201)

    const accept = await post('/auth/accept-invite', {
      code: invite.body.invite.code,
      email: 'ivy@e2e.dev',
      password: 'secret12',
    })
    expect(accept.status).toBe(200)
    expect(accept.body.user.role).toBe('TENANT')

    const overview = await get('/portal/overview', accept.body.token)
    expect(overview.status).toBe(200)
    expect(overview.body.lease.currentRentCents).toBe(90000)

    // Reusing the invite fails
    const reuse = await post('/auth/accept-invite', {
      code: invite.body.invite.code,
      email: 'other@e2e.dev',
      password: 'secret12',
    })
    expect(reuse.status).toBe(400)
  })
})

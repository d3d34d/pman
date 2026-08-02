// Seed script: wipes the database and loads realistic demo data so every
// screen has content on first run.  `npm run seed`
import './env.js' // loads apps/api/.env before Prisma reads DATABASE_URL
import bcrypt from 'bcryptjs'
import { createPrisma } from './db.js'
import { ensureRentCharges, periodOf } from './billing.js'
import { MockPaymentProvider } from './payments/mock.js'

const db = createPrisma()

const now = new Date()
const currentPeriod = periodOf(now)

function monthsAgo(n: number, day = 1): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - n, day))
}

function monthsAhead(n: number, day = 1): Date {
  return monthsAgo(-n, day)
}

const METHODS = ['BANK_TRANSFER', 'ZELLE', 'CHECK', 'CASH'] as const

/** Create one payment per RENT charge, optionally skipping recent periods or
 *  paying the last one partially. */
async function payRent(leaseId: string, opts: { skipCurrent?: boolean; partialCurrentCents?: number } = {}) {
  await ensureRentCharges(db, leaseId, currentPeriod)
  const charges = await db.charge.findMany({
    where: { leaseId, type: 'RENT' },
    orderBy: { period: 'asc' },
  })
  let i = 0
  for (const charge of charges) {
    const isCurrent = charge.period === currentPeriod
    if (isCurrent && opts.skipCurrent) continue
    const amount = isCurrent && opts.partialCurrentCents ? opts.partialCurrentCents : charge.amountCents
    await db.payment.create({
      data: {
        leaseId,
        amountCents: amount,
        receivedDate: charge.dueDate,
        method: METHODS[i++ % METHODS.length],
        note: isCurrent && opts.partialCurrentCents ? 'Partial payment — remainder promised next week' : undefined,
      },
    })
  }
}

/**
 * Refuses to run anywhere that looks like production. This script DELETES
 * EVERY ROW before reloading sample data — running it once against a live
 * database destroys every landlord's real records, irreversibly.
 */
function assertNotProduction(): void {
  const url = process.env.DATABASE_URL ?? ''
  const isLocalFile = url.startsWith('file:') && !url.includes('/data/')
  const forced = process.argv.includes('--force')

  if (process.env.NODE_ENV === 'production' && !forced) {
    throw new Error(
      'Refusing to seed: NODE_ENV=production. This wipes every table.\n' +
        'If you are certain this database has no real data, re-run with --force.',
    )
  }
  if (!isLocalFile && !forced) {
    throw new Error(
      `Refusing to seed: DATABASE_URL (${url || 'unset'}) is not a local file.\n` +
        'This wipes every table. If you are certain, re-run with --force.',
    )
  }
}

async function main() {
  assertNotProduction()

  // Wipe in dependency order
  await db.$transaction([
    db.note.deleteMany(),
    db.invite.deleteMany(),
    db.announcement.deleteMany(),
    db.document.deleteMany(),
    db.message.deleteMany(),
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

  const passwordHash = await bcrypt.hash('password123', 10)

  const manager = await db.user.create({
    data: { email: 'manager@pman.dev', passwordHash, role: 'MANAGER', name: 'Riley Morgan', phone: '555-0100' },
  })

  // Properties & units ------------------------------------------------------
  const maple = await db.property.create({
    data: {
      managerId: manager.id,
      name: 'Maple Court Apartments',
      address: '410 Maple Court, Springfield',
      type: 'Apartment building',
    },
  })
  const oakwood = await db.property.create({
    data: {
      managerId: manager.id,
      name: 'Oakwood Duplex',
      address: '12 Oakwood Drive, Springfield',
      type: 'Duplex',
    },
  })

  const [u1a, u1b, u2a, u2b] = await Promise.all(
    ['1A', '1B', '2A', '2B'].map((label, i) =>
      db.unit.create({
        data: {
          propertyId: maple.id,
          label,
          bedrooms: i < 2 ? 1 : 2,
          bathrooms: 1,
          sqft: i < 2 ? 620 : 840,
          marketRentCents: i < 2 ? 140000 : 165000,
        },
      }),
    ),
  )
  const [left, right] = await Promise.all(
    ['Left', 'Right'].map((label) =>
      db.unit.create({
        data: { propertyId: oakwood.id, label, bedrooms: 3, bathrooms: 2, sqft: 1250, marketRentCents: 180000 },
      }),
    ),
  )

  // Tenants ------------------------------------------------------------------
  const mk = (data: Parameters<typeof db.tenantProfile.create>[0]['data']) => db.tenantProfile.create({ data })
  const aisha = await mk({ managerId: manager.id, fullName: 'Aisha Rahman', email: 'aisha@example.com', phone: '555-0111', emergencyName: 'Imran Rahman', emergencyPhone: '555-0112' })
  const marcus = await mk({ managerId: manager.id, fullName: 'Marcus Bell', email: 'marcus@example.com', phone: '555-0121' })
  const sofia = await mk({ managerId: manager.id, fullName: 'Sofia Marino', email: 'sofia@example.com', phone: '555-0131' })
  const dan = await mk({ managerId: manager.id, fullName: 'Dan Marino', email: 'dan@example.com', phone: '555-0132' })
  const david = await mk({ managerId: manager.id, fullName: 'David Okafor', email: 'david@example.com', phone: '555-0141' })
  const emily = await mk({ managerId: manager.id, fullName: 'Emily Chen', email: 'tenant@pman.dev', phone: '555-0151', emergencyName: 'Lin Chen', emergencyPhone: '555-0152' })
  const frank = await mk({ managerId: manager.id, fullName: 'Frank Miller', email: 'frank@example.com', phone: '555-0161', status: 'FORMER' })

  // Emily has a portal account
  const emilyUser = await db.user.create({
    data: { email: 'tenant@pman.dev', passwordHash, role: 'TENANT', name: 'Emily Chen', phone: '555-0151' },
  })
  await db.tenantProfile.update({ where: { id: emily.id }, data: { userId: emilyUser.id } })

  // Leases --------------------------------------------------------------------
  const lease = (data: Parameters<typeof db.lease.create>[0]['data']) => db.lease.create({ data })

  // 1A — Aisha, fully paid
  const leaseA = await lease({
    unitId: u1a.id, status: 'ACTIVE', startDate: monthsAgo(8), endDate: monthsAhead(4, 0 + 1),
    dueDay: 1, depositCents: 140000, graceDays: 5, lateFeeCents: 5000,
    tenants: { create: [{ tenantId: aisha.id }] },
    rentTerms: { create: [{ amountCents: 140000, effectiveFrom: monthsAgo(8), note: 'Initial rent' }] },
  })
  await payRent(leaseA.id)

  // 1B — Marcus, current month unpaid (will show LATE + auto late fee)
  const leaseB = await lease({
    unitId: u1b.id, status: 'ACTIVE', startDate: monthsAgo(14), endDate: monthsAhead(10),
    dueDay: 1, depositCents: 135000, graceDays: 5, lateFeeCents: 5000,
    tenants: { create: [{ tenantId: marcus.id }] },
    rentTerms: { create: [{ amountCents: 135000, effectiveFrom: monthsAgo(14), note: 'Initial rent' }] },
  })
  await payRent(leaseB.id, { skipCurrent: true })

  // 2A — Sofia + Dan, partial payment this month (longer grace, still open)
  const leaseC = await lease({
    unitId: u2a.id, status: 'ACTIVE', startDate: monthsAgo(6), endDate: monthsAhead(6),
    dueDay: 1, depositCents: 160000, graceDays: 15, lateFeeCents: 7500,
    tenants: { create: [{ tenantId: sofia.id }, { tenantId: dan.id }] },
    rentTerms: { create: [{ amountCents: 160000, effectiveFrom: monthsAgo(6), note: 'Initial rent' }] },
  })
  await payRent(leaseC.id, { partialCurrentCents: 60000 })

  // 2B — David, paid, lease expiring within 90 days
  const leaseD = await lease({
    unitId: u2b.id, status: 'ACTIVE', startDate: monthsAgo(22), endDate: monthsAhead(2, 15),
    dueDay: 1, depositCents: 150000, graceDays: 5, lateFeeCents: 5000,
    tenants: { create: [{ tenantId: david.id }] },
    rentTerms: { create: [{ amountCents: 150000, effectiveFrom: monthsAgo(22), note: 'Initial rent' }] },
  })
  await payRent(leaseD.id)

  // Oakwood Left — Emily, month-to-month, rent increased 4 months ago
  const leaseE = await lease({
    unitId: left.id, status: 'MONTH_TO_MONTH', startDate: monthsAgo(16),
    dueDay: 1, depositCents: 165000, graceDays: 5, lateFeeCents: 5000,
    tenants: { create: [{ tenantId: emily.id }] },
    rentTerms: {
      create: [
        { amountCents: 165000, effectiveFrom: monthsAgo(16), note: 'Initial rent' },
        { amountCents: 175000, effectiveFrom: monthsAgo(4), note: 'Annual increase — market adjustment' },
      ],
    },
  })
  await payRent(leaseE.id)

  // Oakwood Right — Frank's ended lease (unit now vacant)
  const leaseF = await lease({
    unitId: right.id, status: 'ENDED', startDate: monthsAgo(26), endDate: monthsAgo(2, 28),
    dueDay: 1, depositCents: 175000, graceDays: 5, lateFeeCents: 5000,
    tenants: { create: [{ tenantId: frank.id }] },
    rentTerms: { create: [{ amountCents: 175000, effectiveFrom: monthsAgo(26), note: 'Initial rent' }] },
  })
  await payRent(leaseF.id)

  // Maintenance ----------------------------------------------------------------
  await db.maintenanceRequest.create({
    data: {
      unitId: left.id, leaseId: leaseE.id, createdById: emilyUser.id,
      title: 'Kitchen faucet dripping', description: 'The kitchen faucet has been dripping constantly for a few days. Getting worse.',
      priority: 'NORMAL', status: 'OPEN',
    },
  })
  await db.maintenanceRequest.create({
    data: {
      unitId: u1b.id, leaseId: leaseB.id, createdById: manager.id,
      title: 'Hallway smoke detector beeping', description: 'Low battery chirp reported by neighbor; replace batteries in 1B hallway detector.',
      priority: 'HIGH', status: 'IN_PROGRESS', vendorName: 'SafeHome Services',
    },
  })
  await db.maintenanceRequest.create({
    data: {
      unitId: u2a.id, leaseId: leaseC.id, createdById: manager.id,
      title: 'Bedroom window seal replacement', description: 'Draft coming through the bedroom window; seal replaced.',
      priority: 'NORMAL', status: 'RESOLVED', vendorName: 'GlassPro', costCents: 22000,
      resolvedAt: monthsAgo(1, 20),
    },
  })

  // Expenses --------------------------------------------------------------------
  const expenses: [string, string, number, Date, string][] = [
    [maple.id, 'REPAIRS', 22000, monthsAgo(1, 20), 'Window seal replacement — unit 2A'],
    [maple.id, 'UTILITIES', 18500, monthsAgo(1, 5), 'Common area electricity'],
    [maple.id, 'INSURANCE', 95000, monthsAgo(2, 12), 'Quarterly property insurance'],
    [maple.id, 'UTILITIES', 17900, monthsAgo(2, 5), 'Common area electricity'],
    [oakwood.id, 'REPAIRS', 45000, monthsAgo(2, 18), 'Gutter repair after storm'],
    [oakwood.id, 'TAXES', 210000, monthsAgo(3, 1), 'Property tax installment'],
    [maple.id, 'MANAGEMENT', 12000, monthsAgo(0, 2), 'Landscaping service'],
  ]
  for (const [propertyId, category, amountCents, incurredOn, description] of expenses) {
    await db.expense.create({ data: { propertyId, category, amountCents, incurredOn, description } })
  }

  // Notes, invite, announcement ---------------------------------------------------
  await db.note.create({
    data: { tenantId: marcus.id, authorId: manager.id, body: 'Called about July rent — says paycheck was delayed, will pay by the 15th.' },
  })
  await db.note.create({
    data: { tenantId: aisha.id, authorId: manager.id, body: 'Model tenant. Interested in renewing early — send renewal offer in September.' },
  })

  const invite = await db.invite.create({
    data: { code: 'WELCOME1', tenantId: aisha.id, expiresAt: new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000) },
  })

  // Emily's saved card (tokenized through the mock gateway — no PAN stored).
  const mock = new MockPaymentProvider()
  const visa = await mock.tokenizeCard({ number: '4242424242424242', expMonth: 11, expYear: now.getUTCFullYear() + 3, cvc: '123' })
  const emilyCard = await db.paymentMethod.create({
    data: {
      tenantId: emily.id,
      provider: 'MOCK',
      providerToken: visa.token,
      brand: visa.brand,
      last4: visa.last4,
      expMonth: visa.expMonth,
      expYear: visa.expYear,
      isDefault: true,
    },
  })
  console.log(`  Seeded Emily a ${emilyCard.brand} ····${emilyCard.last4}`)

  // A message thread so the portal inbox isn't empty.
  await db.message.create({
    data: { leaseId: leaseE.id, senderId: emilyUser.id, body: 'Hi Riley — is the water shutoff still happening Thursday?', readAt: new Date() },
  })
  await db.message.create({
    data: { leaseId: leaseE.id, senderId: manager.id, body: 'Yes, 10am to about 1pm. I’ll post an update if it changes.' },
  })

  await db.announcement.create({
    data: {
      propertyId: oakwood.id,
      title: 'Water shutoff Thursday 10am–1pm',
      body: 'The city is replacing a valve on Oakwood Drive. Water will be off Thursday from 10am to about 1pm. Sorry for the inconvenience!',
    },
  })

  console.log('Seeded successfully.')
  console.log('  Manager login:  manager@pman.dev / password123')
  console.log('  Tenant login:   tenant@pman.dev / password123  (Emily Chen)')
  console.log(`  Unused invite:  ${invite.code}  (for Aisha Rahman)`)
  console.log('  Test cards:     4242 4242 4242 4242 succeeds')
  console.log('                  4000 0000 0000 0002 declines')
  console.log('                  4000 0000 0000 9995 insufficient funds')
}

await main()
await db.$disconnect()

// In-memory data store + billing engine for DEMO MODE.
//
// When the app is exported for the static GitHub Pages site there is no API
// server to talk to, so `EXPO_PUBLIC_DEMO=1` routes every `api()` call to the
// handler in ./backend.ts, which runs against this store. It mirrors the real
// Fastify + Prisma backend's data shapes and money math closely enough that
// every screen renders and the headline flows (submit a payment → approve it,
// change rent, message, notifications) actually work. It lives entirely in
// browser memory and resets on page refresh.

export type Role = 'MANAGER' | 'TENANT'

export type User = {
  id: string
  email: string
  password: string
  role: Role
  name: string
  phone: string | null
  tokenVersion: number
}

export type Property = {
  id: string
  managerId: string
  name: string
  address: string
  type: string | null
  notes: string | null
  createdAt: Date
}

export type Unit = {
  id: string
  propertyId: string
  label: string
  bedrooms: number | null
  bathrooms: number | null
  sqft: number | null
  marketRentCents: number | null
  notes: string | null
  createdAt: Date
}

export type TenantProfile = {
  id: string
  managerId: string
  userId: string | null
  fullName: string
  email: string | null
  phone: string | null
  emergencyName: string | null
  emergencyPhone: string | null
  status: 'ACTIVE' | 'FORMER'
  createdAt: Date
}

export type Lease = {
  id: string
  unitId: string
  status: 'ACTIVE' | 'MONTH_TO_MONTH' | 'ENDED'
  startDate: Date
  endDate: Date | null
  dueDay: number
  depositCents: number
  graceDays: number
  lateFeeCents: number
  notes: string | null
  createdAt: Date
}

export type RentTerm = {
  id: string
  leaseId: string
  amountCents: number
  effectiveFrom: Date
  note: string | null
  createdAt: Date
}

export type LeaseTenant = { leaseId: string; tenantId: string }

export type ChargeType = 'RENT' | 'LATE_FEE' | 'OTHER'
export type Charge = {
  id: string
  leaseId: string
  type: ChargeType
  amountCents: number
  period: string
  dueDate: Date
  description: string | null
  createdAt: Date
}

export type Payment = {
  id: string
  leaseId: string
  amountCents: number
  receivedDate: Date
  method: string
  source: string
  receiptNumber: string | null
  reference: string | null
  note: string | null
  providerRef: string | null
  paymentMethodId: string | null
  createdAt: Date
}

export type MaintenanceRequest = {
  id: string
  unitId: string
  leaseId: string | null
  createdById: string
  title: string
  description: string
  priority: 'LOW' | 'NORMAL' | 'HIGH' | 'URGENT'
  status: 'OPEN' | 'IN_PROGRESS' | 'RESOLVED'
  vendorName: string | null
  costCents: number | null
  resolvedAt: Date | null
  createdAt: Date
}

export type Expense = {
  id: string
  propertyId: string
  category: string
  amountCents: number
  incurredOn: Date
  description: string | null
  createdAt: Date
}

export type Note = { id: string; tenantId: string; authorId: string; body: string; createdAt: Date }
export type Invite = { id: string; code: string; tenantId: string; usedAt: Date | null; expiresAt: Date; createdAt: Date }
export type Announcement = { id: string; propertyId: string; title: string; body: string; createdAt: Date }
export type Message = { id: string; leaseId: string; senderId: string; body: string; readAt: Date | null; createdAt: Date }

export type PaymentSubmission = {
  id: string
  leaseId: string
  tenantId: string
  amountCents: number
  method: string
  paidOn: Date
  reference: string | null
  note: string | null
  status: 'PENDING' | 'APPROVED' | 'REJECTED'
  reviewNote: string | null
  reviewedAt: Date | null
  paymentId: string | null
  proofUrl: string | null
  createdAt: Date
}

export type Notification = {
  id: string
  userId: string
  type: string
  title: string
  body: string
  data: string | null
  readAt: Date | null
  createdAt: Date
}

export type Document = {
  id: string
  managerId: string
  ownerType: string
  ownerId: string
  filename: string
  mimeType: string | null
  url: string
  uploadedAt: Date
}

export type Store = {
  users: User[]
  properties: Property[]
  units: Unit[]
  tenants: TenantProfile[]
  leases: Lease[]
  rentTerms: RentTerm[]
  leaseTenants: LeaseTenant[]
  charges: Charge[]
  payments: Payment[]
  maintenance: MaintenanceRequest[]
  expenses: Expense[]
  notes: Note[]
  invites: Invite[]
  announcements: Announcement[]
  messages: Message[]
  submissions: PaymentSubmission[]
  notifications: Notification[]
  documents: Document[]
}

// ---------------------------------------------------------------------------
// id + period helpers
// ---------------------------------------------------------------------------

let seq = 0
export function uid(prefix = 'id'): string {
  seq += 1
  return `${prefix}_${seq.toString(36)}${Math.random().toString(36).slice(2, 8)}`
}

export function periodOf(date: Date): string {
  const y = date.getUTCFullYear()
  const m = String(date.getUTCMonth() + 1).padStart(2, '0')
  return `${y}-${m}`
}
export function addPeriods(period: string, n: number): string {
  const [y, m] = period.split('-').map(Number)
  return periodOf(new Date(Date.UTC(y, m - 1 + n, 1)))
}
export function dueDateFor(period: string, dueDay: number): Date {
  const [y, m] = period.split('-').map(Number)
  const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate()
  return new Date(Date.UTC(y, m - 1, Math.min(dueDay, daysInMonth)))
}
function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 24 * 60 * 60 * 1000)
}

export function rentAmountFor(terms: RentTerm[], period: string): number | null {
  let winner: RentTerm | null = null
  for (const t of terms) {
    if (periodOf(t.effectiveFrom) > period) continue
    if (!winner || t.effectiveFrom > winner.effectiveFrom) winner = t
  }
  return winner ? winner.amountCents : null
}

// ---------------------------------------------------------------------------
// billing engine (ports apps/api/src/billing.ts against the in-memory store)
// ---------------------------------------------------------------------------

export function ensureRentCharges(store: Store, leaseId: string, throughPeriod: string): void {
  const lease = store.leases.find((l) => l.id === leaseId)
  if (!lease) return
  const terms = store.rentTerms.filter((t) => t.leaseId === leaseId)

  let endPeriod = throughPeriod
  if (lease.endDate) {
    const leaseEnd = periodOf(lease.endDate)
    if (leaseEnd < endPeriod) endPeriod = leaseEnd
  }

  const existing = new Set(store.charges.filter((c) => c.leaseId === leaseId && c.type === 'RENT').map((c) => c.period))
  for (let p = periodOf(lease.startDate); p <= endPeriod; p = addPeriods(p, 1)) {
    if (existing.has(p)) continue
    const amount = rentAmountFor(terms, p)
    if (amount === null || amount <= 0) continue
    store.charges.push({
      id: uid('chg'),
      leaseId,
      type: 'RENT',
      amountCents: amount,
      period: p,
      dueDate: dueDateFor(p, lease.dueDay),
      description: 'Monthly rent',
      createdAt: new Date(),
    })
  }
}

export type AllocatedCharge = Charge & { paidCents: number; unpaidCents: number }

export function allocatePayments(charges: Charge[], payments: Payment[]): AllocatedCharge[] {
  const ordered = [...charges].sort(
    (a, b) => a.dueDate.getTime() - b.dueDate.getTime() || a.createdAt.getTime() - b.createdAt.getTime(),
  )
  let pool = payments.reduce((s, p) => s + p.amountCents, 0)
  return ordered.map((c) => {
    const paid = Math.min(pool, c.amountCents)
    pool -= paid
    return { ...c, paidCents: paid, unpaidCents: c.amountCents - paid }
  })
}

export function applyLateFees(store: Store, leaseId: string, asOf: Date): void {
  const lease = store.leases.find((l) => l.id === leaseId)
  if (!lease || lease.lateFeeCents <= 0) return
  const charges = store.charges.filter((c) => c.leaseId === leaseId)
  const payments = store.payments.filter((p) => p.leaseId === leaseId)
  const allocated = allocatePayments(charges, payments)
  const feePeriods = new Set(charges.filter((c) => c.type === 'LATE_FEE').map((c) => c.period))

  for (const c of allocated) {
    if (c.type !== 'RENT' || c.unpaidCents <= 0 || feePeriods.has(c.period)) continue
    const graceEnd = addDays(c.dueDate, lease.graceDays)
    if (asOf <= graceEnd) continue
    store.charges.push({
      id: uid('chg'),
      leaseId,
      type: 'LATE_FEE',
      amountCents: lease.lateFeeCents,
      period: c.period,
      dueDate: graceEnd,
      description: `Late fee — ${c.period} rent unpaid past ${lease.graceDays}-day grace period`,
      createdAt: new Date(),
    })
    feePeriods.add(c.period)
  }
}

export type LeaseFinance = {
  charges: AllocatedCharge[]
  payments: Payment[]
  totalChargedCents: number
  totalPaidCents: number
  balanceCents: number
  dueNowCents: number
}

export function getLeaseFinance(store: Store, leaseId: string, opts?: { throughPeriod?: string; asOf?: Date }): LeaseFinance {
  const asOf = opts?.asOf ?? new Date()
  const through = opts?.throughPeriod && opts.throughPeriod > periodOf(asOf) ? opts.throughPeriod : periodOf(asOf)
  ensureRentCharges(store, leaseId, through)
  applyLateFees(store, leaseId, asOf)

  const charges = store.charges.filter((c) => c.leaseId === leaseId)
  const payments = store.payments
    .filter((p) => p.leaseId === leaseId)
    .sort((a, b) => a.receivedDate.getTime() - b.receivedDate.getTime())
  const allocated = allocatePayments(charges, payments)
  const totalChargedCents = charges.reduce((s, c) => s + c.amountCents, 0)
  const totalPaidCents = payments.reduce((s, p) => s + p.amountCents, 0)
  const dueNowCents = allocated.filter((c) => c.dueDate <= asOf).reduce((s, c) => s + c.unpaidCents, 0)
  return { charges: allocated, payments, totalChargedCents, totalPaidCents, balanceCents: totalChargedCents - totalPaidCents, dueNowCents }
}

export type PeriodStatus = 'PAID' | 'PARTIAL' | 'UNPAID' | 'LATE' | 'UPCOMING' | 'NO_CHARGES'

export function periodStatusOf(
  finance: Pick<LeaseFinance, 'charges'>,
  period: string,
  graceDays: number,
  asOf: Date,
): { status: PeriodStatus; dueCents: number; paidCents: number } {
  const periodCharges = finance.charges.filter((c) => c.period === period)
  const dueCents = periodCharges.reduce((s, c) => s + c.amountCents, 0)
  const paidCents = periodCharges.reduce((s, c) => s + c.paidCents, 0)
  if (periodCharges.length === 0) return { status: 'NO_CHARGES', dueCents: 0, paidCents: 0 }
  const unpaid = dueCents - paidCents
  if (unpaid <= 0) return { status: 'PAID', dueCents, paidCents }
  const rentDue = periodCharges.find((c) => c.type === 'RENT')?.dueDate ?? periodCharges[0].dueDate
  if (asOf > addDays(rentDue, graceDays)) return { status: 'LATE', dueCents, paidCents }
  if (paidCents > 0) return { status: 'PARTIAL', dueCents, paidCents }
  if (asOf > rentDue) return { status: 'UNPAID', dueCents, paidCents }
  return { status: 'UPCOMING', dueCents, paidCents }
}

export function isLeaseActiveIn(lease: Pick<Lease, 'status' | 'startDate' | 'endDate'>, period: string): boolean {
  if (periodOf(lease.startDate) > period) return false
  if (lease.endDate && periodOf(lease.endDate) < period) return false
  if (lease.status === 'ENDED' && lease.endDate === null) return false
  return true
}

export function receiptNumber(): string {
  return `PMAN-${Math.floor(100000 + Math.random() * 900000)}`
}

// ---------------------------------------------------------------------------
// seed — mirrors apps/api/src/seed.ts
// ---------------------------------------------------------------------------

const METHODS = ['BANK_TRANSFER', 'ZELLE', 'CHECK', 'CASH'] as const

export function seedStore(): Store {
  const now = new Date()
  const currentPeriod = periodOf(now)
  const monthsAgo = (n: number, day = 1) => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - n, day))
  const monthsAhead = (n: number, day = 1) => monthsAgo(-n, day)

  const store: Store = {
    users: [],
    properties: [],
    units: [],
    tenants: [],
    leases: [],
    rentTerms: [],
    leaseTenants: [],
    charges: [],
    payments: [],
    maintenance: [],
    expenses: [],
    notes: [],
    invites: [],
    announcements: [],
    messages: [],
    submissions: [],
    notifications: [],
    documents: [],
  }

  const manager: User = {
    id: uid('usr'),
    email: 'manager@pman.dev',
    password: 'password123',
    role: 'MANAGER',
    name: 'Riley Morgan',
    phone: '555-0100',
    tokenVersion: 0,
  }
  store.users.push(manager)

  const property = (name: string, address: string, type: string): Property => {
    const p: Property = { id: uid('prp'), managerId: manager.id, name, address, type, notes: null, createdAt: new Date() }
    store.properties.push(p)
    return p
  }
  const maple = property('Maple Court Apartments', '410 Maple Court, Springfield', 'Apartment building')
  const oakwood = property('Oakwood Duplex', '12 Oakwood Drive, Springfield', 'Duplex')

  const unit = (propertyId: string, label: string, bedrooms: number, bathrooms: number, sqft: number, marketRentCents: number): Unit => {
    const u: Unit = { id: uid('unt'), propertyId, label, bedrooms, bathrooms, sqft, marketRentCents, notes: null, createdAt: new Date() }
    store.units.push(u)
    return u
  }
  const u1a = unit(maple.id, '1A', 1, 1, 620, 140000)
  const u1b = unit(maple.id, '1B', 1, 1, 620, 140000)
  const u2a = unit(maple.id, '2A', 2, 1, 840, 165000)
  const u2b = unit(maple.id, '2B', 2, 1, 840, 165000)
  const left = unit(oakwood.id, 'Left', 3, 2, 1250, 180000)
  const right = unit(oakwood.id, 'Right', 3, 2, 1250, 180000)

  const tenant = (data: Partial<TenantProfile> & { fullName: string }): TenantProfile => {
    const t: TenantProfile = {
      id: uid('tnt'),
      managerId: manager.id,
      userId: null,
      fullName: data.fullName,
      email: data.email ?? null,
      phone: data.phone ?? null,
      emergencyName: data.emergencyName ?? null,
      emergencyPhone: data.emergencyPhone ?? null,
      status: data.status ?? 'ACTIVE',
      createdAt: new Date(),
    }
    store.tenants.push(t)
    return t
  }
  const aisha = tenant({ fullName: 'Aisha Rahman', email: 'aisha@example.com', phone: '555-0111', emergencyName: 'Imran Rahman', emergencyPhone: '555-0112' })
  const marcus = tenant({ fullName: 'Marcus Bell', email: 'marcus@example.com', phone: '555-0121' })
  const sofia = tenant({ fullName: 'Sofia Marino', email: 'sofia@example.com', phone: '555-0131' })
  const dan = tenant({ fullName: 'Dan Marino', email: 'dan@example.com', phone: '555-0132' })
  const david = tenant({ fullName: 'David Okafor', email: 'david@example.com', phone: '555-0141' })
  const emily = tenant({ fullName: 'Emily Chen', email: 'tenant@pman.dev', phone: '555-0151', emergencyName: 'Lin Chen', emergencyPhone: '555-0152' })
  tenant({ fullName: 'Frank Miller', email: 'frank@example.com', phone: '555-0161', status: 'FORMER' })
  const frank = store.tenants[store.tenants.length - 1]

  const emilyUser: User = { id: uid('usr'), email: 'tenant@pman.dev', password: 'password123', role: 'TENANT', name: 'Emily Chen', phone: '555-0151', tokenVersion: 0 }
  store.users.push(emilyUser)
  emily.userId = emilyUser.id

  type LeaseInput = {
    unit: Unit
    status: Lease['status']
    startDate: Date
    endDate?: Date | null
    dueDay?: number
    depositCents: number
    graceDays: number
    lateFeeCents: number
    tenants: TenantProfile[]
    rentTerms: { amountCents: number; effectiveFrom: Date; note: string }[]
  }
  const makeLease = (input: LeaseInput): Lease => {
    const l: Lease = {
      id: uid('lse'),
      unitId: input.unit.id,
      status: input.status,
      startDate: input.startDate,
      endDate: input.endDate ?? null,
      dueDay: input.dueDay ?? 1,
      depositCents: input.depositCents,
      graceDays: input.graceDays,
      lateFeeCents: input.lateFeeCents,
      notes: null,
      createdAt: new Date(),
    }
    store.leases.push(l)
    for (const t of input.tenants) store.leaseTenants.push({ leaseId: l.id, tenantId: t.id })
    for (const rt of input.rentTerms) {
      store.rentTerms.push({ id: uid('rtm'), leaseId: l.id, amountCents: rt.amountCents, effectiveFrom: rt.effectiveFrom, note: rt.note, createdAt: new Date() })
    }
    return l
  }

  const payRent = (leaseId: string, opts: { skipCurrent?: boolean; partialCurrentCents?: number } = {}) => {
    ensureRentCharges(store, leaseId, currentPeriod)
    const charges = store.charges.filter((c) => c.leaseId === leaseId && c.type === 'RENT').sort((a, b) => a.period.localeCompare(b.period))
    let i = 0
    for (const charge of charges) {
      const isCurrent = charge.period === currentPeriod
      if (isCurrent && opts.skipCurrent) continue
      const amount = isCurrent && opts.partialCurrentCents ? opts.partialCurrentCents : charge.amountCents
      store.payments.push({
        id: uid('pay'),
        leaseId,
        amountCents: amount,
        receivedDate: charge.dueDate,
        method: METHODS[i++ % METHODS.length],
        source: 'MANUAL',
        receiptNumber: receiptNumber(),
        reference: null,
        note: isCurrent && opts.partialCurrentCents ? 'Partial payment — remainder promised next week' : null,
        providerRef: null,
        paymentMethodId: null,
        createdAt: new Date(),
      })
    }
  }

  const leaseA = makeLease({ unit: u1a, status: 'ACTIVE', startDate: monthsAgo(8), endDate: monthsAhead(4, 1), depositCents: 140000, graceDays: 5, lateFeeCents: 5000, tenants: [aisha], rentTerms: [{ amountCents: 140000, effectiveFrom: monthsAgo(8), note: 'Initial rent' }] })
  payRent(leaseA.id)

  const leaseB = makeLease({ unit: u1b, status: 'ACTIVE', startDate: monthsAgo(14), endDate: monthsAhead(10), depositCents: 135000, graceDays: 5, lateFeeCents: 5000, tenants: [marcus], rentTerms: [{ amountCents: 135000, effectiveFrom: monthsAgo(14), note: 'Initial rent' }] })
  payRent(leaseB.id, { skipCurrent: true })

  const leaseC = makeLease({ unit: u2a, status: 'ACTIVE', startDate: monthsAgo(6), endDate: monthsAhead(6), depositCents: 160000, graceDays: 15, lateFeeCents: 7500, tenants: [sofia, dan], rentTerms: [{ amountCents: 160000, effectiveFrom: monthsAgo(6), note: 'Initial rent' }] })
  payRent(leaseC.id, { partialCurrentCents: 60000 })

  const leaseD = makeLease({ unit: u2b, status: 'ACTIVE', startDate: monthsAgo(22), endDate: monthsAhead(2, 15), depositCents: 150000, graceDays: 5, lateFeeCents: 5000, tenants: [david], rentTerms: [{ amountCents: 150000, effectiveFrom: monthsAgo(22), note: 'Initial rent' }] })
  payRent(leaseD.id)

  const leaseE = makeLease({
    unit: left,
    status: 'MONTH_TO_MONTH',
    startDate: monthsAgo(16),
    depositCents: 165000,
    graceDays: 5,
    lateFeeCents: 5000,
    tenants: [emily],
    rentTerms: [
      { amountCents: 165000, effectiveFrom: monthsAgo(16), note: 'Initial rent' },
      { amountCents: 175000, effectiveFrom: monthsAgo(4), note: 'Annual increase — market adjustment' },
    ],
  })
  payRent(leaseE.id)

  const leaseF = makeLease({ unit: right, status: 'ENDED', startDate: monthsAgo(26), endDate: monthsAgo(2, 28), depositCents: 175000, graceDays: 5, lateFeeCents: 5000, tenants: [frank], rentTerms: [{ amountCents: 175000, effectiveFrom: monthsAgo(26), note: 'Initial rent' }] })
  payRent(leaseF.id)

  // maintenance
  store.maintenance.push(
    { id: uid('mnt'), unitId: left.id, leaseId: leaseE.id, createdById: emilyUser.id, title: 'Kitchen faucet dripping', description: 'The kitchen faucet has been dripping constantly for a few days. Getting worse.', priority: 'NORMAL', status: 'OPEN', vendorName: null, costCents: null, resolvedAt: null, createdAt: monthsAgo(0, 3) },
    { id: uid('mnt'), unitId: u1b.id, leaseId: leaseB.id, createdById: manager.id, title: 'Hallway smoke detector beeping', description: 'Low battery chirp reported by neighbor; replace batteries in 1B hallway detector.', priority: 'HIGH', status: 'IN_PROGRESS', vendorName: 'SafeHome Services', costCents: null, resolvedAt: null, createdAt: monthsAgo(0, 6) },
    { id: uid('mnt'), unitId: u2a.id, leaseId: leaseC.id, createdById: manager.id, title: 'Bedroom window seal replacement', description: 'Draft coming through the bedroom window; seal replaced.', priority: 'NORMAL', status: 'RESOLVED', vendorName: 'GlassPro', costCents: 22000, resolvedAt: monthsAgo(1, 20), createdAt: monthsAgo(1, 12) },
  )

  // expenses
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
    store.expenses.push({ id: uid('exp'), propertyId, category, amountCents, incurredOn, description, createdAt: new Date() })
  }

  // notes
  store.notes.push(
    { id: uid('not'), tenantId: marcus.id, authorId: manager.id, body: 'Called about this month’s rent — says paycheck was delayed, will pay by the 15th.', createdAt: monthsAgo(0, 4) },
    { id: uid('not'), tenantId: aisha.id, authorId: manager.id, body: 'Model tenant. Interested in renewing early — send renewal offer in September.', createdAt: monthsAgo(1, 2) },
  )

  // invite
  store.invites.push({ id: uid('inv'), code: 'WELCOME1', tenantId: aisha.id, usedAt: null, expiresAt: new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000), createdAt: new Date() })

  // messages
  store.messages.push(
    { id: uid('msg'), leaseId: leaseE.id, senderId: emilyUser.id, body: 'Hi Riley — is the water shutoff still happening Thursday?', readAt: new Date(), createdAt: monthsAgo(0, 5) },
    { id: uid('msg'), leaseId: leaseE.id, senderId: manager.id, body: 'Yes, 10am to about 1pm. I’ll post an update if it changes.', readAt: null, createdAt: monthsAgo(0, 5) },
  )

  // announcement
  store.announcements.push({ id: uid('ann'), propertyId: oakwood.id, title: 'Water shutoff Thursday 10am–1pm', body: 'The city is replacing a valve on Oakwood Drive. Water will be off Thursday from 10am to about 1pm. Sorry for the inconvenience!', createdAt: monthsAgo(0, 6) })

  return store
}

import type { Charge, Lease, Payment, RentTerm } from '@prisma/client'
import type { DB } from './db.js'

// ---------------------------------------------------------------------------
// Period helpers. A "period" is a billing month, formatted "YYYY-MM" (UTC).
// Lexicographic comparison of period strings matches chronological order.
// ---------------------------------------------------------------------------

export function periodOf(date: Date): string {
  const y = date.getUTCFullYear()
  const m = String(date.getUTCMonth() + 1).padStart(2, '0')
  return `${y}-${m}`
}

export function periodStart(period: string): Date {
  const [y, m] = period.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, 1))
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

// ---------------------------------------------------------------------------
// Rent terms. A rent change appends a new RentTerm; the term that governs a
// period is the one with the latest effectiveFrom whose month <= that period.
// Already-generated charges are never modified by a rent change.
// ---------------------------------------------------------------------------

export function rentAmountFor(terms: RentTerm[], period: string): number | null {
  let winner: RentTerm | null = null
  for (const t of terms) {
    if (periodOf(t.effectiveFrom) > period) continue
    if (!winner || t.effectiveFrom > winner.effectiveFrom) winner = t
  }
  return winner ? winner.amountCents : null
}

// ---------------------------------------------------------------------------
// Charge generation. Idempotent: one RENT charge per lease-period, generated
// from the lease's start month through the requested period (bounded by the
// lease's end month). No proration — partial months bill the full month.
// ---------------------------------------------------------------------------

export async function ensureRentCharges(db: DB, leaseId: string, throughPeriod: string): Promise<void> {
  const lease = await db.lease.findUnique({
    where: { id: leaseId },
    include: { rentTerms: true, charges: { where: { type: 'RENT' }, select: { period: true } } },
  })
  if (!lease) return

  let endPeriod = throughPeriod
  if (lease.endDate) {
    const leaseEnd = periodOf(lease.endDate)
    if (leaseEnd < endPeriod) endPeriod = leaseEnd
  }

  const existing = new Set(lease.charges.map((c) => c.period))
  const toCreate: { leaseId: string; type: string; amountCents: number; period: string; dueDate: Date; description: string }[] = []

  for (let p = periodOf(lease.startDate); p <= endPeriod; p = addPeriods(p, 1)) {
    if (existing.has(p)) continue
    const amount = rentAmountFor(lease.rentTerms, p)
    if (amount === null || amount <= 0) continue
    toCreate.push({
      leaseId,
      type: 'RENT',
      amountCents: amount,
      period: p,
      dueDate: dueDateFor(p, lease.dueDay),
      description: 'Monthly rent',
    })
  }

  if (toCreate.length > 0) await db.charge.createMany({ data: toCreate })
}

// ---------------------------------------------------------------------------
// Payment allocation. Payments are not earmarked to specific charges; they
// are allocated FIFO across charges ordered by due date. A charge's status
// falls out of how much of the payment pool reaches it.
// ---------------------------------------------------------------------------

export type AllocatedCharge = Charge & { paidCents: number; unpaidCents: number }

export function allocatePayments(charges: Charge[], payments: Payment[]): AllocatedCharge[] {
  const ordered = [...charges].sort(
    (a, b) => a.dueDate.getTime() - b.dueDate.getTime() || a.createdAt.getTime() - b.createdAt.getTime(),
  )
  let pool = payments.reduce((sum, p) => sum + p.amountCents, 0)
  return ordered.map((c) => {
    const paid = Math.min(pool, c.amountCents)
    pool -= paid
    return { ...c, paidCents: paid, unpaidCents: c.amountCents - paid }
  })
}

// ---------------------------------------------------------------------------
// Late fees. If a lease has a late-fee policy, a RENT charge that is still
// (partially) unpaid as of `asOf` and past dueDate + graceDays gets one
// LATE_FEE charge for its period. Recording an old payment before the fee is
// generated prevents it — fees are never applied retroactively to months
// that are currently paid up.
// ---------------------------------------------------------------------------

export async function applyLateFees(db: DB, leaseId: string, asOf: Date): Promise<void> {
  const lease = await db.lease.findUnique({
    where: { id: leaseId },
    include: { charges: true, payments: true },
  })
  if (!lease || lease.lateFeeCents <= 0) return

  // Decide "is this month's rent covered?" against RENT/OTHER charges only.
  // Including LATE_FEE rows in this allocation makes an unpaid fee shift the
  // FIFO pool, leaving every later month short by exactly the fee — which earns
  // another fee. One late month would then compound fees forever, even while
  // the tenant pays full rent on time every month afterwards.
  const nonFeeCharges = lease.charges.filter((c) => c.type !== 'LATE_FEE')
  const allocated = allocatePayments(nonFeeCharges, lease.payments)
  const feePeriods = new Set(lease.charges.filter((c) => c.type === 'LATE_FEE').map((c) => c.period))

  for (const c of allocated) {
    if (c.type !== 'RENT' || c.unpaidCents <= 0 || feePeriods.has(c.period)) continue
    const graceEnd = addDays(c.dueDate, lease.graceDays)
    if (asOf <= graceEnd) continue
    await db.charge.create({
      data: {
        leaseId,
        type: 'LATE_FEE',
        amountCents: lease.lateFeeCents,
        period: c.period,
        dueDate: graceEnd,
        description: `Late fee — ${c.period} rent unpaid past ${lease.graceDays}-day grace period`,
      },
    })
    feePeriods.add(c.period)
  }
}

// ---------------------------------------------------------------------------
// Lease finance snapshot: brings a lease's ledger up to date (charges through
// the requested period, late fees as of now) and returns allocated charges,
// payments and balance.
// ---------------------------------------------------------------------------

export type LeaseFinance = {
  charges: AllocatedCharge[]
  payments: Payment[]
  totalChargedCents: number
  totalPaidCents: number
  /** Net of ALL charges (including future months already generated) minus payments. */
  balanceCents: number
  /** What is actually owed today: unpaid portion of charges due on or before asOf.
   *  Future charges (e.g. next month generated by viewing a future rent roll) are excluded. */
  dueNowCents: number
}

export async function getLeaseFinance(db: DB, leaseId: string, opts?: { throughPeriod?: string; asOf?: Date }): Promise<LeaseFinance> {
  const asOf = opts?.asOf ?? new Date()
  const through = opts?.throughPeriod && opts.throughPeriod > periodOf(asOf) ? opts.throughPeriod : periodOf(asOf)

  await ensureRentCharges(db, leaseId, through)
  await applyLateFees(db, leaseId, asOf)

  const [charges, payments] = await Promise.all([
    db.charge.findMany({ where: { leaseId } }),
    db.payment.findMany({ where: { leaseId }, orderBy: { receivedDate: 'asc' } }),
  ])

  const allocated = allocatePayments(charges, payments)
  const totalChargedCents = charges.reduce((s, c) => s + c.amountCents, 0)
  const totalPaidCents = payments.reduce((s, p) => s + p.amountCents, 0)
  const dueNowCents = allocated.filter((c) => c.dueDate <= asOf).reduce((s, c) => s + c.unpaidCents, 0)
  return {
    charges: allocated,
    payments,
    totalChargedCents,
    totalPaidCents,
    balanceCents: totalChargedCents - totalPaidCents,
    dueNowCents,
  }
}

// ---------------------------------------------------------------------------
// Per-period status, used by the rent roll.
//   PAID     — the period's charges are fully covered
//   LATE     — unpaid amount remains and we are past due date + grace
//   PARTIAL  — some but not all covered, within grace
//   UNPAID   — nothing covered and past the due date, within grace
//   UPCOMING — due date is still in the future
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Rent roll: one row per lease that is active during `period`, with status.
// ---------------------------------------------------------------------------

export function isLeaseActiveIn(lease: Pick<Lease, 'status' | 'startDate' | 'endDate'>, period: string): boolean {
  if (periodOf(lease.startDate) > period) return false
  if (lease.endDate && periodOf(lease.endDate) < period) return false
  if (lease.status === 'ENDED' && lease.endDate === null) return false
  return true
}

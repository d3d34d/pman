import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { cents, dateString, idParam, periodString } from '../validation.js'
import { badRequest, notFound } from '../errors.js'
import { ownedLease, ownedUnit } from '../guards.js'
import {
  getLeaseFinance,
  isLeaseActiveIn,
  periodOf,
  periodStatusOf,
  rentAmountFor,
} from '../billing.js'
import type { DB } from '../db.js'

const createLeaseBody = z.object({
  unitId: z.string().min(1),
  tenantIds: z.array(z.string().min(1)).min(1),
  startDate: dateString,
  endDate: dateString.optional(),
  status: z.enum(['ACTIVE', 'MONTH_TO_MONTH']).default('ACTIVE'),
  rentCents: cents.refine((v) => v > 0, 'Rent must be greater than zero'),
  dueDay: z.number().int().min(1).max(28).default(1),
  depositCents: cents.default(0),
  graceDays: z.number().int().min(0).max(30).default(5),
  lateFeeCents: cents.default(0),
  notes: z.string().optional(),
})

const patchLeaseBody = z.object({
  status: z.enum(['ACTIVE', 'MONTH_TO_MONTH', 'ENDED']).optional(),
  endDate: dateString.nullable().optional(),
  dueDay: z.number().int().min(1).max(28).optional(),
  depositCents: cents.optional(),
  graceDays: z.number().int().min(0).max(30).optional(),
  lateFeeCents: cents.optional(),
  notes: z.string().optional(),
})

const rentChangeBody = z.object({
  amountCents: cents.refine((v) => v > 0, 'Rent must be greater than zero'),
  effectiveFrom: dateString,
  note: z.string().optional(),
})

const paymentBody = z.object({
  amountCents: cents.refine((v) => v > 0, 'Payment must be greater than zero'),
  receivedDate: dateString,
  method: z.enum(['CASH', 'CHECK', 'BANK_TRANSFER', 'ZELLE', 'OTHER']),
  reference: z.string().optional(),
  note: z.string().optional(),
})

const otherChargeBody = z.object({
  amountCents: cents.refine((v) => v > 0, 'Amount must be greater than zero'),
  dueDate: dateString,
  description: z.string().min(1),
})

function leaseSummary(lease: {
  id: string
  status: string
  startDate: Date
  endDate: Date | null
  dueDay: number
  unit: { id: string; label: string; property: { id: string; name: string } }
  tenants: { tenant: { id: string; fullName: string } }[]
  rentTerms: { id: string; amountCents: number; effectiveFrom: Date; note: string | null }[]
}) {
  return {
    id: lease.id,
    status: lease.status,
    startDate: lease.startDate,
    endDate: lease.endDate,
    dueDay: lease.dueDay,
    unit: { id: lease.unit.id, label: lease.unit.label },
    property: { id: lease.unit.property.id, name: lease.unit.property.name },
    tenants: lease.tenants.map((t) => t.tenant),
    currentRentCents: rentAmountFor(
      lease.rentTerms.map((t) => ({ ...t, leaseId: lease.id, createdAt: new Date() })),
      periodOf(new Date()),
    ),
  }
}

export default function leaseRoutes(db: DB) {
  return async function routes(app: FastifyInstance) {
    app.addHook('preHandler', app.requireManager)

    app.get('/leases', async (request) => {
      const query = z
        .object({ status: z.string().optional(), propertyId: z.string().optional() })
        .parse(request.query)
      const leases = await db.lease.findMany({
        where: {
          unit: { property: { managerId: request.user.sub, ...(query.propertyId ? { id: query.propertyId } : {}) } },
          ...(query.status ? { status: query.status } : {}),
        },
        include: {
          unit: { include: { property: true } },
          tenants: { include: { tenant: { select: { id: true, fullName: true } } } },
          rentTerms: true,
        },
        orderBy: { startDate: 'desc' },
      })
      return { leases: leases.map(leaseSummary) }
    })

    app.post('/leases', async (request, reply) => {
      const body = createLeaseBody.parse(request.body)
      const unit = await ownedUnit(db, body.unitId, request.user.sub)

      const conflicting = await db.lease.findFirst({
        where: { unitId: unit.id, status: { in: ['ACTIVE', 'MONTH_TO_MONTH'] } },
      })
      if (conflicting) throw badRequest('This unit already has an active lease. End it before creating a new one.')

      const tenants = await db.tenantProfile.findMany({
        where: { id: { in: body.tenantIds }, managerId: request.user.sub },
      })
      if (tenants.length !== body.tenantIds.length) throw notFound('One or more tenants')

      const lease = await db.lease.create({
        data: {
          unitId: unit.id,
          status: body.status,
          startDate: body.startDate,
          endDate: body.endDate ?? null,
          dueDay: body.dueDay,
          depositCents: body.depositCents,
          graceDays: body.graceDays,
          lateFeeCents: body.lateFeeCents,
          notes: body.notes,
          tenants: { create: body.tenantIds.map((tenantId) => ({ tenantId })) },
          rentTerms: { create: { amountCents: body.rentCents, effectiveFrom: body.startDate, note: 'Initial rent' } },
        },
      })
      reply.code(201)
      return { lease }
    })

    app.get('/leases/:id', async (request) => {
      const { id } = idParam.parse(request.params)
      const lease = await ownedLease(db, id, request.user.sub)
      const finance = await getLeaseFinance(db, id)
      const period = periodOf(new Date())
      return {
        lease: {
          ...leaseSummary(lease),
          depositCents: lease.depositCents,
          graceDays: lease.graceDays,
          lateFeeCents: lease.lateFeeCents,
          notes: lease.notes,
          rentTerms: lease.rentTerms,
        },
        finance: {
          balanceCents: finance.balanceCents,
          dueNowCents: finance.dueNowCents,
          totalChargedCents: finance.totalChargedCents,
          totalPaidCents: finance.totalPaidCents,
          currentPeriod: periodStatusOf(finance, period, lease.graceDays, new Date()),
        },
      }
    })

    app.patch('/leases/:id', async (request) => {
      const { id } = idParam.parse(request.params)
      await ownedLease(db, id, request.user.sub)
      const body = patchLeaseBody.parse(request.body)
      const lease = await db.lease.update({ where: { id }, data: body })
      return { lease }
    })

    app.post('/leases/:id/end', async (request) => {
      const { id } = idParam.parse(request.params)
      await ownedLease(db, id, request.user.sub)
      const body = z.object({ endDate: dateString }).parse(request.body)
      const lease = await db.lease.update({
        where: { id },
        data: { status: 'ENDED', endDate: body.endDate },
      })
      return { lease }
    })

    // Rent increase/decrease: appends a dated rent term. Applies to billing
    // periods from the effective month forward; existing charges are untouched.
    app.post('/leases/:id/rent-terms', async (request, reply) => {
      const { id } = idParam.parse(request.params)
      await ownedLease(db, id, request.user.sub)
      const body = rentChangeBody.parse(request.body)
      const term = await db.rentTerm.create({
        data: { leaseId: id, amountCents: body.amountCents, effectiveFrom: body.effectiveFrom, note: body.note },
      })
      reply.code(201)
      return { rentTerm: term }
    })

    app.get('/leases/:id/ledger', async (request) => {
      const { id } = idParam.parse(request.params)
      const lease = await ownedLease(db, id, request.user.sub)
      const finance = await getLeaseFinance(db, id)
      return {
        leaseId: id,
        graceDays: lease.graceDays,
        charges: finance.charges,
        payments: finance.payments,
        balanceCents: finance.balanceCents,
        dueNowCents: finance.dueNowCents,
        totalChargedCents: finance.totalChargedCents,
        totalPaidCents: finance.totalPaidCents,
      }
    })

    app.post('/leases/:id/payments', async (request, reply) => {
      const { id } = idParam.parse(request.params)
      await ownedLease(db, id, request.user.sub)
      const body = paymentBody.parse(request.body)
      const payment = await db.payment.create({ data: { leaseId: id, ...body } })
      reply.code(201)
      return { payment }
    })

    app.delete('/payments/:id', async (request) => {
      const { id } = idParam.parse(request.params)
      const payment = await db.payment.findFirst({
        where: { id, lease: { unit: { property: { managerId: request.user.sub } } } },
      })
      if (!payment) throw notFound('Payment')
      await db.payment.delete({ where: { id } })
      return { ok: true }
    })

    app.post('/leases/:id/charges', async (request, reply) => {
      const { id } = idParam.parse(request.params)
      await ownedLease(db, id, request.user.sub)
      const body = otherChargeBody.parse(request.body)
      const charge = await db.charge.create({
        data: {
          leaseId: id,
          type: 'OTHER',
          amountCents: body.amountCents,
          period: periodOf(body.dueDate),
          dueDate: body.dueDate,
          description: body.description,
        },
      })
      reply.code(201)
      return { charge }
    })

    // Rent roll: every lease active in the requested month with payment status.
    app.get('/rent-roll', async (request) => {
      const query = z.object({ period: periodString.optional() }).parse(request.query)
      const period = query.period ?? periodOf(new Date())
      const now = new Date()

      const leases = await db.lease.findMany({
        where: { unit: { property: { managerId: request.user.sub } } },
        include: {
          unit: { include: { property: true } },
          tenants: { include: { tenant: { select: { id: true, fullName: true } } } },
          rentTerms: true,
        },
      })

      const rows = []
      for (const lease of leases) {
        if (!isLeaseActiveIn(lease, period)) continue
        const finance = await getLeaseFinance(db, lease.id, { throughPeriod: period })
        const status = periodStatusOf(finance, period, lease.graceDays, now)
        rows.push({
          lease: leaseSummary(lease),
          period,
          status: status.status,
          dueCents: status.dueCents,
          paidCents: status.paidCents,
          balanceCents: finance.dueNowCents,
        })
      }

      rows.sort((a, b) => {
        const rank = (s: string) =>
          s === 'LATE' ? 0 : s === 'UNPAID' ? 1 : s === 'PARTIAL' ? 2 : s === 'UPCOMING' ? 3 : 4
        return rank(a.status) - rank(b.status) || a.lease.property.name.localeCompare(b.lease.property.name)
      })

      const totals = {
        dueCents: rows.reduce((s, r) => s + r.dueCents, 0),
        paidCents: rows.reduce((s, r) => s + r.paidCents, 0),
      }
      return { period, rows, totals }
    })
  }
}

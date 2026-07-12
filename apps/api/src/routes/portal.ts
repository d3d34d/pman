import type { FastifyInstance } from 'fastify'
import { randomBytes } from 'node:crypto'
import { z } from 'zod'
import { badRequest, notFound } from '../errors.js'
import { getLeaseFinance, dueDateFor, periodOf, periodStatusOf, rentAmountFor, addPeriods } from '../billing.js'
import { CardError, payRent, processAutopay, type PaymentProvider } from '../payments/index.js'
import { documentView, saveUpload, storeFile } from './documents.js'
import { notifyManagerNewSubmission, type Notifiers } from '../notify/index.js'
import type { FileSigner } from '../files.js'
import { cents, dateString } from '../validation.js'
import type { DB } from '../db.js'

export const SUBMISSION_METHODS = ['ZELLE', 'BANK_TRANSFER', 'CASH', 'CHECK', 'OTHER'] as const

// Tenant-facing portal. Everything is scoped to the TenantProfile linked to
// the logged-in tenant user; tenants can only ever see their own leases.

async function tenantProfileOf(db: DB, userId: string) {
  const profile = await db.tenantProfile.findUnique({ where: { userId } })
  if (!profile) throw notFound('Tenant profile')
  return profile
}

async function tenantLeases(db: DB, tenantId: string) {
  return db.lease.findMany({
    where: { tenants: { some: { tenantId } } },
    include: {
      unit: { include: { property: true } },
      rentTerms: true,
      tenants: { include: { tenant: { select: { fullName: true } } } },
    },
    orderBy: { startDate: 'desc' },
  })
}

/** The lease the portal acts on: the active one, else the most recent. */
async function currentLease(db: DB, tenantId: string) {
  const leases = await tenantLeases(db, tenantId)
  return leases.find((l) => l.status === 'ACTIVE' || l.status === 'MONTH_TO_MONTH') ?? leases[0] ?? null
}

/** A payment method must belong to the requesting tenant. */
async function ownedMethod(db: DB, id: string, tenantId: string) {
  const method = await db.paymentMethod.findFirst({ where: { id, tenantId } })
  if (!method) throw notFound('Payment method')
  return method
}

function publicMethod(m: { id: string; brand: string; last4: string; expMonth: number; expYear: number; isDefault: boolean }) {
  return { id: m.id, brand: m.brand, last4: m.last4, expMonth: m.expMonth, expYear: m.expYear, isDefault: m.isDefault }
}

const cardSchema = z.object({
  number: z.string().min(12),
  expMonth: z.number().int().min(1).max(12),
  expYear: z.number().int().min(2000).max(2100),
  cvc: z.string().min(3).max(4),
  makeDefault: z.boolean().optional(),
})

function daysUntil(date: Date, from: Date): number {
  return Math.ceil((date.getTime() - from.getTime()) / (24 * 60 * 60 * 1000))
}

function csvEscape(v: unknown): string {
  const s = String(v ?? '')
  return /[",\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s
}

export default function portalRoutes(db: DB, uploadsDir: string, provider: PaymentProvider, signer: FileSigner, notifiers: Notifiers) {
  return async function routes(app: FastifyInstance) {
    app.addHook('preHandler', app.requireTenant)

    // --- overview -------------------------------------------------------

    app.get('/portal/overview', async (request) => {
      const profile = await tenantProfileOf(db, request.user.sub)
      const active = await currentLease(db, profile.id)
      const now = new Date()
      const period = periodOf(now)

      if (!active) {
        return { lease: null, balanceCents: 0, currentPeriod: null, nextDueDate: null, autopay: null, renewal: null }
      }

      // Autopay is charged on demand. A scheduler would also call this.
      const autopayRun = await processAutopay(db, provider, active.id, now)

      const finance = await getLeaseFinance(db, active.id, { asOf: now })
      const current = periodStatusOf(finance, period, active.graceDays, now)
      const currentRent = rentAmountFor(active.rentTerms, period)
      const nextPeriod = current.status === 'PAID' ? addPeriods(period, 1) : period

      const autopay = await db.autopay.findUnique({
        where: { leaseId: active.id },
        include: { paymentMethod: true },
      })

      return {
        lease: {
          id: active.id,
          status: active.status,
          startDate: active.startDate,
          endDate: active.endDate,
          dueDay: active.dueDay,
          depositCents: active.depositCents,
          unitLabel: active.unit.label,
          propertyName: active.unit.property.name,
          propertyAddress: active.unit.property.address,
          coTenants: active.tenants.map((t) => t.tenant.fullName),
          currentRentCents: currentRent,
        },
        balanceCents: finance.dueNowCents,
        currentPeriod: current,
        nextDueDate: dueDateFor(nextPeriod, active.dueDay),
        autopay: autopay
          ? {
              enabled: autopay.enabled,
              lastRunPeriod: autopay.lastRunPeriod,
              method: publicMethod(autopay.paymentMethod),
            }
          : null,
        autopayRun: autopayRun.status === 'charged' || autopayRun.status === 'failed' ? autopayRun : null,
        renewal: active.endDate
          ? { endDate: active.endDate, daysRemaining: daysUntil(active.endDate, now), expiringSoon: daysUntil(active.endDate, now) <= 90 }
          : { endDate: null, daysRemaining: null, expiringSoon: false },
      }
    })

    // --- ledger & statements ---------------------------------------------

    app.get('/portal/ledger', async (request) => {
      const profile = await tenantProfileOf(db, request.user.sub)
      const active = await currentLease(db, profile.id)
      if (!active) return { charges: [], payments: [], balanceCents: 0, totalChargedCents: 0, totalPaidCents: 0 }
      const finance = await getLeaseFinance(db, active.id)
      return {
        charges: finance.charges,
        payments: finance.payments,
        balanceCents: finance.dueNowCents,
        totalChargedCents: finance.totalChargedCents,
        totalPaidCents: finance.totalPaidCents,
      }
    })

    app.get('/portal/statement.csv', async (request, reply) => {
      const profile = await tenantProfileOf(db, request.user.sub)
      const active = await currentLease(db, profile.id)
      reply.header('content-type', 'text/csv; charset=utf-8')
      reply.header('content-disposition', 'attachment; filename="statement.csv"')
      if (!active) return 'Date,Type,Description,Charge,Payment\n'

      const finance = await getLeaseFinance(db, active.id)
      const rows = [
        ...finance.charges.map((c) => ({
          date: c.dueDate,
          type: c.type,
          description: c.description ?? c.type,
          charge: (c.amountCents / 100).toFixed(2),
          payment: '',
        })),
        ...finance.payments.map((p) => ({
          date: p.receivedDate,
          type: 'PAYMENT',
          description: `${p.method}${p.reference ? ` — ${p.reference}` : ''}`,
          charge: '',
          payment: (p.amountCents / 100).toFixed(2),
        })),
      ].sort((a, b) => a.date.getTime() - b.date.getTime())

      const lines = [['Date', 'Type', 'Description', 'Charge', 'Payment']]
      for (const r of rows) {
        lines.push([r.date.toISOString().slice(0, 10), r.type, r.description, r.charge, r.payment])
      }
      return lines.map((l) => l.map(csvEscape).join(',')).join('\n') + '\n'
    })

    // --- payment methods --------------------------------------------------

    app.get('/portal/payment-methods', async (request) => {
      const profile = await tenantProfileOf(db, request.user.sub)
      const methods = await db.paymentMethod.findMany({
        where: { tenantId: profile.id },
        orderBy: [{ isDefault: 'desc' }, { createdAt: 'desc' }],
      })
      return { methods: methods.map(publicMethod) }
    })

    app.post('/portal/payment-methods', async (request, reply) => {
      const profile = await tenantProfileOf(db, request.user.sub)
      const body = cardSchema.parse(request.body)

      let tokenized
      try {
        tokenized = await provider.tokenizeCard(body)
      } catch (e) {
        if (e instanceof CardError) throw badRequest(e.message)
        throw e
      }

      const isFirst = (await db.paymentMethod.count({ where: { tenantId: profile.id } })) === 0
      const makeDefault = body.makeDefault || isFirst

      const method = await db.$transaction(async (tx) => {
        if (makeDefault) {
          await tx.paymentMethod.updateMany({ where: { tenantId: profile.id }, data: { isDefault: false } })
        }
        return tx.paymentMethod.create({
          data: {
            tenantId: profile.id,
            provider: provider.name,
            providerToken: tokenized.token,
            brand: tokenized.brand,
            last4: tokenized.last4,
            expMonth: tokenized.expMonth,
            expYear: tokenized.expYear,
            isDefault: makeDefault,
          },
        })
      })

      reply.code(201)
      return { method: publicMethod(method) }
    })

    app.post('/portal/payment-methods/:id/default', async (request) => {
      const profile = await tenantProfileOf(db, request.user.sub)
      const params = z.object({ id: z.string().min(1) }).parse(request.params)
      await ownedMethod(db, params.id, profile.id)
      await db.$transaction([
        db.paymentMethod.updateMany({ where: { tenantId: profile.id }, data: { isDefault: false } }),
        db.paymentMethod.update({ where: { id: params.id }, data: { isDefault: true } }),
      ])
      return { ok: true }
    })

    app.delete('/portal/payment-methods/:id', async (request) => {
      const profile = await tenantProfileOf(db, request.user.sub)
      const params = z.object({ id: z.string().min(1) }).parse(request.params)
      const method = await ownedMethod(db, params.id, profile.id)

      const autopay = await db.autopay.findFirst({ where: { paymentMethodId: method.id, enabled: true } })
      if (autopay) throw badRequest('This card is used for autopay. Turn autopay off or switch cards first.')

      await db.paymentMethod.delete({ where: { id: method.id } })

      // Never leave the wallet without a default.
      if (method.isDefault) {
        const next = await db.paymentMethod.findFirst({
          where: { tenantId: profile.id },
          orderBy: { createdAt: 'desc' },
        })
        if (next) await db.paymentMethod.update({ where: { id: next.id }, data: { isDefault: true } })
      }
      return { ok: true }
    })

    // --- paying rent -------------------------------------------------------

    app.post('/portal/pay', async (request, reply) => {
      const profile = await tenantProfileOf(db, request.user.sub)
      const body = z
        .object({
          amountCents: cents.refine((v) => v > 0, 'Amount must be greater than zero'),
          paymentMethodId: z.string().min(1),
          idempotencyKey: z.string().min(8).max(200),
        })
        .parse(request.body)

      const active = await currentLease(db, profile.id)
      if (!active) throw badRequest('You do not have an active lease.')
      await ownedMethod(db, body.paymentMethodId, profile.id)

      const result = await payRent(db, provider, {
        leaseId: active.id,
        paymentMethodId: body.paymentMethodId,
        amountCents: body.amountCents,
        idempotencyKey: body.idempotencyKey,
        source: 'PORTAL',
      })

      if (!result.ok) {
        reply.code(402)
        return { error: result.message, code: result.code }
      }

      const finance = await getLeaseFinance(db, active.id)
      return {
        paymentId: result.paymentId,
        receiptNumber: result.receiptNumber,
        amountCents: result.amountCents,
        replayed: result.replayed,
        balanceCents: finance.dueNowCents,
      }
    })

    // --- autopay -----------------------------------------------------------

    app.get('/portal/autopay', async (request) => {
      const profile = await tenantProfileOf(db, request.user.sub)
      const active = await currentLease(db, profile.id)
      if (!active) return { autopay: null }
      const autopay = await db.autopay.findUnique({ where: { leaseId: active.id }, include: { paymentMethod: true } })
      return {
        autopay: autopay
          ? { enabled: autopay.enabled, lastRunPeriod: autopay.lastRunPeriod, method: publicMethod(autopay.paymentMethod) }
          : null,
        dueDay: active.dueDay,
      }
    })

    app.put('/portal/autopay', async (request) => {
      const profile = await tenantProfileOf(db, request.user.sub)
      const body = z.object({ enabled: z.boolean(), paymentMethodId: z.string().min(1).optional() }).parse(request.body)
      const active = await currentLease(db, profile.id)
      if (!active) throw badRequest('You do not have an active lease.')

      if (!body.enabled) {
        await db.autopay.deleteMany({ where: { leaseId: active.id } })
        return { autopay: null }
      }

      const methodId =
        body.paymentMethodId ??
        (await db.paymentMethod.findFirst({ where: { tenantId: profile.id, isDefault: true } }))?.id
      if (!methodId) throw badRequest('Add a card before turning on autopay.')
      await ownedMethod(db, methodId, profile.id)

      const autopay = await db.autopay.upsert({
        where: { leaseId: active.id },
        create: { leaseId: active.id, tenantId: profile.id, paymentMethodId: methodId, enabled: true },
        update: { paymentMethodId: methodId, enabled: true },
        include: { paymentMethod: true },
      })
      return { autopay: { enabled: autopay.enabled, lastRunPeriod: autopay.lastRunPeriod, method: publicMethod(autopay.paymentMethod) } }
    })

    // --- receipts ----------------------------------------------------------

    app.get('/portal/receipts', async (request) => {
      const profile = await tenantProfileOf(db, request.user.sub)
      const active = await currentLease(db, profile.id)
      if (!active) return { receipts: [] }
      const payments = await db.payment.findMany({
        where: { leaseId: active.id },
        include: { paymentMethod: true },
        orderBy: { receivedDate: 'desc' },
      })
      return {
        receipts: payments.map((p) => ({
          id: p.id,
          receiptNumber: p.receiptNumber,
          amountCents: p.amountCents,
          receivedDate: p.receivedDate,
          method: p.method,
          source: p.source,
          reference: p.reference,
        })),
      }
    })

    app.get('/portal/receipts/:id', async (request) => {
      const profile = await tenantProfileOf(db, request.user.sub)
      const params = z.object({ id: z.string().min(1) }).parse(request.params)
      const payment = await db.payment.findFirst({
        where: { id: params.id, lease: { tenants: { some: { tenantId: profile.id } } } },
        include: {
          paymentMethod: true,
          lease: { include: { unit: { include: { property: true } } } },
        },
      })
      if (!payment) throw notFound('Receipt')
      return {
        receipt: {
          id: payment.id,
          receiptNumber: payment.receiptNumber,
          amountCents: payment.amountCents,
          receivedDate: payment.receivedDate,
          method: payment.method,
          source: payment.source,
          reference: payment.reference,
          providerRef: payment.providerRef,
          card: payment.paymentMethod ? publicMethod(payment.paymentMethod) : null,
          tenantName: profile.fullName,
          propertyName: payment.lease.unit.property.name,
          propertyAddress: payment.lease.unit.property.address,
          unitLabel: payment.lease.unit.label,
        },
      }
    })

    // --- payment submissions (declare a payment for manager review) --------

    app.get('/portal/payment-submissions', async (request) => {
      const profile = await tenantProfileOf(db, request.user.sub)
      const subs = await db.paymentSubmission.findMany({
        where: { tenantId: profile.id },
        orderBy: { createdAt: 'desc' },
      })
      return {
        submissions: subs.map((s) => ({
          id: s.id,
          amountCents: s.amountCents,
          method: s.method,
          paidOn: s.paidOn,
          reference: s.reference,
          note: s.note,
          status: s.status,
          reviewNote: s.reviewNote,
          reviewedAt: s.reviewedAt,
          createdAt: s.createdAt,
          proofUrl: s.proofPath ? signer.url(s.proofPath) : null,
        })),
      }
    })

    app.post('/portal/payment-submissions', async (request, reply) => {
      const profile = await tenantProfileOf(db, request.user.sub)
      const body = z
        .object({
          amountCents: cents.refine((v) => v > 0, 'Amount must be greater than zero'),
          method: z.enum(SUBMISSION_METHODS),
          paidOn: dateString,
          reference: z.string().max(200).optional(),
          note: z.string().max(2000).optional(),
        })
        .parse(request.body)
      const active = await currentLease(db, profile.id)
      if (!active) throw badRequest('You do not have an active lease.')

      const submission = await db.paymentSubmission.create({
        data: {
          leaseId: active.id,
          tenantId: profile.id,
          amountCents: body.amountCents,
          method: body.method,
          paidOn: body.paidOn,
          reference: body.reference,
          note: body.note,
        },
      })

      // Alert the manager (push + email), but don't block or fail the tenant's
      // request on a notification hiccup.
      notifyManagerNewSubmission(db, notifiers, submission.id).catch((e) =>
        app.log.error({ err: e }, 'notifyManagerNewSubmission failed'),
      )

      reply.code(201)
      return { submission: { id: submission.id, status: submission.status } }
    })

    // Attach the screenshot. Separate call so the mobile flow mirrors
    // maintenance photos (create, then upload).
    app.post('/portal/payment-submissions/:id/proof', async (request, reply) => {
      const profile = await tenantProfileOf(db, request.user.sub)
      const params = z.object({ id: z.string().min(1) }).parse(request.params)
      const submission = await db.paymentSubmission.findFirst({
        where: { id: params.id, tenantId: profile.id },
      })
      if (!submission) throw notFound('Payment submission')
      if (submission.status !== 'PENDING') throw badRequest('This submission has already been reviewed.')

      const file = await request.file()
      if (!file) throw badRequest('Expected a multipart file upload')
      const stored = await storeFile(uploadsDir, file)
      await db.paymentSubmission.update({
        where: { id: submission.id },
        data: { proofPath: stored.storedName, proofMime: stored.mimeType },
      })
      reply.code(201)
      return { ok: true }
    })

    // --- maintenance -------------------------------------------------------

    app.get('/portal/maintenance', async (request) => {
      const profile = await tenantProfileOf(db, request.user.sub)
      const requests = await db.maintenanceRequest.findMany({
        where: { createdById: request.user.sub },
        include: { unit: { include: { property: { select: { name: true } } } } },
        orderBy: { createdAt: 'desc' },
      })
      return { requests, tenantId: profile.id }
    })

    app.post('/portal/maintenance', async (request, reply) => {
      const profile = await tenantProfileOf(db, request.user.sub)
      const body = z
        .object({
          title: z.string().min(1),
          description: z.string().min(1),
          priority: z.enum(['LOW', 'NORMAL', 'HIGH', 'URGENT']).default('NORMAL'),
        })
        .parse(request.body)
      const active = await currentLease(db, profile.id)
      if (!active) throw badRequest('No active lease found for your account')
      const created = await db.maintenanceRequest.create({
        data: { unitId: active.unitId, leaseId: active.id, createdById: request.user.sub, ...body },
      })
      reply.code(201)
      return { request: created }
    })

    app.post('/portal/maintenance/:id/photos', async (request, reply) => {
      const params = z.object({ id: z.string().min(1) }).parse(request.params)
      const maintenance = await db.maintenanceRequest.findFirst({
        where: { id: params.id, createdById: request.user.sub },
        include: { unit: { include: { property: true } } },
      })
      if (!maintenance) throw notFound('Maintenance request')
      const file = await request.file()
      if (!file) throw badRequest('Expected a multipart file upload')
      const document = await saveUpload(db, uploadsDir, file, 'MAINTENANCE', maintenance.id, maintenance.unit.property.managerId)
      reply.code(201)
      return { document }
    })

    // --- lease documents (read-only) ---------------------------------------

    app.get('/portal/documents', async (request) => {
      const profile = await tenantProfileOf(db, request.user.sub)
      const active = await currentLease(db, profile.id)
      if (!active) return { documents: [] }
      const documents = await db.document.findMany({
        where: {
          OR: [
            { ownerType: 'LEASE', ownerId: active.id },
            { ownerType: 'TENANT', ownerId: profile.id },
          ],
        },
        orderBy: { uploadedAt: 'desc' },
      })
      return { documents: documents.map((d) => documentView(d, signer)) }
    })

    // --- announcements -----------------------------------------------------

    app.get('/portal/announcements', async (request) => {
      const profile = await tenantProfileOf(db, request.user.sub)
      const leases = await tenantLeases(db, profile.id)
      const propertyIds = [...new Set(leases.map((l) => l.unit.property.id))]
      const announcements = await db.announcement.findMany({
        where: { propertyId: { in: propertyIds } },
        include: { property: { select: { name: true } } },
        orderBy: { createdAt: 'desc' },
      })
      return { announcements }
    })

    // --- messages ----------------------------------------------------------

    app.get('/portal/messages', async (request) => {
      const profile = await tenantProfileOf(db, request.user.sub)
      const active = await currentLease(db, profile.id)
      if (!active) return { messages: [] }

      // Mark the manager's messages as read now that the tenant is looking.
      await db.message.updateMany({
        where: { leaseId: active.id, senderId: { not: request.user.sub }, readAt: null },
        data: { readAt: new Date() },
      })

      const messages = await db.message.findMany({
        where: { leaseId: active.id },
        include: { sender: { select: { id: true, name: true, role: true } } },
        orderBy: { createdAt: 'asc' },
      })
      return { messages, meId: request.user.sub }
    })

    app.post('/portal/messages', async (request, reply) => {
      const profile = await tenantProfileOf(db, request.user.sub)
      const body = z.object({ body: z.string().min(1).max(4000) }).parse(request.body)
      const active = await currentLease(db, profile.id)
      if (!active) throw badRequest('You do not have an active lease.')
      const message = await db.message.create({
        data: { leaseId: active.id, senderId: request.user.sub, body: body.body },
      })
      reply.code(201)
      return { message }
    })
  }
}

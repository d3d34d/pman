import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { notFound } from '../errors.js'
import { receiptNumber } from '../payments/index.js'
import { notifyTenantSubmissionReviewed, type Notifiers } from '../notify/index.js'
import { idParam } from '../validation.js'
import type { FileSigner } from '../files.js'
import type { DB } from '../db.js'

// Manager review of tenant-declared payments. Approving one writes a real
// Payment into the ledger; rejecting records why.

async function ownedSubmission(db: DB, id: string, managerId: string) {
  const submission = await db.paymentSubmission.findFirst({
    where: { id, lease: { unit: { property: { managerId } } } },
  })
  if (!submission) throw notFound('Payment submission')
  return submission
}

export default function submissionRoutes(db: DB, signer: FileSigner, notifiers: Notifiers) {
  return async function routes(app: FastifyInstance) {
    app.addHook('preHandler', app.requireManager)

    app.get('/payment-submissions', async (request) => {
      const query = z.object({ status: z.string().optional() }).parse(request.query)
      const subs = await db.paymentSubmission.findMany({
        where: {
          lease: { unit: { property: { managerId: request.user.sub } } },
          ...(query.status ? { status: query.status } : {}),
        },
        include: {
          tenant: { select: { fullName: true } },
          lease: { include: { unit: { include: { property: { select: { name: true } } } } } },
        },
        orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
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
          tenantName: s.tenant.fullName,
          propertyName: s.lease.unit.property.name,
          unitLabel: s.lease.unit.label,
          leaseId: s.leaseId,
          proofUrl: s.proofPath ? signer.url(s.proofPath) : null,
        })),
      }
    })

    app.post('/payment-submissions/:id/approve', async (request) => {
      const { id } = idParam.parse(request.params)
      const submission = await ownedSubmission(db, id, request.user.sub)
      if (submission.status !== 'PENDING') {
        return { alreadyReviewed: true, status: submission.status }
      }

      // Claim the submission FIRST with a guarded update. Without this, two
      // concurrent approvals (two devices, or a retry) both pass the status
      // check above and each write a Payment — crediting the tenant twice, with
      // the second row orphaned and invisible to this screen.
      const claimed = await db.paymentSubmission.updateMany({
        where: { id: submission.id, status: 'PENDING' },
        data: { status: 'APPROVED', reviewedAt: new Date() },
      })
      if (claimed.count === 0) {
        const current = await db.paymentSubmission.findUnique({ where: { id: submission.id } })
        return { alreadyReviewed: true, status: current?.status ?? 'APPROVED' }
      }

      // Create the ledger payment and link it, retrying on the rare receipt clash.
      const payment = await (async () => {
        for (let attempt = 0; ; attempt++) {
          try {
            return await db.payment.create({
              data: {
                leaseId: submission.leaseId,
                amountCents: submission.amountCents,
                receivedDate: submission.paidOn,
                method: submission.method,
                source: 'MANUAL',
                receiptNumber: receiptNumber(),
                reference: submission.reference ?? `${submission.method} (tenant-submitted)`,
                note: submission.note,
              },
            })
          } catch (e) {
            if ((e as { code?: string }).code === 'P2002' && attempt < 5) continue
            throw e
          }
        }
      })()

      await db.paymentSubmission.update({
        where: { id: submission.id },
        data: { paymentId: payment.id },
      })
      notifyTenantSubmissionReviewed(db, notifiers, submission.id).catch((e) =>
        app.log.error({ err: e }, 'notifyTenantSubmissionReviewed failed'),
      )
      return { status: 'APPROVED', paymentId: payment.id, receiptNumber: payment.receiptNumber }
    })

    app.post('/payment-submissions/:id/reject', async (request) => {
      const { id } = idParam.parse(request.params)
      const submission = await ownedSubmission(db, id, request.user.sub)
      if (submission.status !== 'PENDING') {
        return { alreadyReviewed: true, status: submission.status }
      }
      const body = z.object({ reason: z.string().max(500).optional() }).parse(request.body)
      await db.paymentSubmission.update({
        where: { id: submission.id },
        data: { status: 'REJECTED', reviewedAt: new Date(), reviewNote: body.reason ?? null },
      })
      notifyTenantSubmissionReviewed(db, notifiers, submission.id).catch((e) =>
        app.log.error({ err: e }, 'notifyTenantSubmissionReviewed failed'),
      )
      return { status: 'REJECTED' }
    })
  }
}

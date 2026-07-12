import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { idParam } from '../validation.js'
import { ownedLease } from '../guards.js'
import { processAutopay, type PaymentProvider } from '../payments/index.js'
import type { DB } from '../db.js'

export default function messageRoutes(db: DB, provider: PaymentProvider) {
  return async function routes(app: FastifyInstance) {
    app.addHook('preHandler', app.requireManager)

    /** Inbox: one thread per lease that has any messages, newest activity first. */
    app.get('/messages', async (request) => {
      const messages = await db.message.findMany({
        where: { lease: { unit: { property: { managerId: request.user.sub } } } },
        include: {
          sender: { select: { id: true, name: true, role: true } },
          lease: {
            include: {
              unit: { include: { property: { select: { name: true } } } },
              tenants: { include: { tenant: { select: { fullName: true } } } },
            },
          },
        },
        orderBy: { createdAt: 'desc' },
      })

      const threads = new Map<string, {
        leaseId: string
        propertyName: string
        unitLabel: string
        tenants: string
        lastMessage: string
        lastAt: Date
        unread: number
      }>()

      for (const m of messages) {
        const existing = threads.get(m.leaseId)
        if (!existing) {
          threads.set(m.leaseId, {
            leaseId: m.leaseId,
            propertyName: m.lease.unit.property.name,
            unitLabel: m.lease.unit.label,
            tenants: m.lease.tenants.map((t) => t.tenant.fullName).join(', '),
            lastMessage: m.body,
            lastAt: m.createdAt,
            unread: m.sender.role === 'TENANT' && !m.readAt ? 1 : 0,
          })
        } else if (m.sender.role === 'TENANT' && !m.readAt) {
          existing.unread += 1
        }
      }

      return { threads: [...threads.values()] }
    })

    app.get('/leases/:id/messages', async (request) => {
      const { id } = idParam.parse(request.params)
      await ownedLease(db, id, request.user.sub)

      await db.message.updateMany({
        where: { leaseId: id, senderId: { not: request.user.sub }, readAt: null },
        data: { readAt: new Date() },
      })

      const messages = await db.message.findMany({
        where: { leaseId: id },
        include: { sender: { select: { id: true, name: true, role: true } } },
        orderBy: { createdAt: 'asc' },
      })
      return { messages, meId: request.user.sub }
    })

    app.post('/leases/:id/messages', async (request, reply) => {
      const { id } = idParam.parse(request.params)
      await ownedLease(db, id, request.user.sub)
      const body = z.object({ body: z.string().min(1).max(4000) }).parse(request.body)
      const message = await db.message.create({
        data: { leaseId: id, senderId: request.user.sub, body: body.body },
      })
      reply.code(201)
      return { message }
    })

    /**
     * Sweep autopay across every lease this manager owns. Safe to call
     * repeatedly — each lease is charged at most once per billing period.
     * In production this is what a nightly scheduler would hit.
     */
    app.post('/autopay/run', async (request) => {
      const leases = await db.lease.findMany({
        where: {
          unit: { property: { managerId: request.user.sub } },
          autopay: { enabled: true },
          status: { in: ['ACTIVE', 'MONTH_TO_MONTH'] },
        },
        select: { id: true },
      })
      const now = new Date()
      const results = []
      for (const lease of leases) {
        results.push({ leaseId: lease.id, ...(await processAutopay(db, provider, lease.id, now)) })
      }
      return {
        processed: results.length,
        charged: results.filter((r) => r.status === 'charged').length,
        failed: results.filter((r) => r.status === 'failed').length,
        results,
      }
    })
  }
}

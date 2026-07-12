import type { FastifyInstance } from 'fastify'
import { randomBytes } from 'node:crypto'
import { z } from 'zod'
import { idParam } from '../validation.js'
import { ownedTenant } from '../guards.js'
import type { DB } from '../db.js'

const tenantBody = z.object({
  fullName: z.string().min(1),
  email: z.string().email().optional().or(z.literal('')).transform((v) => v || undefined),
  phone: z.string().optional(),
  emergencyName: z.string().optional(),
  emergencyPhone: z.string().optional(),
  status: z.enum(['ACTIVE', 'FORMER']).optional(),
})

export default function tenantRoutes(db: DB) {
  return async function routes(app: FastifyInstance) {
    app.addHook('preHandler', app.requireManager)

    app.get('/tenants', async (request) => {
      const query = z.object({ status: z.enum(['ACTIVE', 'FORMER']).optional() }).parse(request.query)
      const tenants = await db.tenantProfile.findMany({
        where: { managerId: request.user.sub, ...(query.status ? { status: query.status } : {}) },
        include: {
          leases: {
            include: { lease: { include: { unit: { include: { property: true } } } } },
          },
          user: { select: { id: true } },
        },
        orderBy: { fullName: 'asc' },
      })
      return {
        tenants: tenants.map((t) => {
          const activeLease = t.leases
            .map((lt) => lt.lease)
            .find((l) => l.status === 'ACTIVE' || l.status === 'MONTH_TO_MONTH')
          return {
            id: t.id,
            fullName: t.fullName,
            email: t.email,
            phone: t.phone,
            status: t.status,
            hasPortalAccount: t.user !== null,
            activeLease: activeLease
              ? {
                  id: activeLease.id,
                  unitLabel: activeLease.unit.label,
                  propertyName: activeLease.unit.property.name,
                }
              : null,
          }
        }),
      }
    })

    app.post('/tenants', async (request, reply) => {
      const body = tenantBody.parse(request.body)
      const tenant = await db.tenantProfile.create({
        data: { ...body, managerId: request.user.sub },
      })
      reply.code(201)
      return { tenant }
    })

    app.get('/tenants/:id', async (request) => {
      const { id } = idParam.parse(request.params)
      await ownedTenant(db, id, request.user.sub)
      const tenant = await db.tenantProfile.findUnique({
        where: { id },
        include: {
          user: { select: { id: true, email: true } },
          leases: {
            include: {
              lease: {
                include: {
                  unit: { include: { property: true } },
                  rentTerms: { orderBy: { effectiveFrom: 'asc' } },
                },
              },
            },
          },
          notes: { orderBy: { createdAt: 'desc' }, include: { author: { select: { name: true } } } },
          invites: { where: { usedAt: null, expiresAt: { gt: new Date() } }, orderBy: { createdAt: 'desc' } },
        },
      })
      return { tenant }
    })

    app.patch('/tenants/:id', async (request) => {
      const { id } = idParam.parse(request.params)
      await ownedTenant(db, id, request.user.sub)
      const body = tenantBody.partial().parse(request.body)
      const tenant = await db.tenantProfile.update({ where: { id }, data: body })
      return { tenant }
    })

    // "Remove tenant" archives the profile — lease and payment history is kept.
    app.post('/tenants/:id/archive', async (request) => {
      const { id } = idParam.parse(request.params)
      await ownedTenant(db, id, request.user.sub)
      const tenant = await db.tenantProfile.update({ where: { id }, data: { status: 'FORMER' } })
      return { tenant }
    })

    app.post('/tenants/:id/notes', async (request, reply) => {
      const { id } = idParam.parse(request.params)
      await ownedTenant(db, id, request.user.sub)
      const body = z.object({ body: z.string().min(1) }).parse(request.body)
      const note = await db.note.create({
        data: { tenantId: id, authorId: request.user.sub, body: body.body },
      })
      reply.code(201)
      return { note }
    })

    app.post('/tenants/:id/invite', async (request, reply) => {
      const { id } = idParam.parse(request.params)
      const tenant = await ownedTenant(db, id, request.user.sub)
      if (tenant.userId) {
        reply.code(400)
        return { error: 'This tenant already has a portal account' }
      }
      const code = randomBytes(4).toString('hex').toUpperCase()
      const invite = await db.invite.create({
        data: {
          code,
          tenantId: id,
          expiresAt: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000),
        },
      })
      reply.code(201)
      return { invite }
    })
  }
}

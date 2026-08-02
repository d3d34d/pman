import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { cents, idParam } from '../validation.js'
import { ownedMaintenance, ownedUnit } from '../guards.js'
import type { DB } from '../db.js'

const createBody = z.object({
  unitId: z.string().min(1),
  leaseId: z.string().optional(),
  title: z.string().min(1),
  description: z.string().min(1),
  priority: z.enum(['LOW', 'NORMAL', 'HIGH', 'URGENT']).default('NORMAL'),
})

const patchBody = z.object({
  status: z.enum(['OPEN', 'IN_PROGRESS', 'RESOLVED']).optional(),
  priority: z.enum(['LOW', 'NORMAL', 'HIGH', 'URGENT']).optional(),
  vendorName: z.string().optional(),
  costCents: cents.optional(),
})

export default function maintenanceRoutes(db: DB) {
  return async function routes(app: FastifyInstance) {
    app.addHook('preHandler', app.requireManager)

    app.get('/maintenance', async (request) => {
      const query = z.object({ status: z.string().optional() }).parse(request.query)
      const requests = await db.maintenanceRequest.findMany({
        where: {
          unit: { property: { managerId: request.user.sub } },
          ...(query.status ? { status: query.status } : {}),
        },
        include: {
          unit: { include: { property: { select: { id: true, name: true } } } },
          createdBy: { select: { name: true, role: true } },
        },
        orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
      })
      return { requests }
    })

    app.post('/maintenance', async (request, reply) => {
      const body = createBody.parse(request.body)
      await ownedUnit(db, body.unitId, request.user.sub)
      const created = await db.maintenanceRequest.create({
        data: { ...body, createdById: request.user.sub },
      })
      reply.code(201)
      return { request: created }
    })

    app.patch('/maintenance/:id', async (request) => {
      const { id } = idParam.parse(request.params)
      await ownedMaintenance(db, id, request.user.sub)
      const body = patchBody.parse(request.body)
      const updated = await db.maintenanceRequest.update({
        where: { id },
        data: {
          ...body,
          ...(body.status === 'RESOLVED' ? { resolvedAt: new Date() } : {}),
        },
      })
      return { request: updated }
    })
  }
}

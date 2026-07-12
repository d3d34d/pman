import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { idParam } from '../validation.js'
import { ownedProperty } from '../guards.js'
import type { DB } from '../db.js'

export default function announcementRoutes(db: DB) {
  return async function routes(app: FastifyInstance) {
    app.addHook('preHandler', app.requireManager)

    app.get('/announcements', async (request) => {
      const announcements = await db.announcement.findMany({
        where: { property: { managerId: request.user.sub } },
        include: { property: { select: { id: true, name: true } } },
        orderBy: { createdAt: 'desc' },
      })
      return { announcements }
    })

    app.post('/properties/:id/announcements', async (request, reply) => {
      const { id } = idParam.parse(request.params)
      await ownedProperty(db, id, request.user.sub)
      const body = z.object({ title: z.string().min(1), body: z.string().min(1) }).parse(request.body)
      const announcement = await db.announcement.create({
        data: { propertyId: id, title: body.title, body: body.body },
      })
      reply.code(201)
      return { announcement }
    })

    app.delete('/announcements/:id', async (request, reply) => {
      const { id } = idParam.parse(request.params)
      const announcement = await db.announcement.findFirst({
        where: { id, property: { managerId: request.user.sub } },
      })
      if (!announcement) {
        reply.code(404)
        return { error: 'Announcement not found' }
      }
      await db.announcement.delete({ where: { id } })
      return { ok: true }
    })
  }
}

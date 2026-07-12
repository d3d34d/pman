import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import type { DB } from '../db.js'

// The in-app notification center: a per-user history with unread tracking.

export default function notificationRoutes(db: DB) {
  return async function routes(app: FastifyInstance) {
    app.addHook('preHandler', app.authenticate)

    app.get('/me/notifications', async (request) => {
      const [notifications, unreadCount] = await Promise.all([
        db.notification.findMany({
          where: { userId: request.user.sub },
          orderBy: { createdAt: 'desc' },
          take: 100,
        }),
        db.notification.count({ where: { userId: request.user.sub, readAt: null } }),
      ])
      return {
        unreadCount,
        notifications: notifications.map((n) => ({
          id: n.id,
          type: n.type,
          title: n.title,
          body: n.body,
          data: n.data ? (JSON.parse(n.data) as Record<string, unknown>) : null,
          read: n.readAt !== null,
          createdAt: n.createdAt,
        })),
      }
    })

    app.get('/me/notifications/unread-count', async (request) => {
      const unreadCount = await db.notification.count({ where: { userId: request.user.sub, readAt: null } })
      return { unreadCount }
    })

    app.post('/me/notifications/read-all', async (request) => {
      await db.notification.updateMany({
        where: { userId: request.user.sub, readAt: null },
        data: { readAt: new Date() },
      })
      return { ok: true }
    })

    app.post('/me/notifications/:id/read', async (request) => {
      const params = z.object({ id: z.string().min(1) }).parse(request.params)
      await db.notification.updateMany({
        where: { id: params.id, userId: request.user.sub, readAt: null },
        data: { readAt: new Date() },
      })
      return { ok: true }
    })
  }
}

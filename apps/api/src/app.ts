import Fastify, { type FastifyInstance } from 'fastify'
import cors from '@fastify/cors'
import multipart from '@fastify/multipart'
import rateLimit from '@fastify/rate-limit'
import path from 'node:path'
import { ZodError } from 'zod'
import { registerAuth } from './auth.js'
import { AppError } from './errors.js'
import { createFileSigner, registerFileRoutes, type FileSigner } from './files.js'
import type { DB } from './db.js'
import authRoutes from './routes/auth.js'
import propertyRoutes from './routes/properties.js'
import tenantRoutes from './routes/tenants.js'
import leaseRoutes from './routes/leases.js'
import dashboardRoutes from './routes/dashboard.js'
import maintenanceRoutes from './routes/maintenance.js'
import expenseRoutes from './routes/expenses.js'
import reportRoutes from './routes/reports.js'
import documentRoutes from './routes/documents.js'
import announcementRoutes from './routes/announcements.js'
import portalRoutes from './routes/portal.js'
import messageRoutes from './routes/messages.js'
import submissionRoutes from './routes/submissions.js'
import notificationRoutes from './routes/notifications.js'
import { createPaymentProvider, type PaymentProvider } from './payments/index.js'
import { createNotifiers, type Notifiers } from './notify/index.js'

export type AppOptions = {
  db: DB
  jwtSecret: string
  uploadsDir?: string
  logger?: boolean
  paymentProvider?: PaymentProvider
  notifiers?: Notifiers
  /** Disable rate limiting in tests (avoids cross-test 429s). */
  rateLimit?: boolean
}

export async function buildApp(opts: AppOptions): Promise<FastifyInstance> {
  const app = Fastify({ logger: opts.logger ?? false, bodyLimit: 1_000_000 })
  const uploadsDir = opts.uploadsDir ?? path.resolve(process.cwd(), 'uploads')
  const payments = opts.paymentProvider ?? createPaymentProvider()
  const notifiers = opts.notifiers ?? createNotifiers()

  await app.register(cors, { origin: true })
  await app.register(multipart, { limits: { fileSize: 20 * 1024 * 1024, files: 1 } })
  if (opts.rateLimit !== false) {
    await app.register(rateLimit, { max: 300, timeWindow: '1 minute' })
  }

  await registerAuth(app, opts.jwtSecret, opts.db)
  const fileSigner: FileSigner = createFileSigner(app)
  await registerFileRoutes(app, uploadsDir)

  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof ZodError) {
      return reply.code(400).send({
        error: error.issues.map((i) => `${i.path.join('.') || 'body'}: ${i.message}`).join('; '),
      })
    }
    if (error instanceof AppError) {
      return reply.code(error.statusCode).send({ error: error.message })
    }
    const statusCode = (error as { statusCode?: number }).statusCode
    if (statusCode === 429) {
      return reply.code(429).send({ error: 'Too many requests. Please slow down and try again shortly.' })
    }
    const clientError = typeof statusCode === 'number' && statusCode >= 400 && statusCode < 500
    if (!clientError) app.log.error(error)
    return reply.code(clientError ? statusCode : 500).send({
      error: clientError ? (error as Error).message : 'Internal server error',
    })
  })

  app.get('/health', async () => ({ ok: true, paymentProvider: payments.name }))

  await app.register(authRoutes(opts.db))
  await app.register(propertyRoutes(opts.db))
  await app.register(tenantRoutes(opts.db))
  await app.register(leaseRoutes(opts.db))
  await app.register(dashboardRoutes(opts.db))
  await app.register(maintenanceRoutes(opts.db))
  await app.register(expenseRoutes(opts.db))
  await app.register(reportRoutes(opts.db))
  await app.register(documentRoutes(opts.db, uploadsDir, fileSigner))
  await app.register(announcementRoutes(opts.db))
  await app.register(messageRoutes(opts.db, payments))
  await app.register(submissionRoutes(opts.db, fileSigner, notifiers))
  await app.register(notificationRoutes(opts.db))
  await app.register(portalRoutes(opts.db, uploadsDir, payments, fileSigner, notifiers))

  return app
}

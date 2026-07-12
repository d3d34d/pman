import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { cents, dateString, idParam } from '../validation.js'
import { notFound } from '../errors.js'
import { ownedProperty } from '../guards.js'
import type { DB } from '../db.js'

export const EXPENSE_CATEGORIES = ['REPAIRS', 'UTILITIES', 'TAXES', 'INSURANCE', 'MANAGEMENT', 'OTHER'] as const

const expenseBody = z.object({
  propertyId: z.string().min(1),
  category: z.enum(EXPENSE_CATEGORIES),
  amountCents: cents.refine((v) => v > 0, 'Amount must be greater than zero'),
  incurredOn: dateString,
  description: z.string().optional(),
})

export default function expenseRoutes(db: DB) {
  return async function routes(app: FastifyInstance) {
    app.addHook('preHandler', app.requireManager)

    app.get('/expenses', async (request) => {
      const query = z
        .object({ propertyId: z.string().optional(), from: dateString.optional(), to: dateString.optional() })
        .parse(request.query)
      const expenses = await db.expense.findMany({
        where: {
          property: { managerId: request.user.sub, ...(query.propertyId ? { id: query.propertyId } : {}) },
          ...(query.from || query.to
            ? { incurredOn: { ...(query.from ? { gte: query.from } : {}), ...(query.to ? { lte: query.to } : {}) } }
            : {}),
        },
        include: { property: { select: { id: true, name: true } } },
        orderBy: { incurredOn: 'desc' },
      })
      return { expenses, totalCents: expenses.reduce((s, e) => s + e.amountCents, 0) }
    })

    app.post('/expenses', async (request, reply) => {
      const body = expenseBody.parse(request.body)
      await ownedProperty(db, body.propertyId, request.user.sub)
      const expense = await db.expense.create({ data: body })
      reply.code(201)
      return { expense }
    })

    app.delete('/expenses/:id', async (request) => {
      const { id } = idParam.parse(request.params)
      const expense = await db.expense.findFirst({
        where: { id, property: { managerId: request.user.sub } },
      })
      if (!expense) throw notFound('Expense')
      await db.expense.delete({ where: { id } })
      return { ok: true }
    })
  }
}

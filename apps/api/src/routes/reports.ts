import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { periodString } from '../validation.js'
import { getLeaseFinance, isLeaseActiveIn, periodOf, periodStatusOf } from '../billing.js'
import type { DB } from '../db.js'

function csvEscape(value: unknown): string {
  const s = String(value ?? '')
  return /[",\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s
}

function toCsv(headers: string[], rows: unknown[][]): string {
  return [headers, ...rows].map((r) => r.map(csvEscape).join(',')).join('\n') + '\n'
}

function dollars(centsValue: number): string {
  return (centsValue / 100).toFixed(2)
}

export default function reportRoutes(db: DB) {
  return async function routes(app: FastifyInstance) {
    app.addHook('preHandler', app.requireManager)

    // Income (payments received) vs expenses, per property per month of a year.
    app.get('/reports/income', async (request) => {
      const query = z.object({ year: z.coerce.number().int().min(2000).max(2100) }).parse(request.query)
      const from = new Date(Date.UTC(query.year, 0, 1))
      const to = new Date(Date.UTC(query.year + 1, 0, 1))

      const [payments, expenses, properties] = await Promise.all([
        db.payment.findMany({
          where: { receivedDate: { gte: from, lt: to }, lease: { unit: { property: { managerId: request.user.sub } } } },
          include: { lease: { include: { unit: { select: { propertyId: true } } } } },
        }),
        db.expense.findMany({
          where: { incurredOn: { gte: from, lt: to }, property: { managerId: request.user.sub } },
        }),
        db.property.findMany({ where: { managerId: request.user.sub }, select: { id: true, name: true } }),
      ])

      const byProperty = properties.map((p) => {
        const months = Array.from({ length: 12 }, (_, i) => ({
          period: `${query.year}-${String(i + 1).padStart(2, '0')}`,
          incomeCents: 0,
          expenseCents: 0,
        }))
        for (const pay of payments) {
          if (pay.lease.unit.propertyId !== p.id) continue
          months[pay.receivedDate.getUTCMonth()].incomeCents += pay.amountCents
        }
        for (const exp of expenses) {
          if (exp.propertyId !== p.id) continue
          months[exp.incurredOn.getUTCMonth()].expenseCents += exp.amountCents
        }
        const incomeCents = months.reduce((s, m) => s + m.incomeCents, 0)
        const expenseCents = months.reduce((s, m) => s + m.expenseCents, 0)
        return { property: p, months, incomeCents, expenseCents, netCents: incomeCents - expenseCents }
      })

      return {
        year: query.year,
        properties: byProperty,
        totals: {
          incomeCents: byProperty.reduce((s, p) => s + p.incomeCents, 0),
          expenseCents: byProperty.reduce((s, p) => s + p.expenseCents, 0),
          netCents: byProperty.reduce((s, p) => s + p.netCents, 0),
        },
      }
    })

    // Every lease with money outstanding, worst first.
    app.get('/reports/delinquency', async (request) => {
      const leases = await db.lease.findMany({
        where: { unit: { property: { managerId: request.user.sub } } },
        include: {
          unit: { include: { property: { select: { name: true } } } },
          tenants: { include: { tenant: { select: { fullName: true, phone: true } } } },
        },
      })
      const now = new Date()
      const period = periodOf(now)
      const rows = []
      for (const lease of leases) {
        if (lease.status === 'ENDED' && !isLeaseActiveIn(lease, period)) {
          // still include ended leases if they owe money
        }
        const finance = await getLeaseFinance(db, lease.id)
        if (finance.dueNowCents <= 0) continue
        const oldestUnpaid = finance.charges.find((c) => c.unpaidCents > 0 && c.dueDate <= now)
        rows.push({
          leaseId: lease.id,
          propertyName: lease.unit.property.name,
          unitLabel: lease.unit.label,
          tenants: lease.tenants.map((t) => t.tenant.fullName).join(', '),
          phone: lease.tenants[0]?.tenant.phone ?? null,
          balanceCents: finance.dueNowCents,
          oldestUnpaidPeriod: oldestUnpaid?.period ?? null,
          status: periodStatusOf(finance, period, lease.graceDays, now).status,
        })
      }
      rows.sort((a, b) => b.balanceCents - a.balanceCents)
      return { rows, totalCents: rows.reduce((s, r) => s + r.balanceCents, 0) }
    })

    // CSV exports ------------------------------------------------------------

    app.get('/reports/rent-roll.csv', async (request, reply) => {
      const query = z.object({ period: periodString.optional() }).parse(request.query)
      const period = query.period ?? periodOf(new Date())
      const now = new Date()
      const leases = await db.lease.findMany({
        where: { unit: { property: { managerId: request.user.sub } } },
        include: {
          unit: { include: { property: true } },
          tenants: { include: { tenant: { select: { fullName: true } } } },
        },
      })
      const rows: unknown[][] = []
      for (const lease of leases) {
        if (!isLeaseActiveIn(lease, period)) continue
        const finance = await getLeaseFinance(db, lease.id, { throughPeriod: period })
        const s = periodStatusOf(finance, period, lease.graceDays, now)
        rows.push([
          lease.unit.property.name,
          lease.unit.label,
          lease.tenants.map((t) => t.tenant.fullName).join('; '),
          period,
          dollars(s.dueCents),
          dollars(s.paidCents),
          dollars(s.dueCents - s.paidCents),
          s.status,
          dollars(finance.dueNowCents),
        ])
      }
      reply.header('content-type', 'text/csv; charset=utf-8')
      reply.header('content-disposition', `attachment; filename="rent-roll-${period}.csv"`)
      return toCsv(
        ['Property', 'Unit', 'Tenants', 'Period', 'Due', 'Paid', 'Unpaid', 'Status', 'Total Balance'],
        rows,
      )
    })

    app.get('/reports/income.csv', async (request, reply) => {
      const query = z.object({ year: z.coerce.number().int().min(2000).max(2100) }).parse(request.query)
      const income = (await app.inject({
        method: 'GET',
        url: `/reports/income?year=${query.year}`,
        headers: { authorization: request.headers.authorization! },
      }).then((r) => r.json())) as {
        properties: { property: { name: string }; months: { period: string; incomeCents: number; expenseCents: number }[] }[]
      }
      const rows: unknown[][] = []
      for (const p of income.properties) {
        for (const m of p.months) {
          rows.push([p.property.name, m.period, dollars(m.incomeCents), dollars(m.expenseCents), dollars(m.incomeCents - m.expenseCents)])
        }
      }
      reply.header('content-type', 'text/csv; charset=utf-8')
      reply.header('content-disposition', `attachment; filename="income-${query.year}.csv"`)
      return toCsv(['Property', 'Month', 'Income', 'Expenses', 'Net'], rows)
    })
  }
}

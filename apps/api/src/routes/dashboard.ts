import type { FastifyInstance } from 'fastify'
import { getLeaseFinance, isLeaseActiveIn, periodOf, periodStatusOf } from '../billing.js'
import type { DB } from '../db.js'

export default function dashboardRoutes(db: DB) {
  return async function routes(app: FastifyInstance) {
    app.addHook('preHandler', app.requireManager)

    app.get('/dashboard', async (request) => {
      const managerId = request.user.sub
      const now = new Date()
      const period = periodOf(now)

      const [units, leases, openMaintenance, pendingSubmissions] = await Promise.all([
        db.unit.count({ where: { property: { managerId } } }),
        db.lease.findMany({
          where: { unit: { property: { managerId } } },
          include: {
            unit: { include: { property: true } },
            tenants: { include: { tenant: { select: { id: true, fullName: true } } } },
          },
        }),
        db.maintenanceRequest.count({
          where: { unit: { property: { managerId } }, status: { in: ['OPEN', 'IN_PROGRESS'] } },
        }),
        db.paymentSubmission.count({
          where: { lease: { unit: { property: { managerId } } }, status: 'PENDING' },
        }),
      ])

      const activeLeases = leases.filter((l) => isLeaseActiveIn(l, period) && l.status !== 'ENDED')

      let dueCents = 0
      let collectedCents = 0
      const overdue: object[] = []
      for (const lease of activeLeases) {
        const finance = await getLeaseFinance(db, lease.id)
        const status = periodStatusOf(finance, period, lease.graceDays, now)
        dueCents += status.dueCents
        collectedCents += status.paidCents
        if (finance.dueNowCents > 0) {
          overdue.push({
            leaseId: lease.id,
            unitLabel: lease.unit.label,
            propertyName: lease.unit.property.name,
            tenants: lease.tenants.map((t) => t.tenant.fullName).join(', '),
            balanceCents: finance.dueNowCents,
            status: status.status,
          })
        }
      }

      const in90days = new Date(now.getTime() + 90 * 24 * 60 * 60 * 1000)
      const expiring = leases
        .filter((l) => l.status === 'ACTIVE' && l.endDate && l.endDate >= now && l.endDate <= in90days)
        .sort((a, b) => a.endDate!.getTime() - b.endDate!.getTime())
        .map((l) => ({
          leaseId: l.id,
          unitLabel: l.unit.label,
          propertyName: l.unit.property.name,
          tenants: l.tenants.map((t) => t.tenant.fullName).join(', '),
          endDate: l.endDate,
        }))

      return {
        period,
        occupancy: { totalUnits: units, occupiedUnits: activeLeases.length },
        rent: { dueCents, collectedCents, outstandingCents: Math.max(0, dueCents - collectedCents) },
        overdue,
        expiringLeases: expiring,
        openMaintenanceCount: openMaintenance,
        pendingSubmissionsCount: pendingSubmissions,
      }
    })
  }
}

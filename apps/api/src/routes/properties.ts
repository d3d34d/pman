import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { idParam } from '../validation.js'
import { ownedProperty, ownedUnit } from '../guards.js'
import type { DB } from '../db.js'

const propertyBody = z.object({
  name: z.string().min(1),
  address: z.string().min(1),
  type: z.string().optional(),
  notes: z.string().optional(),
})

const unitBody = z.object({
  label: z.string().min(1),
  bedrooms: z.number().int().min(0).optional(),
  bathrooms: z.number().min(0).optional(),
  sqft: z.number().int().min(0).optional(),
  marketRentCents: z.number().int().min(0).optional(),
  notes: z.string().optional(),
})

function isOccupied(unit: { leases: { status: string }[] }): boolean {
  return unit.leases.some((l) => l.status === 'ACTIVE' || l.status === 'MONTH_TO_MONTH')
}

export default function propertyRoutes(db: DB) {
  return async function routes(app: FastifyInstance) {
    app.addHook('preHandler', app.requireManager)

    app.get('/properties', async (request) => {
      const properties = await db.property.findMany({
        where: { managerId: request.user.sub },
        include: { units: { include: { leases: { select: { status: true } } } } },
        orderBy: { createdAt: 'asc' },
      })
      return {
        properties: properties.map((p) => ({
          id: p.id,
          name: p.name,
          address: p.address,
          type: p.type,
          notes: p.notes,
          unitCount: p.units.length,
          occupiedCount: p.units.filter(isOccupied).length,
        })),
      }
    })

    app.post('/properties', async (request, reply) => {
      const body = propertyBody.parse(request.body)
      const property = await db.property.create({ data: { ...body, managerId: request.user.sub } })
      reply.code(201)
      return { property }
    })

    app.get('/properties/:id', async (request) => {
      const { id } = idParam.parse(request.params)
      const property = await ownedProperty(db, id, request.user.sub)
      const units = await db.unit.findMany({
        where: { propertyId: id },
        include: {
          leases: {
            where: { status: { in: ['ACTIVE', 'MONTH_TO_MONTH'] } },
            include: {
              tenants: { include: { tenant: { select: { id: true, fullName: true } } } },
              rentTerms: true,
            },
          },
        },
        orderBy: { label: 'asc' },
      })
      return {
        property,
        units: units.map((u) => {
          const lease = u.leases[0] ?? null
          return {
            id: u.id,
            label: u.label,
            bedrooms: u.bedrooms,
            bathrooms: u.bathrooms,
            sqft: u.sqft,
            marketRentCents: u.marketRentCents,
            notes: u.notes,
            occupied: lease !== null,
            currentLease: lease
              ? {
                  id: lease.id,
                  status: lease.status,
                  startDate: lease.startDate,
                  endDate: lease.endDate,
                  tenants: lease.tenants.map((t) => t.tenant),
                }
              : null,
          }
        }),
      }
    })

    app.patch('/properties/:id', async (request) => {
      const { id } = idParam.parse(request.params)
      await ownedProperty(db, id, request.user.sub)
      const body = propertyBody.partial().parse(request.body)
      const property = await db.property.update({ where: { id }, data: body })
      return { property }
    })

    app.delete('/properties/:id', async (request) => {
      const { id } = idParam.parse(request.params)
      await ownedProperty(db, id, request.user.sub)
      await db.property.delete({ where: { id } })
      return { ok: true }
    })

    app.post('/properties/:id/units', async (request, reply) => {
      const { id } = idParam.parse(request.params)
      await ownedProperty(db, id, request.user.sub)
      const body = unitBody.parse(request.body)
      const unit = await db.unit.create({ data: { ...body, propertyId: id } })
      reply.code(201)
      return { unit }
    })

    app.get('/units/:id', async (request) => {
      const { id } = idParam.parse(request.params)
      const unit = await ownedUnit(db, id, request.user.sub)
      const leases = await db.lease.findMany({
        where: { unitId: id },
        include: {
          tenants: { include: { tenant: { select: { id: true, fullName: true } } } },
          rentTerms: { orderBy: { effectiveFrom: 'asc' } },
        },
        orderBy: { startDate: 'desc' },
      })
      return { unit, leases }
    })

    app.patch('/units/:id', async (request) => {
      const { id } = idParam.parse(request.params)
      await ownedUnit(db, id, request.user.sub)
      const body = unitBody.partial().parse(request.body)
      const unit = await db.unit.update({ where: { id }, data: body })
      return { unit }
    })

    app.delete('/units/:id', async (request) => {
      const { id } = idParam.parse(request.params)
      await ownedUnit(db, id, request.user.sub)
      await db.unit.delete({ where: { id } })
      return { ok: true }
    })
  }
}

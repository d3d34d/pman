import { notFound } from './errors.js'
import type { DB } from './db.js'

// Ownership guards: every manager-side query is scoped to the requesting
// manager, so one manager can never read or mutate another's data.

export async function ownedProperty(db: DB, id: string, managerId: string) {
  const property = await db.property.findFirst({ where: { id, managerId } })
  if (!property) throw notFound('Property')
  return property
}

export async function ownedUnit(db: DB, id: string, managerId: string) {
  const unit = await db.unit.findFirst({
    where: { id, property: { managerId } },
    include: { property: true },
  })
  if (!unit) throw notFound('Unit')
  return unit
}

export async function ownedLease(db: DB, id: string, managerId: string) {
  const lease = await db.lease.findFirst({
    where: { id, unit: { property: { managerId } } },
    include: {
      unit: { include: { property: true } },
      tenants: { include: { tenant: true } },
      rentTerms: { orderBy: { effectiveFrom: 'asc' } },
    },
  })
  if (!lease) throw notFound('Lease')
  return lease
}

export async function ownedTenant(db: DB, id: string, managerId: string) {
  const tenant = await db.tenantProfile.findFirst({ where: { id, managerId } })
  if (!tenant) throw notFound('Tenant')
  return tenant
}

export async function ownedMaintenance(db: DB, id: string, managerId: string) {
  const request = await db.maintenanceRequest.findFirst({
    where: { id, unit: { property: { managerId } } },
  })
  if (!request) throw notFound('Maintenance request')
  return request
}

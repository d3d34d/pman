import type { DB } from './db.js'

/**
 * Permanently deletes a user's account.
 *
 * MANAGER — removes the manager and everything they own (properties, units,
 * leases, tenants, ledgers, documents, messages). It's their business data.
 *
 * TENANT — removes the login and the tenant's personal data (saved cards,
 * autopay, their messages) but KEEPS the TenantProfile, lease and payment
 * history, which are the manager's records. The profile is unlinked so it can
 * be re-invited later. Maintenance requests the tenant filed are reassigned to
 * the manager so the manager doesn't lose them.
 *
 * Everything runs in a single transaction, so a failure leaves the account
 * fully intact rather than half-deleted.
 */
export async function deleteAccount(db: DB, userId: string): Promise<void> {
  const user = await db.user.findUnique({ where: { id: userId } })
  if (!user) return

  if (user.role === 'MANAGER') {
    const properties = await db.property.findMany({ where: { managerId: userId }, select: { id: true } })
    const propertyIds = properties.map((p) => p.id)
    const units = await db.unit.findMany({ where: { propertyId: { in: propertyIds } }, select: { id: true } })
    const unitIds = units.map((u) => u.id)
    const leases = await db.lease.findMany({ where: { unitId: { in: unitIds } }, select: { id: true } })
    const leaseIds = leases.map((l) => l.id)

    await db.$transaction([
      // Maintenance blocks unit deletion (and references the user); clear first.
      db.maintenanceRequest.deleteMany({ where: { unitId: { in: unitIds } } }),
      // Leases cascade their charges, payments, attempts, autopay, rent terms,
      // lease-tenant links and messages.
      db.lease.deleteMany({ where: { id: { in: leaseIds } } }),
      db.document.deleteMany({ where: { managerId: userId } }),
      // Properties cascade their units, expenses and announcements.
      db.property.deleteMany({ where: { managerId: userId } }),
      // Tenant profiles cascade payment methods, autopay, notes and invites.
      db.tenantProfile.deleteMany({ where: { managerId: userId } }),
      db.note.deleteMany({ where: { authorId: userId } }),
      db.user.delete({ where: { id: userId } }),
    ])
    return
  }

  // TENANT
  const profile = await db.tenantProfile.findUnique({ where: { userId } })
  const ops = []
  if (profile) {
    ops.push(
      db.maintenanceRequest.updateMany({ where: { createdById: userId }, data: { createdById: profile.managerId } }),
      db.paymentMethod.deleteMany({ where: { tenantId: profile.id } }),
      db.autopay.deleteMany({ where: { tenantId: profile.id } }),
      db.tenantProfile.update({ where: { id: profile.id }, data: { userId: null } }),
    )
  } else {
    ops.push(db.maintenanceRequest.deleteMany({ where: { createdById: userId } }))
  }
  ops.push(db.message.deleteMany({ where: { senderId: userId } }), db.user.delete({ where: { id: userId } }))
  await db.$transaction(ops)
}

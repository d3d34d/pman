// DEMO MODE request router. Maps the same REST surface the Fastify API exposes
// onto the in-memory store in ./store.ts. Only active when EXPO_PUBLIC_DEMO=1
// (the GitHub Pages build); see ../lib/api.ts for the wiring.
import { ApiError } from '../lib/api'
import {
  addPeriods,
  dueDateFor,
  ensureRentCharges,
  getLeaseFinance,
  isLeaseActiveIn,
  periodOf,
  periodStatusOf,
  receiptNumber,
  rentAmountFor,
  seedStore,
  uid,
  type Document,
  type Lease,
  type MaintenanceRequest,
  type Message,
  type PaymentSubmission,
  type Store,
  type User,
} from './store'

let store: Store | null = null
function db(): Store {
  if (!store) store = seedStore()
  return store
}

const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x))

function money(cents: number): string {
  return `$${(cents / 100).toLocaleString('en-US', { minimumFractionDigits: cents % 100 ? 2 : 0, maximumFractionDigits: 2 })}`
}
const METHOD_LABEL: Record<string, string> = { ZELLE: 'Zelle', BANK_TRANSFER: 'bank transfer', CASH: 'cash', CHECK: 'check', OTHER: 'other' }

function publicUser(u: User) {
  return { id: u.id, email: u.email, role: u.role, name: u.name, phone: u.phone }
}
function tokenFor(u: User): string {
  return `demo.${u.id}`
}
function userFromToken(token: string | null): User | null {
  if (!token || !token.startsWith('demo.')) return null
  const id = token.slice(5)
  return db().users.find((u) => u.id === id) ?? null
}

// --- entity lookups ---------------------------------------------------------

const propById = (id: string) => db().properties.find((p) => p.id === id)
const unitById = (id: string) => db().units.find((u) => u.id === id)
const leaseById = (id: string) => db().leases.find((l) => l.id === id)
const tenantById = (id: string) => db().tenants.find((t) => t.id === id)
const rentTermsOf = (leaseId: string) => db().rentTerms.filter((t) => t.leaseId === leaseId).sort((a, b) => a.effectiveFrom.getTime() - b.effectiveFrom.getTime())
const tenantsOfLease = (leaseId: string) =>
  db().leaseTenants.filter((lt) => lt.leaseId === leaseId).map((lt) => tenantById(lt.tenantId)!).filter(Boolean)
const leasesOfTenant = (tenantId: string) =>
  db().leaseTenants.filter((lt) => lt.tenantId === tenantId).map((lt) => leaseById(lt.leaseId)!).filter(Boolean)
const managerOwnsLease = (leaseId: string, managerId: string) => {
  const l = leaseById(leaseId)
  if (!l) return false
  const u = unitById(l.unitId)
  return !!u && propById(u.propertyId)?.managerId === managerId
}

function leaseSummary(lease: Lease) {
  const u = unitById(lease.unitId)!
  const p = propById(u.propertyId)!
  return {
    id: lease.id,
    status: lease.status,
    startDate: lease.startDate,
    endDate: lease.endDate,
    dueDay: lease.dueDay,
    unit: { id: u.id, label: u.label },
    property: { id: p.id, name: p.name },
    tenants: tenantsOfLease(lease.id).map((t) => ({ id: t.id, fullName: t.fullName })),
    currentRentCents: rentAmountFor(rentTermsOf(lease.id), periodOf(new Date())),
  }
}

function leaseWithRels(lease: Lease) {
  const u = unitById(lease.unitId)!
  const p = propById(u.propertyId)!
  return { ...lease, unit: { ...u, property: p }, rentTerms: rentTermsOf(lease.id) }
}

/** The lease the portal acts on: the active one, else the most recent. */
function currentLeaseOf(tenantId: string): Lease | null {
  const leases = leasesOfTenant(tenantId).sort((a, b) => b.startDate.getTime() - a.startDate.getTime())
  return leases.find((l) => l.status === 'ACTIVE' || l.status === 'MONTH_TO_MONTH') ?? leases[0] ?? null
}

function tenantProfileOfUser(userId: string) {
  const p = db().tenants.find((t) => t.userId === userId)
  if (!p) throw new ApiError(404, 'Tenant profile not found')
  return p
}

function notify(userId: string, type: string, title: string, body: string, data?: Record<string, unknown>) {
  db().notifications.push({
    id: uid('ntf'),
    userId,
    type,
    title,
    body,
    data: data ? JSON.stringify(data) : null,
    readAt: null,
    createdAt: new Date(),
  })
}

// --- route matching ---------------------------------------------------------

function match(pattern: string, pathname: string): Record<string, string> | null {
  const pp = pattern.split('/')
  const ap = pathname.split('/')
  if (pp.length !== ap.length) return null
  const params: Record<string, string> = {}
  for (let i = 0; i < pp.length; i++) {
    if (pp[i].startsWith(':')) params[pp[i].slice(1)] = decodeURIComponent(ap[i])
    else if (pp[i] !== ap[i]) return null
  }
  return params
}

type Ctx = { user: User | null; body: any; query: Record<string, string> }

// ---------------------------------------------------------------------------
// The dispatcher. Returns a plain (JSON-cloned) object or throws ApiError.
// ---------------------------------------------------------------------------

export async function handleDemo(method: string, path: string, body: any, token: string | null): Promise<any> {
  const [pathname, qs = ''] = path.split('?')
  const query: Record<string, string> = {}
  for (const [k, v] of new URLSearchParams(qs)) query[k] = v
  const user = userFromToken(token)
  const ctx: Ctx = { user, body, query }
  return clone(await dispatch(method, pathname, ctx))
}

function requireUser(ctx: Ctx): User {
  if (!ctx.user) throw new ApiError(401, 'Please sign in again.')
  return ctx.user
}
function requireManager(ctx: Ctx): User {
  const u = requireUser(ctx)
  if (u.role !== 'MANAGER') throw new ApiError(403, 'Managers only')
  return u
}
function requireTenant(ctx: Ctx): User {
  const u = requireUser(ctx)
  if (u.role !== 'TENANT') throw new ApiError(403, 'Tenants only')
  return u
}

async function dispatch(method: string, pathname: string, ctx: Ctx): Promise<any> {
  const M = (pat: string) => (method === 'POST' || method === 'PUT' || method === 'PATCH' || method === 'DELETE' || method === 'GET' ? match(pat, pathname) : null)
  let p: Record<string, string> | null

  // ---- auth (no token) ----
  if (method === 'POST' && pathname === '/auth/login') return login(ctx)
  if (method === 'POST' && pathname === '/auth/register') return register(ctx)
  if (method === 'POST' && pathname === '/auth/accept-invite') return acceptInvite(ctx)

  // ---- me / account ----
  if (method === 'GET' && pathname === '/me') return me(ctx)
  if (method === 'PATCH' && pathname === '/me') return updateMe(ctx)
  if (method === 'POST' && pathname === '/auth/change-password') return changePassword(ctx)
  if (method === 'POST' && pathname === '/auth/logout-all') return { token: tokenFor(requireUser(ctx)) }
  if (method === 'POST' && pathname === '/auth/delete-account') return deleteAccount(ctx)
  if ((method === 'POST' || method === 'DELETE') && pathname === '/me/push-token') return { ok: true }

  // ---- notifications ----
  if (method === 'GET' && pathname === '/me/notifications') return listNotifications(ctx)
  if (method === 'GET' && pathname === '/me/notifications/unread-count') return unreadCount(ctx)
  if (method === 'POST' && pathname === '/me/notifications/read-all') return readAllNotifications(ctx)
  if ((p = M('/me/notifications/:id/read')) && method === 'POST') return readNotification(ctx, p.id)

  // ---- manager: dashboard ----
  if (method === 'GET' && pathname === '/dashboard') return dashboard(ctx)

  // ---- manager: properties & units ----
  if (method === 'GET' && pathname === '/properties') return listProperties(ctx)
  if (method === 'POST' && pathname === '/properties') return createProperty(ctx)
  if ((p = M('/properties/:id')) && method === 'GET') return getProperty(ctx, p.id)
  if ((p = M('/properties/:id/units')) && method === 'POST') return createUnit(ctx, p.id)
  if ((p = M('/properties/:id/announcements')) && method === 'POST') return createAnnouncement(ctx, p.id)
  if ((p = M('/units/:id')) && method === 'GET') return getUnit(ctx, p.id)

  // ---- manager: announcements ----
  if (method === 'GET' && pathname === '/announcements') return listAnnouncements(ctx)

  // ---- manager: tenants ----
  if (method === 'GET' && pathname === '/tenants') return listTenants(ctx)
  if (method === 'POST' && pathname === '/tenants') return createTenant(ctx)
  if ((p = M('/tenants/:id')) && method === 'GET') return getTenant(ctx, p.id)
  if ((p = M('/tenants/:id')) && method === 'PATCH') return updateTenant(ctx, p.id)
  if ((p = M('/tenants/:id/archive')) && method === 'POST') return archiveTenant(ctx, p.id)
  if ((p = M('/tenants/:id/notes')) && method === 'POST') return addNote(ctx, p.id)
  if ((p = M('/tenants/:id/invite')) && method === 'POST') return inviteTenant(ctx, p.id)

  // ---- manager: leases ----
  if (method === 'GET' && pathname === '/leases') return listLeases(ctx)
  if (method === 'POST' && pathname === '/leases') return createLease(ctx)
  if ((p = M('/leases/:id')) && method === 'GET') return getLease(ctx, p.id)
  if ((p = M('/leases/:id/ledger')) && method === 'GET') return getLedger(ctx, p.id)
  if ((p = M('/leases/:id/end')) && method === 'POST') return endLease(ctx, p.id)
  if ((p = M('/leases/:id/rent-terms')) && method === 'POST') return addRentTerm(ctx, p.id)
  if ((p = M('/leases/:id/charges')) && method === 'POST') return addCharge(ctx, p.id)
  if ((p = M('/leases/:id/payments')) && method === 'POST') return addPayment(ctx, p.id)
  if ((p = M('/leases/:id/messages')) && method === 'GET') return leaseMessages(ctx, p.id)
  if ((p = M('/leases/:id/messages')) && method === 'POST') return sendLeaseMessage(ctx, p.id)
  if (method === 'GET' && pathname === '/rent-roll') return rentRoll(ctx)

  // ---- manager: maintenance ----
  if (method === 'GET' && pathname === '/maintenance') return listMaintenance(ctx)
  if (method === 'POST' && pathname === '/maintenance') return createMaintenance(ctx)
  if ((p = M('/maintenance/:id')) && method === 'PATCH') return patchMaintenance(ctx, p.id)

  // ---- manager: expenses ----
  if (method === 'GET' && pathname === '/expenses') return listExpenses(ctx)
  if (method === 'POST' && pathname === '/expenses') return createExpense(ctx)

  // ---- manager: reports ----
  if (method === 'GET' && pathname === '/reports/income') return reportIncome(ctx)
  if (method === 'GET' && pathname === '/reports/delinquency') return reportDelinquency(ctx)

  // ---- manager: messages ----
  if (method === 'GET' && pathname === '/messages') return inbox(ctx)

  // ---- manager: submissions ----
  if (method === 'GET' && pathname === '/payment-submissions') return listSubmissions(ctx)
  if ((p = M('/payment-submissions/:id/approve')) && method === 'POST') return approveSubmission(ctx, p.id)
  if ((p = M('/payment-submissions/:id/reject')) && method === 'POST') return rejectSubmission(ctx, p.id)

  // ---- manager: documents ----
  if (method === 'GET' && pathname === '/documents') return listDocuments(ctx)
  if ((p = M('/documents/:id')) && method === 'DELETE') return deleteDocument(ctx, p.id)

  // ---- tenant portal ----
  if (method === 'GET' && pathname === '/portal/overview') return portalOverview(ctx)
  if (method === 'GET' && pathname === '/portal/ledger') return portalLedger(ctx)
  if (method === 'GET' && pathname === '/portal/receipts') return portalReceipts(ctx)
  if ((p = M('/portal/receipts/:id')) && method === 'GET') return portalReceipt(ctx, p.id)
  if (method === 'GET' && pathname === '/portal/payment-submissions') return portalSubmissions(ctx)
  if (method === 'POST' && pathname === '/portal/payment-submissions') return portalCreateSubmission(ctx)
  if (method === 'GET' && pathname === '/portal/maintenance') return portalMaintenance(ctx)
  if (method === 'POST' && pathname === '/portal/maintenance') return portalCreateMaintenance(ctx)
  if (method === 'GET' && pathname === '/portal/documents') return portalDocuments(ctx)
  if (method === 'GET' && pathname === '/portal/announcements') return portalAnnouncements(ctx)
  if (method === 'GET' && pathname === '/portal/messages') return portalMessages(ctx)
  if (method === 'POST' && pathname === '/portal/messages') return portalSendMessage(ctx)

  throw new ApiError(404, `This action isn't available in the demo (${method} ${pathname}).`)
}

// ===========================================================================
// handlers
// ===========================================================================

function login(ctx: Ctx) {
  const email = String(ctx.body?.email ?? '').trim().toLowerCase()
  const password = String(ctx.body?.password ?? '')
  const user = db().users.find((u) => u.email.toLowerCase() === email)
  if (!user || user.password !== password) throw new ApiError(400, 'Invalid email or password')
  return { token: tokenFor(user), user: publicUser(user) }
}

function register(ctx: Ctx) {
  const name = String(ctx.body?.name ?? '').trim()
  const email = String(ctx.body?.email ?? '').trim().toLowerCase()
  const password = String(ctx.body?.password ?? '')
  if (!name) throw new ApiError(400, 'Name is required')
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new ApiError(400, 'Enter a valid email')
  if (password.length < 8) throw new ApiError(400, 'Password must be at least 8 characters')
  if (db().users.some((u) => u.email.toLowerCase() === email)) throw new ApiError(400, 'An account with this email already exists')
  const user: User = { id: uid('usr'), email, password, role: 'MANAGER', name, phone: ctx.body?.phone ?? null, tokenVersion: 0 }
  db().users.push(user)
  return { token: tokenFor(user), user: publicUser(user) }
}

function acceptInvite(ctx: Ctx) {
  const code = String(ctx.body?.code ?? '').trim()
  const email = String(ctx.body?.email ?? '').trim().toLowerCase()
  const password = String(ctx.body?.password ?? '')
  if (password.length < 8) throw new ApiError(400, 'Password must be at least 8 characters')
  const invite = db().invites.find((i) => i.code.toUpperCase() === code.toUpperCase())
  if (!invite || invite.usedAt || invite.expiresAt < new Date()) throw new ApiError(400, 'Invite code is invalid or has expired')
  const tenant = tenantById(invite.tenantId)!
  if (tenant.userId) throw new ApiError(400, 'This tenant already has a portal account')
  if (db().users.some((u) => u.email.toLowerCase() === email)) throw new ApiError(400, 'An account with this email already exists')
  const user: User = { id: uid('usr'), email, password, role: 'TENANT', name: tenant.fullName, phone: tenant.phone, tokenVersion: 0 }
  db().users.push(user)
  invite.usedAt = new Date()
  tenant.userId = user.id
  return { token: tokenFor(user), user: publicUser(user) }
}

function me(ctx: Ctx) {
  const u = requireUser(ctx)
  const profile = db().tenants.find((t) => t.userId === u.id)
  return { user: { ...publicUser(u), tenantProfileId: profile?.id ?? null } }
}

function updateMe(ctx: Ctx) {
  const u = requireUser(ctx)
  if (ctx.body?.name !== undefined) u.name = String(ctx.body.name).trim()
  if (ctx.body?.phone !== undefined) u.phone = ctx.body.phone
  if (ctx.body?.email !== undefined) {
    const email = String(ctx.body.email).trim().toLowerCase()
    if (db().users.some((x) => x.id !== u.id && x.email.toLowerCase() === email)) throw new ApiError(400, 'That email is already in use')
    u.email = email
  }
  return { user: publicUser(u) }
}

function changePassword(ctx: Ctx) {
  const u = requireUser(ctx)
  if (String(ctx.body?.currentPassword ?? '') !== u.password) throw new ApiError(400, 'Your current password is incorrect')
  const next = String(ctx.body?.newPassword ?? '')
  if (next.length < 8) throw new ApiError(400, 'Password must be at least 8 characters')
  u.password = next
  u.tokenVersion += 1
  return { token: tokenFor(u), user: publicUser(u) }
}

function deleteAccount(ctx: Ctx) {
  const u = requireUser(ctx)
  if (String(ctx.body?.password ?? '') !== u.password) throw new ApiError(400, 'Password is incorrect')
  const s = db()
  const profile = s.tenants.find((t) => t.userId === u.id)
  if (profile) profile.userId = null
  s.users = s.users.filter((x) => x.id !== u.id)
  return { ok: true }
}

// --- notifications ---
function listNotifications(ctx: Ctx) {
  const u = requireUser(ctx)
  const notifications = db().notifications.filter((n) => n.userId === u.id).sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()).slice(0, 100)
  return {
    unreadCount: notifications.filter((n) => n.readAt === null).length,
    notifications: notifications.map((n) => ({
      id: n.id,
      type: n.type,
      title: n.title,
      body: n.body,
      data: n.data ? JSON.parse(n.data) : null,
      read: n.readAt !== null,
      createdAt: n.createdAt,
    })),
  }
}
function unreadCount(ctx: Ctx) {
  const u = requireUser(ctx)
  return { unreadCount: db().notifications.filter((n) => n.userId === u.id && n.readAt === null).length }
}
function readAllNotifications(ctx: Ctx) {
  const u = requireUser(ctx)
  for (const n of db().notifications) if (n.userId === u.id && n.readAt === null) n.readAt = new Date()
  return { ok: true }
}
function readNotification(ctx: Ctx, id: string) {
  const u = requireUser(ctx)
  const n = db().notifications.find((x) => x.id === id && x.userId === u.id)
  if (n && n.readAt === null) n.readAt = new Date()
  return { ok: true }
}

// --- dashboard ---
function dashboard(ctx: Ctx) {
  const m = requireManager(ctx)
  const now = new Date()
  const period = periodOf(now)
  const units = db().units.filter((u) => propById(u.propertyId)?.managerId === m.id)
  const leases = db().leases.filter((l) => managerOwnsLease(l.id, m.id))
  const activeLeases = leases.filter((l) => isLeaseActiveIn(l, period) && l.status !== 'ENDED')

  let dueCents = 0
  let collectedCents = 0
  const overdue: object[] = []
  for (const lease of activeLeases) {
    const finance = getLeaseFinance(db(), lease.id)
    const status = periodStatusOf(finance, period, lease.graceDays, now)
    dueCents += status.dueCents
    collectedCents += status.paidCents
    if (finance.dueNowCents > 0) {
      const u = unitById(lease.unitId)!
      overdue.push({
        leaseId: lease.id,
        unitLabel: u.label,
        propertyName: propById(u.propertyId)!.name,
        tenants: tenantsOfLease(lease.id).map((t) => t.fullName).join(', '),
        balanceCents: finance.dueNowCents,
        status: status.status,
      })
    }
  }

  const in90 = new Date(now.getTime() + 90 * 24 * 60 * 60 * 1000)
  const expiring = leases
    .filter((l) => l.status === 'ACTIVE' && l.endDate && l.endDate >= now && l.endDate <= in90)
    .sort((a, b) => a.endDate!.getTime() - b.endDate!.getTime())
    .map((l) => {
      const u = unitById(l.unitId)!
      return { leaseId: l.id, unitLabel: u.label, propertyName: propById(u.propertyId)!.name, tenants: tenantsOfLease(l.id).map((t) => t.fullName).join(', '), endDate: l.endDate }
    })

  const openMaintenanceCount = db().maintenance.filter((r) => propById(unitById(r.unitId)!.propertyId)?.managerId === m.id && (r.status === 'OPEN' || r.status === 'IN_PROGRESS')).length
  const pendingSubmissionsCount = db().submissions.filter((s) => managerOwnsLease(s.leaseId, m.id) && s.status === 'PENDING').length

  return {
    period,
    occupancy: { totalUnits: units.length, occupiedUnits: activeLeases.length },
    rent: { dueCents, collectedCents, outstandingCents: Math.max(0, dueCents - collectedCents) },
    overdue,
    expiringLeases: expiring,
    openMaintenanceCount,
    pendingSubmissionsCount,
  }
}

// --- properties ---
function isOccupied(unitId: string) {
  return db().leases.some((l) => l.unitId === unitId && (l.status === 'ACTIVE' || l.status === 'MONTH_TO_MONTH'))
}
function listProperties(ctx: Ctx) {
  const m = requireManager(ctx)
  const properties = db().properties.filter((pr) => pr.managerId === m.id).sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
  return {
    properties: properties.map((pr) => {
      const units = db().units.filter((u) => u.propertyId === pr.id)
      return {
        id: pr.id,
        name: pr.name,
        address: pr.address,
        type: pr.type,
        notes: pr.notes,
        unitCount: units.length,
        occupiedCount: units.filter((u) => isOccupied(u.id)).length,
      }
    }),
  }
}
function createProperty(ctx: Ctx) {
  const m = requireManager(ctx)
  const b = ctx.body ?? {}
  if (!b.name || !b.address) throw new ApiError(400, 'Name and address are required')
  const property = { id: uid('prp'), managerId: m.id, name: b.name, address: b.address, type: b.type ?? null, notes: b.notes ?? null, createdAt: new Date() }
  db().properties.push(property)
  return { property }
}
function getProperty(ctx: Ctx, id: string) {
  const m = requireManager(ctx)
  const property = propById(id)
  if (!property || property.managerId !== m.id) throw new ApiError(404, 'Property not found')
  const units = db().units.filter((u) => u.propertyId === id).sort((a, b) => a.label.localeCompare(b.label))
  return {
    property,
    units: units.map((u) => {
      const lease = db().leases.find((l) => l.unitId === u.id && (l.status === 'ACTIVE' || l.status === 'MONTH_TO_MONTH')) ?? null
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
          ? { id: lease.id, status: lease.status, startDate: lease.startDate, endDate: lease.endDate, tenants: tenantsOfLease(lease.id).map((t) => ({ id: t.id, fullName: t.fullName })) }
          : null,
      }
    }),
  }
}
function createUnit(ctx: Ctx, propertyId: string) {
  const m = requireManager(ctx)
  const property = propById(propertyId)
  if (!property || property.managerId !== m.id) throw new ApiError(404, 'Property not found')
  const b = ctx.body ?? {}
  if (!b.label) throw new ApiError(400, 'Unit label is required')
  const unit = { id: uid('unt'), propertyId, label: b.label, bedrooms: b.bedrooms ?? null, bathrooms: b.bathrooms ?? null, sqft: b.sqft ?? null, marketRentCents: b.marketRentCents ?? null, notes: b.notes ?? null, createdAt: new Date() }
  db().units.push(unit)
  return { unit }
}
function getUnit(ctx: Ctx, id: string) {
  const m = requireManager(ctx)
  const unit = unitById(id)
  if (!unit || propById(unit.propertyId)?.managerId !== m.id) throw new ApiError(404, 'Unit not found')
  const leases = db().leases
    .filter((l) => l.unitId === id)
    .sort((a, b) => b.startDate.getTime() - a.startDate.getTime())
    .map((l) => ({ ...l, tenants: tenantsOfLease(l.id).map((t) => ({ tenant: { id: t.id, fullName: t.fullName } })), rentTerms: rentTermsOf(l.id) }))
  return { unit, leases }
}

// --- announcements ---
function listAnnouncements(ctx: Ctx) {
  const m = requireManager(ctx)
  const announcements = db().announcements
    .filter((a) => propById(a.propertyId)?.managerId === m.id)
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
    .map((a) => ({ ...a, property: { id: a.propertyId, name: propById(a.propertyId)!.name } }))
  return { announcements }
}
function createAnnouncement(ctx: Ctx, propertyId: string) {
  const m = requireManager(ctx)
  const property = propById(propertyId)
  if (!property || property.managerId !== m.id) throw new ApiError(404, 'Property not found')
  const b = ctx.body ?? {}
  if (!b.title || !b.body) throw new ApiError(400, 'Title and body are required')
  const announcement = { id: uid('ann'), propertyId, title: b.title, body: b.body, createdAt: new Date() }
  db().announcements.push(announcement)
  return { announcement }
}

// --- tenants ---
function listTenants(ctx: Ctx) {
  const m = requireManager(ctx)
  const status = ctx.query.status
  const tenants = db().tenants
    .filter((t) => t.managerId === m.id && (!status || t.status === status))
    .sort((a, b) => a.fullName.localeCompare(b.fullName))
  return {
    tenants: tenants.map((t) => {
      const active = leasesOfTenant(t.id).find((l) => l.status === 'ACTIVE' || l.status === 'MONTH_TO_MONTH')
      const u = active ? unitById(active.unitId) : null
      return {
        id: t.id,
        fullName: t.fullName,
        email: t.email,
        phone: t.phone,
        status: t.status,
        hasPortalAccount: t.userId !== null,
        activeLease: active && u ? { id: active.id, unitLabel: u.label, propertyName: propById(u.propertyId)!.name } : null,
      }
    }),
  }
}
function createTenant(ctx: Ctx) {
  const m = requireManager(ctx)
  const b = ctx.body ?? {}
  if (!b.fullName) throw new ApiError(400, 'Full name is required')
  const tenant = { id: uid('tnt'), managerId: m.id, userId: null, fullName: b.fullName, email: b.email ?? null, phone: b.phone ?? null, emergencyName: b.emergencyName ?? null, emergencyPhone: b.emergencyPhone ?? null, status: 'ACTIVE' as const, createdAt: new Date() }
  db().tenants.push(tenant)
  return { tenant }
}
function ownedTenantOrThrow(id: string, managerId: string) {
  const t = tenantById(id)
  if (!t || t.managerId !== managerId) throw new ApiError(404, 'Tenant not found')
  return t
}
function getTenant(ctx: Ctx, id: string) {
  const m = requireManager(ctx)
  const t = ownedTenantOrThrow(id, m.id)
  const user = t.userId ? db().users.find((u) => u.id === t.userId) : null
  return {
    tenant: {
      ...t,
      user: user ? { id: user.id, email: user.email } : null,
      leases: leasesOfTenant(t.id).map((l) => ({ lease: leaseWithRels(l) })),
      notes: db().notes
        .filter((n) => n.tenantId === t.id)
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
        .map((n) => ({ ...n, author: { name: db().users.find((u) => u.id === n.authorId)?.name ?? 'Manager' } })),
      invites: db().invites.filter((i) => i.tenantId === t.id && !i.usedAt && i.expiresAt > new Date()).sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()),
    },
  }
}
function updateTenant(ctx: Ctx, id: string) {
  const m = requireManager(ctx)
  const t = ownedTenantOrThrow(id, m.id)
  const b = ctx.body ?? {}
  for (const k of ['fullName', 'email', 'phone', 'emergencyName', 'emergencyPhone', 'status'] as const) {
    if (b[k] !== undefined) (t as any)[k] = b[k]
  }
  return { tenant: t }
}
function archiveTenant(ctx: Ctx, id: string) {
  const m = requireManager(ctx)
  const t = ownedTenantOrThrow(id, m.id)
  t.status = 'FORMER'
  return { tenant: t }
}
function addNote(ctx: Ctx, id: string) {
  const m = requireManager(ctx)
  ownedTenantOrThrow(id, m.id)
  if (!ctx.body?.body) throw new ApiError(400, 'Note body is required')
  const note = { id: uid('not'), tenantId: id, authorId: m.id, body: ctx.body.body, createdAt: new Date() }
  db().notes.push(note)
  return { note }
}
function inviteTenant(ctx: Ctx, id: string) {
  const m = requireManager(ctx)
  const t = ownedTenantOrThrow(id, m.id)
  if (t.userId) throw new ApiError(400, 'This tenant already has a portal account')
  const code = Array.from({ length: 8 }, () => '0123456789ABCDEF'[Math.floor(Math.random() * 16)]).join('')
  const invite = { id: uid('inv'), code, tenantId: id, usedAt: null, expiresAt: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000), createdAt: new Date() }
  db().invites.push(invite)
  return { invite }
}

// --- leases ---
function listLeases(ctx: Ctx) {
  const m = requireManager(ctx)
  const status = ctx.query.status
  const leases = db().leases
    .filter((l) => managerOwnsLease(l.id, m.id) && (!status || l.status === status))
    .sort((a, b) => b.startDate.getTime() - a.startDate.getTime())
  return { leases: leases.map(leaseSummary) }
}
function ownedLeaseOrThrow(id: string, managerId: string) {
  if (!managerOwnsLease(id, managerId)) throw new ApiError(404, 'Lease not found')
  return leaseById(id)!
}
function createLease(ctx: Ctx) {
  const m = requireManager(ctx)
  const b = ctx.body ?? {}
  const unit = unitById(b.unitId)
  if (!unit || propById(unit.propertyId)?.managerId !== m.id) throw new ApiError(404, 'Unit not found')
  if (db().leases.some((l) => l.unitId === unit.id && (l.status === 'ACTIVE' || l.status === 'MONTH_TO_MONTH'))) {
    throw new ApiError(400, 'This unit already has an active lease. End it before creating a new one.')
  }
  const tenantIds: string[] = b.tenantIds ?? []
  if (tenantIds.length === 0) throw new ApiError(400, 'Select at least one tenant')
  for (const tid of tenantIds) if (!tenantById(tid) || tenantById(tid)!.managerId !== m.id) throw new ApiError(404, 'One or more tenants not found')
  const lease: Lease = {
    id: uid('lse'),
    unitId: unit.id,
    status: b.status ?? 'ACTIVE',
    startDate: new Date(b.startDate),
    endDate: b.endDate ? new Date(b.endDate) : null,
    dueDay: b.dueDay ?? 1,
    depositCents: b.depositCents ?? 0,
    graceDays: b.graceDays ?? 5,
    lateFeeCents: b.lateFeeCents ?? 0,
    notes: b.notes ?? null,
    createdAt: new Date(),
  }
  db().leases.push(lease)
  for (const tid of tenantIds) db().leaseTenants.push({ leaseId: lease.id, tenantId: tid })
  db().rentTerms.push({ id: uid('rtm'), leaseId: lease.id, amountCents: b.rentCents, effectiveFrom: new Date(b.startDate), note: 'Initial rent', createdAt: new Date() })
  return { lease }
}
function getLease(ctx: Ctx, id: string) {
  const m = requireManager(ctx)
  const lease = ownedLeaseOrThrow(id, m.id)
  const finance = getLeaseFinance(db(), id)
  const period = periodOf(new Date())
  return {
    lease: {
      ...leaseSummary(lease),
      depositCents: lease.depositCents,
      graceDays: lease.graceDays,
      lateFeeCents: lease.lateFeeCents,
      notes: lease.notes,
      rentTerms: rentTermsOf(id),
    },
    finance: {
      balanceCents: finance.balanceCents,
      dueNowCents: finance.dueNowCents,
      totalChargedCents: finance.totalChargedCents,
      totalPaidCents: finance.totalPaidCents,
      currentPeriod: periodStatusOf(finance, period, lease.graceDays, new Date()),
    },
  }
}
function getLedger(ctx: Ctx, id: string) {
  const m = requireManager(ctx)
  const lease = ownedLeaseOrThrow(id, m.id)
  const finance = getLeaseFinance(db(), id)
  return {
    leaseId: id,
    graceDays: lease.graceDays,
    charges: finance.charges,
    payments: finance.payments,
    balanceCents: finance.balanceCents,
    dueNowCents: finance.dueNowCents,
    totalChargedCents: finance.totalChargedCents,
    totalPaidCents: finance.totalPaidCents,
  }
}
function endLease(ctx: Ctx, id: string) {
  const m = requireManager(ctx)
  const lease = ownedLeaseOrThrow(id, m.id)
  lease.status = 'ENDED'
  lease.endDate = new Date(ctx.body?.endDate)
  return { lease }
}
function addRentTerm(ctx: Ctx, id: string) {
  const m = requireManager(ctx)
  ownedLeaseOrThrow(id, m.id)
  const b = ctx.body ?? {}
  const rentTerm = { id: uid('rtm'), leaseId: id, amountCents: b.amountCents, effectiveFrom: new Date(b.effectiveFrom), note: b.note ?? null, createdAt: new Date() }
  db().rentTerms.push(rentTerm)
  return { rentTerm }
}
function addCharge(ctx: Ctx, id: string) {
  const m = requireManager(ctx)
  ownedLeaseOrThrow(id, m.id)
  const b = ctx.body ?? {}
  const due = new Date(b.dueDate)
  const charge = { id: uid('chg'), leaseId: id, type: 'OTHER' as const, amountCents: b.amountCents, period: periodOf(due), dueDate: due, description: b.description, createdAt: new Date() }
  db().charges.push(charge)
  return { charge }
}
function addPayment(ctx: Ctx, id: string) {
  const m = requireManager(ctx)
  ownedLeaseOrThrow(id, m.id)
  const b = ctx.body ?? {}
  const payment = { id: uid('pay'), leaseId: id, amountCents: b.amountCents, receivedDate: new Date(b.receivedDate), method: b.method, source: 'MANUAL', receiptNumber: receiptNumber(), reference: b.reference ?? null, note: b.note ?? null, providerRef: null, paymentMethodId: null, createdAt: new Date() }
  db().payments.push(payment)
  return { payment }
}
function rentRoll(ctx: Ctx) {
  const m = requireManager(ctx)
  const period = ctx.query.period || periodOf(new Date())
  const now = new Date()
  const rows: any[] = []
  for (const lease of db().leases.filter((l) => managerOwnsLease(l.id, m.id))) {
    if (!isLeaseActiveIn(lease, period)) continue
    const finance = getLeaseFinance(db(), lease.id, { throughPeriod: period })
    const status = periodStatusOf(finance, period, lease.graceDays, now)
    rows.push({ lease: leaseSummary(lease), period, status: status.status, dueCents: status.dueCents, paidCents: status.paidCents, balanceCents: finance.dueNowCents })
  }
  const rank = (s: string) => (s === 'LATE' ? 0 : s === 'UNPAID' ? 1 : s === 'PARTIAL' ? 2 : s === 'UPCOMING' ? 3 : 4)
  rows.sort((a, b) => rank(a.status) - rank(b.status) || a.lease.property.name.localeCompare(b.lease.property.name))
  return { period, rows, totals: { dueCents: rows.reduce((s, r) => s + r.dueCents, 0), paidCents: rows.reduce((s, r) => s + r.paidCents, 0) } }
}

// --- maintenance ---
function maintenanceView(r: MaintenanceRequest) {
  const u = unitById(r.unitId)!
  const creator = db().users.find((x) => x.id === r.createdById)
  return { ...r, unit: { ...u, property: { id: u.propertyId, name: propById(u.propertyId)!.name } }, createdBy: creator ? { name: creator.name, role: creator.role } : { name: 'Tenant', role: 'TENANT' } }
}
function listMaintenance(ctx: Ctx) {
  const m = requireManager(ctx)
  const status = ctx.query.status
  const requests = db().maintenance
    .filter((r) => propById(unitById(r.unitId)!.propertyId)?.managerId === m.id && (!status || r.status === status))
    .sort((a, b) => (a.status > b.status ? 1 : a.status < b.status ? -1 : b.createdAt.getTime() - a.createdAt.getTime()))
    .map(maintenanceView)
  return { requests }
}
function createMaintenance(ctx: Ctx) {
  const m = requireManager(ctx)
  const b = ctx.body ?? {}
  const unit = unitById(b.unitId)
  if (!unit || propById(unit.propertyId)?.managerId !== m.id) throw new ApiError(404, 'Unit not found')
  const request = { id: uid('mnt'), unitId: b.unitId, leaseId: b.leaseId ?? null, createdById: m.id, title: b.title, description: b.description, priority: b.priority ?? 'NORMAL', status: 'OPEN' as const, vendorName: null, costCents: null, resolvedAt: null, createdAt: new Date() }
  db().maintenance.push(request)
  return { request }
}
function patchMaintenance(ctx: Ctx, id: string) {
  const m = requireManager(ctx)
  const r = db().maintenance.find((x) => x.id === id)
  if (!r || propById(unitById(r.unitId)!.propertyId)?.managerId !== m.id) throw new ApiError(404, 'Maintenance request not found')
  const b = ctx.body ?? {}
  if (b.status !== undefined) {
    r.status = b.status
    if (b.status === 'RESOLVED') r.resolvedAt = new Date()
  }
  if (b.priority !== undefined) r.priority = b.priority
  if (b.vendorName !== undefined) r.vendorName = b.vendorName
  if (b.costCents !== undefined) r.costCents = b.costCents
  return { request: r }
}

// --- expenses ---
function listExpenses(ctx: Ctx) {
  const m = requireManager(ctx)
  const propertyId = ctx.query.propertyId
  const expenses = db().expenses
    .filter((e) => propById(e.propertyId)?.managerId === m.id && (!propertyId || e.propertyId === propertyId))
    .sort((a, b) => b.incurredOn.getTime() - a.incurredOn.getTime())
    .map((e) => ({ ...e, property: { id: e.propertyId, name: propById(e.propertyId)!.name } }))
  return { expenses, totalCents: expenses.reduce((s, e) => s + e.amountCents, 0) }
}
function createExpense(ctx: Ctx) {
  const m = requireManager(ctx)
  const b = ctx.body ?? {}
  const property = propById(b.propertyId)
  if (!property || property.managerId !== m.id) throw new ApiError(404, 'Property not found')
  const expense = { id: uid('exp'), propertyId: b.propertyId, category: b.category, amountCents: b.amountCents, incurredOn: new Date(b.incurredOn), description: b.description ?? null, createdAt: new Date() }
  db().expenses.push(expense)
  return { expense }
}

// --- reports ---
function reportIncome(ctx: Ctx) {
  const m = requireManager(ctx)
  const year = Number(ctx.query.year) || new Date().getUTCFullYear()
  const from = new Date(Date.UTC(year, 0, 1))
  const to = new Date(Date.UTC(year + 1, 0, 1))
  const properties = db().properties.filter((pr) => pr.managerId === m.id)
  const payments = db().payments.filter((p) => managerOwnsLease(p.leaseId, m.id) && p.receivedDate >= from && p.receivedDate < to)
  const expenses = db().expenses.filter((e) => propById(e.propertyId)?.managerId === m.id && e.incurredOn >= from && e.incurredOn < to)

  const byProperty = properties.map((pr) => {
    const months = Array.from({ length: 12 }, (_, i) => ({ period: `${year}-${String(i + 1).padStart(2, '0')}`, incomeCents: 0, expenseCents: 0 }))
    for (const pay of payments) {
      if (unitById(leaseById(pay.leaseId)!.unitId)!.propertyId !== pr.id) continue
      months[pay.receivedDate.getUTCMonth()].incomeCents += pay.amountCents
    }
    for (const exp of expenses) {
      if (exp.propertyId !== pr.id) continue
      months[exp.incurredOn.getUTCMonth()].expenseCents += exp.amountCents
    }
    const incomeCents = months.reduce((s, x) => s + x.incomeCents, 0)
    const expenseCents = months.reduce((s, x) => s + x.expenseCents, 0)
    return { property: { id: pr.id, name: pr.name }, months, incomeCents, expenseCents, netCents: incomeCents - expenseCents }
  })
  return {
    year,
    properties: byProperty,
    totals: {
      incomeCents: byProperty.reduce((s, p) => s + p.incomeCents, 0),
      expenseCents: byProperty.reduce((s, p) => s + p.expenseCents, 0),
      netCents: byProperty.reduce((s, p) => s + p.netCents, 0),
    },
  }
}
function reportDelinquency(ctx: Ctx) {
  const m = requireManager(ctx)
  const now = new Date()
  const period = periodOf(now)
  const rows: any[] = []
  for (const lease of db().leases.filter((l) => managerOwnsLease(l.id, m.id))) {
    const finance = getLeaseFinance(db(), lease.id)
    if (finance.dueNowCents <= 0) continue
    const oldest = finance.charges.find((c) => c.unpaidCents > 0 && c.dueDate <= now)
    const u = unitById(lease.unitId)!
    const ten = tenantsOfLease(lease.id)
    rows.push({
      leaseId: lease.id,
      propertyName: propById(u.propertyId)!.name,
      unitLabel: u.label,
      tenants: ten.map((t) => t.fullName).join(', '),
      phone: ten[0]?.phone ?? null,
      balanceCents: finance.dueNowCents,
      oldestUnpaidPeriod: oldest?.period ?? null,
      status: periodStatusOf(finance, period, lease.graceDays, now).status,
    })
  }
  rows.sort((a, b) => b.balanceCents - a.balanceCents)
  return { rows, totalCents: rows.reduce((s, r) => s + r.balanceCents, 0) }
}

// --- messages (manager) ---
function inbox(ctx: Ctx) {
  const m = requireManager(ctx)
  const messages = db().messages
    .filter((msg) => managerOwnsLease(msg.leaseId, m.id))
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
  const threads = new Map<string, any>()
  for (const msg of messages) {
    const sender = db().users.find((u) => u.id === msg.senderId)
    const senderRole = sender?.role ?? 'TENANT'
    const lease = leaseById(msg.leaseId)!
    const u = unitById(lease.unitId)!
    const existing = threads.get(msg.leaseId)
    if (!existing) {
      threads.set(msg.leaseId, {
        leaseId: msg.leaseId,
        propertyName: propById(u.propertyId)!.name,
        unitLabel: u.label,
        tenants: tenantsOfLease(lease.id).map((t) => t.fullName).join(', '),
        lastMessage: msg.body,
        lastAt: msg.createdAt,
        unread: senderRole === 'TENANT' && !msg.readAt ? 1 : 0,
      })
    } else if (senderRole === 'TENANT' && !msg.readAt) {
      existing.unread += 1
    }
  }
  return { threads: [...threads.values()] }
}
function messageView(msg: Message) {
  const sender = db().users.find((u) => u.id === msg.senderId)
  return { ...msg, sender: { id: msg.senderId, name: sender?.name ?? 'User', role: sender?.role ?? 'TENANT' } }
}
function leaseMessages(ctx: Ctx, id: string) {
  const m = requireManager(ctx)
  ownedLeaseOrThrow(id, m.id)
  for (const msg of db().messages) if (msg.leaseId === id && msg.senderId !== m.id && !msg.readAt) msg.readAt = new Date()
  const messages = db().messages.filter((msg) => msg.leaseId === id).sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime()).map(messageView)
  return { messages, meId: m.id }
}
function sendLeaseMessage(ctx: Ctx, id: string) {
  const m = requireManager(ctx)
  ownedLeaseOrThrow(id, m.id)
  if (!ctx.body?.body) throw new ApiError(400, 'Message is required')
  const message = { id: uid('msg'), leaseId: id, senderId: m.id, body: ctx.body.body, readAt: null, createdAt: new Date() }
  db().messages.push(message)
  return { message }
}

// --- submissions (manager) ---
function submissionManagerView(s: PaymentSubmission) {
  const lease = leaseById(s.leaseId)!
  const u = unitById(lease.unitId)!
  return {
    id: s.id,
    amountCents: s.amountCents,
    method: s.method,
    paidOn: s.paidOn,
    reference: s.reference,
    note: s.note,
    status: s.status,
    reviewNote: s.reviewNote,
    reviewedAt: s.reviewedAt,
    createdAt: s.createdAt,
    tenantName: tenantById(s.tenantId)!.fullName,
    propertyName: propById(u.propertyId)!.name,
    unitLabel: u.label,
    leaseId: s.leaseId,
    proofUrl: s.proofUrl,
  }
}
function listSubmissions(ctx: Ctx) {
  const m = requireManager(ctx)
  const status = ctx.query.status
  const subs = db().submissions
    .filter((s) => managerOwnsLease(s.leaseId, m.id) && (!status || s.status === status))
    .sort((a, b) => (a.status > b.status ? 1 : a.status < b.status ? -1 : b.createdAt.getTime() - a.createdAt.getTime()))
    .map(submissionManagerView)
  return { submissions: subs }
}
function approveSubmission(ctx: Ctx, id: string) {
  const m = requireManager(ctx)
  const s = db().submissions.find((x) => x.id === id)
  if (!s || !managerOwnsLease(s.leaseId, m.id)) throw new ApiError(404, 'Payment submission not found')
  if (s.status !== 'PENDING') return { alreadyReviewed: true, status: s.status }
  const payment = { id: uid('pay'), leaseId: s.leaseId, amountCents: s.amountCents, receivedDate: s.paidOn, method: s.method, source: 'MANUAL', receiptNumber: receiptNumber(), reference: s.reference ?? `${s.method} (tenant-submitted)`, note: s.note, providerRef: null, paymentMethodId: null, createdAt: new Date() }
  db().payments.push(payment)
  s.status = 'APPROVED'
  s.reviewedAt = new Date()
  s.paymentId = payment.id
  notifyTenantReviewed(s.id)
  return { status: 'APPROVED', paymentId: payment.id, receiptNumber: payment.receiptNumber }
}
function rejectSubmission(ctx: Ctx, id: string) {
  const m = requireManager(ctx)
  const s = db().submissions.find((x) => x.id === id)
  if (!s || !managerOwnsLease(s.leaseId, m.id)) throw new ApiError(404, 'Payment submission not found')
  if (s.status !== 'PENDING') return { alreadyReviewed: true, status: s.status }
  s.status = 'REJECTED'
  s.reviewedAt = new Date()
  s.reviewNote = ctx.body?.reason ?? null
  notifyTenantReviewed(s.id)
  return { status: 'REJECTED' }
}

// --- documents (manager) ---
function documentView(d: Document) {
  return { id: d.id, filename: d.filename, mimeType: d.mimeType, uploadedAt: d.uploadedAt, url: d.url }
}
function listDocuments(ctx: Ctx) {
  const m = requireManager(ctx)
  const { ownerType, ownerId } = ctx.query
  const documents = db().documents
    .filter((d) => d.managerId === m.id && d.ownerType === ownerType && d.ownerId === ownerId)
    .sort((a, b) => b.uploadedAt.getTime() - a.uploadedAt.getTime())
    .map(documentView)
  return { documents }
}
function deleteDocument(ctx: Ctx, id: string) {
  const m = requireManager(ctx)
  const d = db().documents.find((x) => x.id === id && x.managerId === m.id)
  if (!d) throw new ApiError(404, 'Document not found')
  db().documents = db().documents.filter((x) => x.id !== id)
  return { ok: true }
}

// ===========================================================================
// tenant portal
// ===========================================================================

function daysUntil(date: Date, from: Date): number {
  return Math.ceil((date.getTime() - from.getTime()) / (24 * 60 * 60 * 1000))
}

function portalOverview(ctx: Ctx) {
  const u = requireTenant(ctx)
  const profile = tenantProfileOfUser(u.id)
  const active = currentLeaseOf(profile.id)
  const now = new Date()
  const period = periodOf(now)
  if (!active) return { lease: null, balanceCents: 0, currentPeriod: null, nextDueDate: null, autopay: null, autopayRun: null, renewal: null }

  const finance = getLeaseFinance(db(), active.id, { asOf: now })
  const current = periodStatusOf(finance, period, active.graceDays, now)
  const currentRent = rentAmountFor(rentTermsOf(active.id), period)
  const nextPeriod = current.status === 'PAID' ? addPeriods(period, 1) : period
  const unit = unitById(active.unitId)!
  const property = propById(unit.propertyId)!

  return {
    lease: {
      id: active.id,
      status: active.status,
      startDate: active.startDate,
      endDate: active.endDate,
      dueDay: active.dueDay,
      depositCents: active.depositCents,
      unitLabel: unit.label,
      propertyName: property.name,
      propertyAddress: property.address,
      coTenants: tenantsOfLease(active.id).map((t) => t.fullName),
      currentRentCents: currentRent,
    },
    balanceCents: finance.dueNowCents,
    currentPeriod: current,
    nextDueDate: dueDateFor(nextPeriod, active.dueDay),
    autopay: null,
    autopayRun: null,
    renewal: active.endDate
      ? { endDate: active.endDate, daysRemaining: daysUntil(active.endDate, now), expiringSoon: daysUntil(active.endDate, now) <= 90 }
      : { endDate: null, daysRemaining: null, expiringSoon: false },
  }
}
function portalLedger(ctx: Ctx) {
  const u = requireTenant(ctx)
  const profile = tenantProfileOfUser(u.id)
  const active = currentLeaseOf(profile.id)
  if (!active) return { charges: [], payments: [], balanceCents: 0, totalChargedCents: 0, totalPaidCents: 0 }
  const finance = getLeaseFinance(db(), active.id)
  return { charges: finance.charges, payments: finance.payments, balanceCents: finance.dueNowCents, totalChargedCents: finance.totalChargedCents, totalPaidCents: finance.totalPaidCents }
}
function portalReceipts(ctx: Ctx) {
  const u = requireTenant(ctx)
  const profile = tenantProfileOfUser(u.id)
  const active = currentLeaseOf(profile.id)
  if (!active) return { receipts: [] }
  const payments = db().payments.filter((p) => p.leaseId === active.id).sort((a, b) => b.receivedDate.getTime() - a.receivedDate.getTime())
  return {
    receipts: payments.map((p) => ({ id: p.id, receiptNumber: p.receiptNumber, amountCents: p.amountCents, receivedDate: p.receivedDate, method: p.method, source: p.source, reference: p.reference })),
  }
}
function portalReceipt(ctx: Ctx, id: string) {
  const u = requireTenant(ctx)
  const profile = tenantProfileOfUser(u.id)
  const payment = db().payments.find((p) => p.id === id && leasesOfTenant(profile.id).some((l) => l.id === p.leaseId))
  if (!payment) throw new ApiError(404, 'Receipt not found')
  const lease = leaseById(payment.leaseId)!
  const unit = unitById(lease.unitId)!
  const property = propById(unit.propertyId)!
  return {
    receipt: {
      id: payment.id,
      receiptNumber: payment.receiptNumber,
      amountCents: payment.amountCents,
      receivedDate: payment.receivedDate,
      method: payment.method,
      source: payment.source,
      reference: payment.reference,
      providerRef: payment.providerRef,
      card: null,
      tenantName: profile.fullName,
      propertyName: property.name,
      propertyAddress: property.address,
      unitLabel: unit.label,
    },
  }
}
function portalSubmissions(ctx: Ctx) {
  const u = requireTenant(ctx)
  const profile = tenantProfileOfUser(u.id)
  const subs = db().submissions.filter((s) => s.tenantId === profile.id).sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
  return {
    submissions: subs.map((s) => ({ id: s.id, amountCents: s.amountCents, method: s.method, paidOn: s.paidOn, reference: s.reference, note: s.note, status: s.status, reviewNote: s.reviewNote, reviewedAt: s.reviewedAt, createdAt: s.createdAt, proofUrl: s.proofUrl })),
  }
}
function portalCreateSubmission(ctx: Ctx) {
  const u = requireTenant(ctx)
  const profile = tenantProfileOfUser(u.id)
  const active = currentLeaseOf(profile.id)
  if (!active) throw new ApiError(400, 'You do not have an active lease.')
  const b = ctx.body ?? {}
  if (!b.amountCents || b.amountCents <= 0) throw new ApiError(400, 'Amount must be greater than zero')
  const submission = { id: uid('sub'), leaseId: active.id, tenantId: profile.id, amountCents: b.amountCents, method: b.method, paidOn: new Date(b.paidOn), reference: b.reference ?? null, note: b.note ?? null, status: 'PENDING' as const, reviewNote: null, reviewedAt: null, paymentId: null, proofUrl: null, createdAt: new Date() }
  db().submissions.push(submission)
  notifyManagerNewSubmission(submission.id)
  return { submission: { id: submission.id, status: submission.status } }
}
function portalMaintenance(ctx: Ctx) {
  const u = requireTenant(ctx)
  const profile = tenantProfileOfUser(u.id)
  const requests = db().maintenance
    .filter((r) => r.createdById === u.id)
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
    .map((r) => ({ ...r, unit: { ...unitById(r.unitId)!, property: { name: propById(unitById(r.unitId)!.propertyId)!.name } } }))
  return { requests, tenantId: profile.id }
}
function portalCreateMaintenance(ctx: Ctx) {
  const u = requireTenant(ctx)
  const profile = tenantProfileOfUser(u.id)
  const active = currentLeaseOf(profile.id)
  if (!active) throw new ApiError(400, 'No active lease found for your account')
  const b = ctx.body ?? {}
  const request = { id: uid('mnt'), unitId: active.unitId, leaseId: active.id, createdById: u.id, title: b.title, description: b.description, priority: b.priority ?? 'NORMAL', status: 'OPEN' as const, vendorName: null, costCents: null, resolvedAt: null, createdAt: new Date() }
  db().maintenance.push(request)
  return { request }
}
function portalDocuments(ctx: Ctx) {
  const u = requireTenant(ctx)
  const profile = tenantProfileOfUser(u.id)
  const active = currentLeaseOf(profile.id)
  if (!active) return { documents: [] }
  const documents = db().documents
    .filter((d) => (d.ownerType === 'LEASE' && d.ownerId === active.id) || (d.ownerType === 'TENANT' && d.ownerId === profile.id))
    .sort((a, b) => b.uploadedAt.getTime() - a.uploadedAt.getTime())
    .map(documentView)
  return { documents }
}
function portalAnnouncements(ctx: Ctx) {
  const u = requireTenant(ctx)
  const profile = tenantProfileOfUser(u.id)
  const propertyIds = [...new Set(leasesOfTenant(profile.id).map((l) => unitById(l.unitId)!.propertyId))]
  const announcements = db().announcements
    .filter((a) => propertyIds.includes(a.propertyId))
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
    .map((a) => ({ ...a, property: { name: propById(a.propertyId)!.name } }))
  return { announcements }
}
function portalMessages(ctx: Ctx) {
  const u = requireTenant(ctx)
  const profile = tenantProfileOfUser(u.id)
  const active = currentLeaseOf(profile.id)
  if (!active) return { messages: [] }
  for (const msg of db().messages) if (msg.leaseId === active.id && msg.senderId !== u.id && !msg.readAt) msg.readAt = new Date()
  const messages = db().messages.filter((msg) => msg.leaseId === active.id).sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime()).map(messageView)
  return { messages, meId: u.id }
}
function portalSendMessage(ctx: Ctx) {
  const u = requireTenant(ctx)
  const profile = tenantProfileOfUser(u.id)
  const active = currentLeaseOf(profile.id)
  if (!active) throw new ApiError(400, 'You do not have an active lease.')
  if (!ctx.body?.body) throw new ApiError(400, 'Message is required')
  const message = { id: uid('msg'), leaseId: active.id, senderId: u.id, body: ctx.body.body, readAt: null, createdAt: new Date() }
  db().messages.push(message)
  return { message }
}

// ===========================================================================
// notifications wiring (mirrors apps/api/src/notify/index.ts copy)
// ===========================================================================

function notifyManagerNewSubmission(submissionId: string) {
  const s = db().submissions.find((x) => x.id === submissionId)
  if (!s) return
  const lease = leaseById(s.leaseId)!
  const unit = unitById(lease.unitId)!
  const property = propById(unit.propertyId)!
  const who = tenantById(s.tenantId)!.fullName
  const where = `${property.name} · ${unit.label}`
  const amount = money(s.amountCents)
  const methodLabel = METHOD_LABEL[s.method] ?? s.method
  notify(property.managerId, 'PAYMENT_SUBMISSION', 'New payment to review', `${who} submitted ${amount} (${methodLabel}) for ${where}.`, { submissionId, screen: '/payment-approvals' })
}
function notifyTenantReviewed(submissionId: string) {
  const s = db().submissions.find((x) => x.id === submissionId)
  if (!s || s.status === 'PENDING') return
  const tenant = tenantById(s.tenantId)!
  if (!tenant.userId) return
  const lease = leaseById(s.leaseId)!
  const unit = unitById(lease.unitId)!
  const property = propById(unit.propertyId)!
  const amount = money(s.amountCents)
  const where = `${property.name} · ${unit.label}`
  const approved = s.status === 'APPROVED'
  const payment = s.paymentId ? db().payments.find((p) => p.id === s.paymentId) : null
  const title = approved ? 'Payment approved' : 'Payment not accepted'
  const body = approved
    ? `Your ${amount} payment for ${where} was approved${payment?.receiptNumber ? ` (receipt ${payment.receiptNumber})` : ''}.`
    : `Your ${amount} payment for ${where} was not accepted${s.reviewNote ? `: ${s.reviewNote}` : ''}.`
  notify(tenant.userId, 'PAYMENT_REVIEWED', title, body, { submissionId, screen: '/pay' })
}

// ===========================================================================
// uploads + CSV (called from ../lib/api.ts)
// ===========================================================================

/** DEMO handler for apiUpload: stores the file as a data URL and returns the
 *  same shape the real endpoint would. */
export async function handleDemoUpload(
  path: string,
  file: { url: string; name: string; mimeType: string },
  fields: Record<string, string>,
  token: string | null,
): Promise<any> {
  const { url, name, mimeType } = file
  const user = userFromToken(token)
  const [pathname] = path.split('?')

  let p: Record<string, string> | null
  if ((p = match('/portal/payment-submissions/:id/proof', pathname))) {
    if (!user) throw new ApiError(401, 'Please sign in again.')
    const s = db().submissions.find((x) => x.id === p!.id)
    if (!s) throw new ApiError(404, 'Payment submission not found')
    s.proofUrl = url
    return clone({ ok: true })
  }
  if ((p = match('/portal/maintenance/:id/photos', pathname))) {
    if (!user) throw new ApiError(401, 'Please sign in again.')
    const r = db().maintenance.find((x) => x.id === p!.id)
    if (!r) throw new ApiError(404, 'Maintenance request not found')
    const managerId = propById(unitById(r.unitId)!.propertyId)!.managerId
    const document = { id: uid('doc'), managerId, ownerType: 'MAINTENANCE', ownerId: r.id, filename: name, mimeType, url, uploadedAt: new Date() }
    db().documents.push(document)
    return clone({ document: documentView(document) })
  }
  if (pathname === '/documents') {
    if (!user || user.role !== 'MANAGER') throw new ApiError(403, 'Managers only')
    const document = { id: uid('doc'), managerId: user.id, ownerType: fields.ownerType ?? 'PROPERTY', ownerId: fields.ownerId ?? '', filename: name, mimeType, url, uploadedAt: new Date() }
    db().documents.push(document)
    return clone({ document: documentView(document) })
  }
  throw new ApiError(404, `This upload isn't available in the demo (${pathname}).`)
}

function csvEscape(v: unknown): string {
  const s = String(v ?? '')
  return /[",\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s
}
function dollars(c: number): string {
  return (c / 100).toFixed(2)
}

/** DEMO handler for downloadFile: returns the CSV text the endpoint would. */
export async function handleDemoCsv(path: string, token: string | null): Promise<string> {
  const [pathname, qs = ''] = path.split('?')
  const query: Record<string, string> = {}
  for (const [k, v] of new URLSearchParams(qs)) query[k] = v
  const user = userFromToken(token)
  const now = new Date()

  if (pathname === '/portal/statement.csv') {
    if (!user) throw new ApiError(401, 'Please sign in again.')
    const profile = tenantProfileOfUser(user.id)
    const active = currentLeaseOf(profile.id)
    const header = ['Date', 'Type', 'Description', 'Charge', 'Payment']
    if (!active) return header.join(',') + '\n'
    const finance = getLeaseFinance(db(), active.id)
    const rows = [
      ...finance.charges.map((c) => ({ date: c.dueDate, type: c.type, description: c.description ?? c.type, charge: dollars(c.amountCents), payment: '' })),
      ...finance.payments.map((p) => ({ date: p.receivedDate, type: 'PAYMENT', description: `${p.method}${p.reference ? ` — ${p.reference}` : ''}`, charge: '', payment: dollars(p.amountCents) })),
    ].sort((a, b) => a.date.getTime() - b.date.getTime())
    const lines = [header, ...rows.map((r) => [r.date.toISOString().slice(0, 10), r.type, r.description, r.charge, r.payment])]
    return lines.map((l) => l.map(csvEscape).join(',')).join('\n') + '\n'
  }

  if (pathname === '/reports/rent-roll.csv') {
    if (!user || user.role !== 'MANAGER') throw new ApiError(403, 'Managers only')
    const period = query.period || periodOf(now)
    const rows: unknown[][] = []
    for (const lease of db().leases.filter((l) => managerOwnsLease(l.id, user.id))) {
      if (!isLeaseActiveIn(lease, period)) continue
      const finance = getLeaseFinance(db(), lease.id, { throughPeriod: period })
      const s = periodStatusOf(finance, period, lease.graceDays, now)
      const u = unitById(lease.unitId)!
      rows.push([propById(u.propertyId)!.name, u.label, tenantsOfLease(lease.id).map((t) => t.fullName).join('; '), period, dollars(s.dueCents), dollars(s.paidCents), dollars(s.dueCents - s.paidCents), s.status, dollars(finance.dueNowCents)])
    }
    return [['Property', 'Unit', 'Tenants', 'Period', 'Due', 'Paid', 'Unpaid', 'Status', 'Total Balance'], ...rows].map((l) => l.map(csvEscape).join(',')).join('\n') + '\n'
  }

  if (pathname === '/reports/income.csv') {
    if (!user || user.role !== 'MANAGER') throw new ApiError(403, 'Managers only')
    const year = Number(query.year) || now.getUTCFullYear()
    const income = reportIncome({ user, body: null, query: { year: String(year) } })
    const rows: unknown[][] = []
    for (const pr of income.properties) {
      for (const m of pr.months) rows.push([pr.property.name, m.period, dollars(m.incomeCents), dollars(m.expenseCents), dollars(m.incomeCents - m.expenseCents)])
    }
    return [['Property', 'Month', 'Income', 'Expenses', 'Net'], ...rows].map((l) => l.map(csvEscape).join(',')).join('\n') + '\n'
  }

  throw new ApiError(404, `This export isn't available in the demo (${pathname}).`)
}

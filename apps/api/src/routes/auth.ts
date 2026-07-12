import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { badRequest } from '../errors.js'
import { DUMMY_HASH, emailSchema, hashPassword, passwordSchema, verifyPassword } from '../security.js'
import { deleteAccount } from '../account.js'
import type { DB } from '../db.js'

const registerSchema = z.object({
  name: z.string().min(1).max(120).trim(),
  email: emailSchema,
  password: passwordSchema,
  phone: z.string().max(40).optional(),
})

const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1).max(200),
})

const acceptInviteSchema = z.object({
  code: z.string().min(1).max(64),
  email: emailSchema,
  password: passwordSchema,
})

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1).max(200),
  newPassword: passwordSchema,
})

const updateProfileSchema = z.object({
  name: z.string().min(1).max(120).trim().optional(),
  phone: z.string().max(40).nullable().optional(),
  email: emailSchema.optional(),
})

function publicUser(user: { id: string; email: string; role: string; name: string; phone: string | null }) {
  return { id: user.id, email: user.email, role: user.role, name: user.name, phone: user.phone }
}

export default function authRoutes(db: DB) {
  return async function routes(app: FastifyInstance) {
    // Tighter rate limits on the credential endpoints (see app.ts for defaults).
    const authLimit = { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }

    app.post('/auth/register', authLimit, async (request) => {
      const body = registerSchema.parse(request.body)
      const existing = await db.user.findUnique({ where: { email: body.email } })
      if (existing) throw badRequest('An account with this email already exists')
      const user = await db.user.create({
        data: {
          name: body.name,
          email: body.email,
          phone: body.phone,
          role: 'MANAGER',
          passwordHash: await hashPassword(body.password),
        },
      })
      return { token: app.signToken(user), user: publicUser(user) }
    })

    app.post('/auth/login', authLimit, async (request) => {
      const body = loginSchema.parse(request.body)
      const user = await db.user.findUnique({ where: { email: body.email } })
      // Always run a compare (dummy hash when no user) so response time doesn't
      // reveal whether the email is registered.
      const ok = await verifyPassword(body.password, user?.passwordHash ?? DUMMY_HASH)
      if (!user || !ok) throw badRequest('Invalid email or password')
      return { token: app.signToken(user), user: publicUser(user) }
    })

    app.post('/auth/accept-invite', authLimit, async (request) => {
      const body = acceptInviteSchema.parse(request.body)
      const invite = await db.invite.findUnique({ where: { code: body.code }, include: { tenant: true } })
      if (!invite || invite.usedAt || invite.expiresAt < new Date()) {
        throw badRequest('Invite code is invalid or has expired')
      }
      if (invite.tenant.userId) throw badRequest('This tenant already has a portal account')
      const existing = await db.user.findUnique({ where: { email: body.email } })
      if (existing) throw badRequest('An account with this email already exists')

      // Atomically consume the invite and create the account so a race can't
      // redeem the same code twice.
      const { user } = await db.$transaction(async (tx) => {
        const claimed = await tx.invite.updateMany({
          where: { id: invite.id, usedAt: null },
          data: { usedAt: new Date() },
        })
        if (claimed.count === 0) throw badRequest('Invite code is invalid or has expired')
        const user = await tx.user.create({
          data: {
            name: invite.tenant.fullName,
            email: body.email,
            phone: invite.tenant.phone,
            role: 'TENANT',
            passwordHash: await hashPassword(body.password),
          },
        })
        await tx.tenantProfile.update({ where: { id: invite.tenantId }, data: { userId: user.id } })
        return { user }
      })

      return { token: app.signToken(user), user: publicUser(user) }
    })

    app.get('/me', { preHandler: [app.authenticate] }, async (request) => {
      const user = await db.user.findUnique({
        where: { id: request.user.sub },
        include: { tenantProfile: true },
      })
      if (!user) throw badRequest('User no longer exists')
      return { user: { ...publicUser(user), tenantProfileId: user.tenantProfile?.id ?? null } }
    })

    app.patch('/me', { preHandler: [app.authenticate] }, async (request) => {
      const body = updateProfileSchema.parse(request.body)
      if (body.email) {
        const clash = await db.user.findFirst({ where: { email: body.email, id: { not: request.user.sub } } })
        if (clash) throw badRequest('That email is already in use')
      }
      const user = await db.user.update({
        where: { id: request.user.sub },
        data: {
          ...(body.name !== undefined ? { name: body.name } : {}),
          ...(body.phone !== undefined ? { phone: body.phone } : {}),
          ...(body.email !== undefined ? { email: body.email } : {}),
        },
      })
      return { user: publicUser(user) }
    })

    app.post('/auth/change-password', { preHandler: [app.authenticate] }, async (request) => {
      const body = changePasswordSchema.parse(request.body)
      const user = await db.user.findUnique({ where: { id: request.user.sub } })
      if (!user) throw badRequest('User no longer exists')
      if (!(await verifyPassword(body.currentPassword, user.passwordHash))) {
        throw badRequest('Your current password is incorrect')
      }
      // Bumping tokenVersion invalidates every existing token, including other
      // devices — a password change logs everyone out.
      const updated = await db.user.update({
        where: { id: user.id },
        data: { passwordHash: await hashPassword(body.newPassword), tokenVersion: { increment: 1 } },
      })
      return { token: app.signToken(updated), user: publicUser(updated) }
    })

    // Revoke all sessions ("log out everywhere").
    app.post('/auth/logout-all', { preHandler: [app.authenticate] }, async (request) => {
      const updated = await db.user.update({
        where: { id: request.user.sub },
        data: { tokenVersion: { increment: 1 } },
      })
      return { token: app.signToken(updated) }
    })

    // Permanent, self-serve account deletion (required by app stores). Password
    // re-entry guards against an unattended device or a stolen session.
    app.post('/auth/delete-account', { preHandler: [app.authenticate] }, async (request) => {
      const body = z.object({ password: z.string().min(1).max(200) }).parse(request.body)
      const user = await db.user.findUnique({ where: { id: request.user.sub } })
      if (!user) throw badRequest('User no longer exists')
      if (!(await verifyPassword(body.password, user.passwordHash))) {
        throw badRequest('Password is incorrect')
      }
      await deleteAccount(db, user.id)
      return { ok: true }
    })

    // Register this device's Expo push token so the user can receive alerts.
    app.post('/me/push-token', { preHandler: [app.authenticate] }, async (request) => {
      const body = z.object({ token: z.string().min(1).max(300), platform: z.string().max(20).optional() }).parse(request.body)
      // Move the token to this user if it was previously on another (device reuse).
      await db.deviceToken.upsert({
        where: { token: body.token },
        create: { token: body.token, platform: body.platform, userId: request.user.sub },
        update: { userId: request.user.sub, platform: body.platform },
      })
      return { ok: true }
    })

    app.delete('/me/push-token', { preHandler: [app.authenticate] }, async (request) => {
      const body = z.object({ token: z.string().min(1).max(300) }).parse(request.body)
      await db.deviceToken.deleteMany({ where: { token: body.token, userId: request.user.sub } })
      return { ok: true }
    })
  }
}

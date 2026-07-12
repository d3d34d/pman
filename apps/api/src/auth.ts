import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import jwt from '@fastify/jwt'
import { TOKEN_TTL } from './security.js'
import type { DB } from './db.js'

export type JwtUser = { sub: string; role: 'MANAGER' | 'TENANT'; tv: number }

declare module '@fastify/jwt' {
  interface FastifyJWT {
    payload: JwtUser
    user: JwtUser
  }
}

declare module 'fastify' {
  interface FastifyInstance {
    signToken: (user: { id: string; role: string; tokenVersion: number }) => string
    authenticate: (request: FastifyRequest, reply: FastifyReply) => Promise<void>
    requireManager: (request: FastifyRequest, reply: FastifyReply) => Promise<void>
    requireTenant: (request: FastifyRequest, reply: FastifyReply) => Promise<void>
  }
}

export async function registerAuth(app: FastifyInstance, secret: string, db: DB): Promise<void> {
  await app.register(jwt, { secret, sign: { expiresIn: TOKEN_TTL } })

  app.decorate('signToken', (user: { id: string; role: string; tokenVersion: number }) =>
    app.jwt.sign({ sub: user.id, role: user.role as 'MANAGER' | 'TENANT', tv: user.tokenVersion }),
  )

  // Verifies the signature+expiry, then confirms the user still exists and the
  // token hasn't been revoked (password change / logout-all bumps tokenVersion).
  async function verify(request: FastifyRequest, reply: FastifyReply): Promise<boolean> {
    try {
      await request.jwtVerify()
    } catch {
      reply.code(401).send({ error: 'Unauthorized' })
      return false
    }
    const user = await db.user.findUnique({
      where: { id: request.user.sub },
      select: { tokenVersion: true },
    })
    if (!user || user.tokenVersion !== request.user.tv) {
      reply.code(401).send({ error: 'Session expired. Please log in again.' })
      return false
    }
    return true
  }

  app.decorate('authenticate', async (request: FastifyRequest, reply: FastifyReply) => {
    await verify(request, reply)
  })

  app.decorate('requireManager', async (request: FastifyRequest, reply: FastifyReply) => {
    if (!(await verify(request, reply))) return
    if (request.user.role !== 'MANAGER') {
      return reply.code(403).send({ error: 'Manager access required' })
    }
  })

  app.decorate('requireTenant', async (request: FastifyRequest, reply: FastifyReply) => {
    if (!(await verify(request, reply))) return
    if (request.user.role !== 'TENANT') {
      return reply.code(403).send({ error: 'Tenant access required' })
    }
  })
}

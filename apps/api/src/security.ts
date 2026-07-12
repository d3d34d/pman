import bcrypt from 'bcryptjs'
import { z } from 'zod'

// bcrypt only hashes the first 72 bytes; silently accepting longer passwords
// would mean the tail doesn't count. We reject them so what the user typed is
// what actually protects the account.
const MAX_PASSWORD_BYTES = 72

export const passwordSchema = z
  .string()
  .min(8, 'Password must be at least 8 characters')
  .refine((p) => Buffer.byteLength(p, 'utf8') <= MAX_PASSWORD_BYTES, {
    message: `Password must be at most ${MAX_PASSWORD_BYTES} bytes`,
  })

export const emailSchema = z.string().email().max(200).toLowerCase()

export function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 12)
}

export function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash)
}

// A pre-computed hash of a random string. Comparing against it when no user is
// found keeps login timing constant, so an attacker can't tell registered
// emails apart from unregistered ones by how long the request takes.
export const DUMMY_HASH = bcrypt.hashSync('pman-timing-equalizer-not-a-real-password', 12)

/**
 * Resolves the JWT secret. In production a missing or default secret is fatal —
 * a predictable secret lets anyone forge tokens for any account.
 */
export function resolveJwtSecret(env: NodeJS.ProcessEnv = process.env): string {
  const secret = env.JWT_SECRET
  const isProd = env.NODE_ENV === 'production'
  const weak = !secret || secret.length < 32 || secret === 'pman-dev-secret-change-in-production'

  if (isProd && weak) {
    throw new Error('JWT_SECRET must be set to a strong (32+ char) value in production')
  }
  return secret || 'pman-dev-secret-change-in-production'
}

export const TOKEN_TTL = '30d'

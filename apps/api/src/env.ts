import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * Loads apps/api/.env into process.env, located relative to this file rather
 * than the current working directory — so the server and seed work no matter
 * where they're launched from or how the Prisma client was generated. Real
 * environment variables (e.g. in production) always win.
 *
 * Import this module for its side effect BEFORE anything that reads env
 * (Prisma, JWT secret): `import './env.js'`.
 */
export function loadEnv(): void {
  const envPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '.env')
  let contents: string
  try {
    contents = readFileSync(envPath, 'utf8')
  } catch {
    return // No .env file — rely on the real environment (production).
  }
  for (const line of contents.split('\n')) {
    const match = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*?)\s*$/)
    if (!match) continue
    const [, key, rawValue] = match
    let value = rawValue
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1)
    }
    if (process.env[key] === undefined) process.env[key] = value
  }
}

// Run on import so a bare `import './env.js'` (placed first) is enough.
loadEnv()

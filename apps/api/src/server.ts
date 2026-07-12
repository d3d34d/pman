import './env.js' // loads apps/api/.env before anything reads process.env
import { mkdir } from 'node:fs/promises'
import path from 'node:path'
import { buildApp } from './app.js'
import { createPrisma } from './db.js'
import { resolveJwtSecret } from './security.js'

const port = Number(process.env.PORT ?? 4000)
const jwtSecret = resolveJwtSecret() // throws in production if weak/unset
const uploadsDir = path.resolve(process.cwd(), 'uploads')

await mkdir(uploadsDir, { recursive: true })

const app = await buildApp({
  db: createPrisma(),
  jwtSecret,
  uploadsDir,
  logger: true,
})

await app.listen({ port, host: '0.0.0.0' })
console.log(`PMAN API listening on http://0.0.0.0:${port}`)

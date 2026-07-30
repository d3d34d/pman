import './env.js' // loads apps/api/.env before anything reads process.env
import { mkdir } from 'node:fs/promises'
import path from 'node:path'
import { buildApp } from './app.js'
import { createPrisma } from './db.js'
import { resolveJwtSecret } from './security.js'

const port = Number(process.env.PORT ?? 4000)
const jwtSecret = resolveJwtSecret() // throws in production if weak/unset
// UPLOADS_DIR points at a persistent volume in production (e.g. /data/uploads).
// Container filesystems are ephemeral: without a volume every deploy would
// silently delete tenants' payment screenshots and lease documents.
const uploadsDir = process.env.UPLOADS_DIR
  ? path.resolve(process.env.UPLOADS_DIR)
  : path.resolve(process.cwd(), 'uploads')

await mkdir(uploadsDir, { recursive: true })

const app = await buildApp({
  db: createPrisma(),
  jwtSecret,
  uploadsDir,
  logger: true,
})

await app.listen({ port, host: '0.0.0.0' })
console.log(`PMAN API listening on http://0.0.0.0:${port} (uploads: ${uploadsDir})`)

// Containers are stopped with SIGTERM; close cleanly so in-flight requests
// finish and the port is released on redeploy.
for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.on(signal, () => {
    app.log.info(`${signal} received, shutting down`)
    app.close().then(
      () => process.exit(0),
      () => process.exit(1),
    )
  })
}

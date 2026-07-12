import type { FastifyInstance } from 'fastify'
import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import path from 'node:path'
import { z } from 'zod'

// Files are served only via short-lived signed URLs. The document/portal
// endpoints (which are auth-scoped) mint a token for each file they return;
// this route verifies it. This is the presigned-URL pattern: no ambient public
// access, and a leaked link stops working within the TTL.

const FILE_TOKEN_TTL_SECONDS = 60 * 60 // 1 hour

const ALLOWED_MIME = new Set([
  'application/pdf',
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/heic',
  'image/heif',
])

const ALLOWED_EXT = new Set(['.pdf', '.png', '.jpg', '.jpeg', '.webp', '.heic', '.heif'])

const CONTENT_TYPE: Record<string, string> = {
  '.pdf': 'application/pdf',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.heic': 'image/heic',
  '.heif': 'image/heif',
}

export function isAllowedUpload(mimeType: string | undefined, filename: string): boolean {
  const ext = path.extname(filename).toLowerCase()
  return ALLOWED_EXT.has(ext) && (!mimeType || ALLOWED_MIME.has(mimeType))
}

export type FileSigner = {
  /** Returns a relative URL (path + signed token) for a stored file. */
  url(storedName: string): string
}

// File tokens carry a different shape than session tokens; @fastify/jwt is
// typed around the session payload, so we sign/verify these through a cast.
type FileTokenPayload = { file: string }

export function createFileSigner(app: FastifyInstance): FileSigner {
  return {
    url(storedName: string) {
      const token = app.jwt.sign({ file: storedName } as unknown as Parameters<typeof app.jwt.sign>[0], {
        expiresIn: FILE_TOKEN_TTL_SECONDS,
      })
      return `/files/${encodeURIComponent(storedName)}?token=${token}`
    },
  }
}

export async function registerFileRoutes(app: FastifyInstance, uploadsDir: string): Promise<void> {
  app.get('/files/:name', async (request, reply) => {
    const params = z.object({ name: z.string().min(1) }).parse(request.params)
    const query = z.object({ token: z.string().min(1) }).parse(request.query)

    let payload: FileTokenPayload
    try {
      payload = app.jwt.verify(query.token) as unknown as FileTokenPayload
    } catch {
      return reply.code(401).send({ error: 'This link has expired.' })
    }

    // The token must be for exactly this file, and the name must not escape the
    // uploads directory (no traversal via "../").
    const safeName = path.basename(params.name)
    if (payload.file !== safeName) return reply.code(403).send({ error: 'Forbidden' })

    const full = path.join(uploadsDir, safeName)
    if (path.dirname(full) !== path.resolve(uploadsDir)) return reply.code(403).send({ error: 'Forbidden' })

    try {
      await stat(full)
    } catch {
      return reply.code(404).send({ error: 'Not found' })
    }

    reply.header('x-content-type-options', 'nosniff')
    reply.header('content-disposition', `inline; filename="${safeName}"`)
    reply.type(CONTENT_TYPE[path.extname(safeName).toLowerCase()] ?? 'application/octet-stream')
    return reply.send(createReadStream(full))
  })
}

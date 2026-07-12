import type { FastifyInstance } from 'fastify'
import { randomBytes } from 'node:crypto'
import { createWriteStream } from 'node:fs'
import { mkdir, unlink } from 'node:fs/promises'
import path from 'node:path'
import { pipeline } from 'node:stream/promises'
import { z } from 'zod'
import { badRequest, notFound } from '../errors.js'
import { isAllowedUpload, type FileSigner } from '../files.js'
import { ownedLease, ownedMaintenance, ownedProperty, ownedTenant } from '../guards.js'
import { idParam } from '../validation.js'
import type { DB } from '../db.js'

export const OWNER_TYPES = ['PROPERTY', 'LEASE', 'TENANT', 'MAINTENANCE', 'EXPENSE'] as const
export type OwnerType = (typeof OWNER_TYPES)[number]

const SAFE_EXT = /^\.[a-z0-9]{1,8}$/

export async function assertOwnerAccess(db: DB, ownerType: OwnerType, ownerId: string, managerId: string): Promise<void> {
  switch (ownerType) {
    case 'PROPERTY':
      await ownedProperty(db, ownerId, managerId)
      break
    case 'LEASE':
      await ownedLease(db, ownerId, managerId)
      break
    case 'TENANT':
      await ownedTenant(db, ownerId, managerId)
      break
    case 'MAINTENANCE':
      await ownedMaintenance(db, ownerId, managerId)
      break
    case 'EXPENSE': {
      const expense = await db.expense.findFirst({ where: { id: ownerId, property: { managerId } } })
      if (!expense) throw notFound('Expense')
      break
    }
  }
}

/**
 * Validates and writes an uploaded file to disk under a random, safe name.
 * Returns the stored filename + sanitized original name. Callers decide what to
 * do with it (create a Document, attach to a submission, …).
 */
export async function storeFile(
  uploadsDir: string,
  file: { filename: string; mimetype: string; file: NodeJS.ReadableStream },
): Promise<{ storedName: string; filename: string; mimeType: string }> {
  if (!isAllowedUpload(file.mimetype, file.filename)) {
    throw badRequest('Only PDF and image files (PDF, PNG, JPG, WEBP, HEIC) are allowed.')
  }
  await mkdir(uploadsDir, { recursive: true })
  // The stored name is random; we take only a validated extension from the
  // original, so a crafted filename can't traverse or inject a path.
  const rawExt = path.extname(file.filename).toLowerCase()
  const ext = SAFE_EXT.test(rawExt) ? rawExt : ''
  const storedName = `${randomBytes(12).toString('hex')}${ext}`

  await pipeline(file.file, createWriteStream(path.join(uploadsDir, storedName)))

  // Multipart truncates when the size limit is exceeded; don't keep a partial file.
  if ((file.file as { truncated?: boolean }).truncated) {
    await unlink(path.join(uploadsDir, storedName)).catch(() => {})
    throw badRequest('That file is too large (20 MB max).')
  }

  return { storedName, filename: path.basename(file.filename).slice(0, 200), mimeType: file.mimetype }
}

export async function saveUpload(
  db: DB,
  uploadsDir: string,
  file: { filename: string; mimetype: string; file: NodeJS.ReadableStream },
  ownerType: string,
  ownerId: string,
  managerId: string,
) {
  const stored = await storeFile(uploadsDir, file)
  return db.document.create({
    data: {
      managerId,
      ownerType,
      ownerId,
      filename: stored.filename,
      path: stored.storedName,
      mimeType: stored.mimeType,
    },
  })
}

export function documentView(doc: { id: string; filename: string; mimeType: string | null; uploadedAt: Date; path: string }, signer: FileSigner) {
  return {
    id: doc.id,
    filename: doc.filename,
    mimeType: doc.mimeType,
    uploadedAt: doc.uploadedAt,
    url: signer.url(doc.path),
  }
}

export default function documentRoutes(db: DB, uploadsDir: string, signer: FileSigner) {
  return async function routes(app: FastifyInstance) {
    app.addHook('preHandler', app.requireManager)

    app.get('/documents', async (request) => {
      const query = z
        .object({ ownerType: z.enum(OWNER_TYPES), ownerId: z.string().min(1) })
        .parse(request.query)
      const documents = await db.document.findMany({
        where: { managerId: request.user.sub, ownerType: query.ownerType, ownerId: query.ownerId },
        orderBy: { uploadedAt: 'desc' },
      })
      return { documents: documents.map((d) => documentView(d, signer)) }
    })

    app.post('/documents', async (request, reply) => {
      const file = await request.file()
      if (!file) throw badRequest('Expected a multipart file upload')
      const fields = z
        .object({ ownerType: z.enum(OWNER_TYPES), ownerId: z.string().min(1) })
        .parse(
          Object.fromEntries(
            Object.entries(file.fields).map(([k, v]) => [k, (v as { value?: string })?.value]),
          ),
        )
      await assertOwnerAccess(db, fields.ownerType, fields.ownerId, request.user.sub)
      const document = await saveUpload(db, uploadsDir, file, fields.ownerType, fields.ownerId, request.user.sub)
      reply.code(201)
      return { document: documentView(document, signer) }
    })

    app.delete('/documents/:id', async (request) => {
      const { id } = idParam.parse(request.params)
      const document = await db.document.findFirst({ where: { id, managerId: request.user.sub } })
      if (!document) throw notFound('Document')
      await db.document.delete({ where: { id } })
      await unlink(path.join(uploadsDir, document.path)).catch(() => {})
      return { ok: true }
    })
  }
}

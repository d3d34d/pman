import { PrismaClient } from '@prisma/client'

export type DB = PrismaClient

export function createPrisma(url?: string): PrismaClient {
  return new PrismaClient(
    url ? { datasources: { db: { url } } } : undefined,
  )
}

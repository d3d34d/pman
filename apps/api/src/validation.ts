import { z } from 'zod'

export const dateString = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected YYYY-MM-DD')
  .transform((s) => new Date(`${s}T00:00:00.000Z`))

export const periodString = z.string().regex(/^\d{4}-\d{2}$/, 'Expected YYYY-MM')

/**
 * Upper bound is essential, not cosmetic. `amountCents` columns are 32-bit
 * INTEGERs: SQLite will happily store a larger value, but Prisma then refuses
 * to read the row back (P2023). A single oversized amount — which a tenant can
 * produce by mistyping the amount field — permanently 500s the rent roll,
 * dashboard, reports and the tenant's own ledger, recoverable only with raw SQL.
 * $1,000,000 is far above any real rent and safely inside INT range.
 */
export const MAX_CENTS = 100_000_000

export const cents = z.number().int().min(0).max(MAX_CENTS, 'Amount is too large')

export const idParam = z.object({ id: z.string().min(1) })

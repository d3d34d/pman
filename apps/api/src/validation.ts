import { z } from 'zod'

export const dateString = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected YYYY-MM-DD')
  .transform((s) => new Date(`${s}T00:00:00.000Z`))

export const periodString = z.string().regex(/^\d{4}-\d{2}$/, 'Expected YYYY-MM')

export const cents = z.number().int().min(0)

export const idParam = z.object({ id: z.string().min(1) })

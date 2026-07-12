import type { DB } from '../db.js'
import { createEmailProvider, type EmailProvider } from './email.js'
import { createPushProvider, type PushProvider } from './push.js'

export * from './email.js'
export * from './push.js'

export type Notifiers = { push: PushProvider; email: EmailProvider }

export function createNotifiers(env: NodeJS.ProcessEnv = process.env): Notifiers {
  return { push: createPushProvider(), email: createEmailProvider(env) }
}

/** Persists an in-app notification so it shows up in the notification center. */
async function record(
  db: DB,
  userId: string,
  type: string,
  title: string,
  body: string,
  data?: Record<string, unknown>,
): Promise<void> {
  await db.notification.create({
    data: { userId, type, title, body, data: data ? JSON.stringify(data) : null },
  })
}

function money(cents: number): string {
  return `$${(cents / 100).toLocaleString('en-US', { minimumFractionDigits: cents % 100 ? 2 : 0, maximumFractionDigits: 2 })}`
}

const METHOD_LABEL: Record<string, string> = {
  ZELLE: 'Zelle',
  BANK_TRANSFER: 'bank transfer',
  CASH: 'cash',
  CHECK: 'check',
  OTHER: 'other',
}

/**
 * Alerts the property manager that a tenant submitted a payment for review,
 * via push (their registered devices) and email. Best-effort: any failure is
 * logged, never surfaced to the tenant who triggered it.
 */
export async function notifyManagerNewSubmission(db: DB, notifiers: Notifiers, submissionId: string): Promise<void> {
  const submission = await db.paymentSubmission.findUnique({
    where: { id: submissionId },
    include: {
      tenant: { select: { fullName: true } },
      lease: { include: { unit: { include: { property: { select: { name: true, managerId: true } } } } } },
    },
  })
  if (!submission) return

  const managerId = submission.lease.unit.property.managerId
  const manager = await db.user.findUnique({
    where: { id: managerId },
    include: { deviceTokens: { select: { token: true } } },
  })
  if (!manager) return

  const who = submission.tenant.fullName
  const where = `${submission.lease.unit.property.name} · ${submission.lease.unit.label}`
  const amount = money(submission.amountCents)
  const method = METHOD_LABEL[submission.method] ?? submission.method

  const title = 'New payment to review'
  const body = `${who} submitted ${amount} (${method}) for ${where}.`

  await record(db, manager.id, 'PAYMENT_SUBMISSION', title, body, { submissionId, screen: '/payment-approvals' })

  await Promise.allSettled([
    notifiers.push.send(
      manager.deviceTokens.map((d) => d.token),
      { title, body, data: { type: 'payment_submission', submissionId, screen: '/payment-approvals' } },
    ),
    notifiers.email.send({
      to: manager.email,
      subject: `PMAN — ${who} submitted a ${amount} payment`,
      text:
        `${who} submitted a payment for your review.\n\n` +
        `Amount:   ${amount}\n` +
        `Method:   ${method}\n` +
        `Property: ${where}\n` +
        (submission.reference ? `Reference: ${submission.reference}\n` : '') +
        `\nOpen PMAN → Payment approvals to review it.`,
    }),
  ])
}

/**
 * Tells the tenant their submitted payment was approved or rejected, via push
 * (their portal-account devices) and email. Call after the submission status
 * has been updated. Best-effort.
 */
export async function notifyTenantSubmissionReviewed(db: DB, notifiers: Notifiers, submissionId: string): Promise<void> {
  const submission = await db.paymentSubmission.findUnique({
    where: { id: submissionId },
    include: {
      payment: { select: { receiptNumber: true } },
      tenant: { select: { email: true, user: { select: { id: true, email: true, deviceTokens: { select: { token: true } } } } } },
      lease: { include: { unit: { include: { property: { select: { name: true } } } } } },
    },
  })
  if (!submission || submission.status === 'PENDING') return

  // Prefer the portal-account email; fall back to the profile's contact email.
  const email = submission.tenant.user?.email ?? submission.tenant.email
  const tokens = submission.tenant.user?.deviceTokens.map((d) => d.token) ?? []
  if (!email && tokens.length === 0) return

  const amount = money(submission.amountCents)
  const where = `${submission.lease.unit.property.name} · ${submission.lease.unit.label}`
  const approved = submission.status === 'APPROVED'

  const title = approved ? 'Payment approved' : 'Payment not accepted'
  const body = approved
    ? `Your ${amount} payment for ${where} was approved${submission.payment?.receiptNumber ? ` (receipt ${submission.payment.receiptNumber})` : ''}.`
    : `Your ${amount} payment for ${where} was not accepted${submission.reviewNote ? `: ${submission.reviewNote}` : ''}.`

  // In-app history only for tenants who have a portal account.
  if (submission.tenant.user) {
    await record(db, submission.tenant.user.id, 'PAYMENT_REVIEWED', title, body, { submissionId, screen: '/pay' })
  }

  await Promise.allSettled([
    notifiers.push.send(tokens, { title, body, data: { type: 'payment_reviewed', submissionId, screen: '/pay' } }),
    ...(email
      ? [
          notifiers.email.send({
            to: email,
            subject: approved ? `PMAN — your ${amount} payment was approved` : `PMAN — your ${amount} payment needs attention`,
            text: `${body}\n\nOpen PMAN → Pay rent to see your submissions.`,
          }),
        ]
      : []),
  ])
}

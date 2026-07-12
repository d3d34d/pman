// Email seam. Like the payment provider, the app only talks to this interface,
// so the transport (log / Resend / SMTP / …) is a config change.

export type EmailMessage = {
  to: string
  subject: string
  text: string
  html?: string
}

export interface EmailProvider {
  readonly name: string
  send(message: EmailMessage): Promise<void>
}

/**
 * Default transport: logs the email to the server console instead of sending.
 * Lets the whole notification flow run and be observed in development with no
 * account or keys.
 */
export class ConsoleEmailProvider implements EmailProvider {
  readonly name = 'CONSOLE'
  async send(message: EmailMessage): Promise<void> {
    console.log(
      `\n[email:console] would send →\n  to:      ${message.to}\n  subject: ${message.subject}\n  ${message.text.replace(/\n/g, '\n  ')}\n`,
    )
  }
}

/**
 * Resend (https://resend.com) over its REST API — no extra dependency.
 * Enable with EMAIL_PROVIDER=resend, RESEND_API_KEY and EMAIL_FROM.
 */
export class ResendEmailProvider implements EmailProvider {
  readonly name = 'RESEND'
  constructor(
    private readonly apiKey: string,
    private readonly from: string,
  ) {}

  async send(message: EmailMessage): Promise<void> {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { authorization: `Bearer ${this.apiKey}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        from: this.from,
        to: message.to,
        subject: message.subject,
        text: message.text,
        ...(message.html ? { html: message.html } : {}),
      }),
    })
    if (!res.ok) {
      const body = await res.text().catch(() => '')
      throw new Error(`Resend send failed (${res.status}): ${body}`)
    }
  }
}

export function createEmailProvider(env: NodeJS.ProcessEnv = process.env): EmailProvider {
  if (env.EMAIL_PROVIDER?.toLowerCase() === 'resend') {
    if (!env.RESEND_API_KEY || !env.EMAIL_FROM) {
      throw new Error('EMAIL_PROVIDER=resend requires RESEND_API_KEY and EMAIL_FROM')
    }
    return new ResendEmailProvider(env.RESEND_API_KEY, env.EMAIL_FROM)
  }
  return new ConsoleEmailProvider()
}

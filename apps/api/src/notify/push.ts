// Expo push sender. Talks to Expo's push service directly (keyless), and is an
// interface so tests can inject a recorder.

export type PushMessage = {
  title: string
  body: string
  data?: Record<string, unknown>
}

export interface PushProvider {
  readonly name: string
  /** Sends one message to each token. Never throws — delivery is best-effort. */
  send(tokens: string[], message: PushMessage): Promise<void>
}

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send'

export class ExpoPushProvider implements PushProvider {
  readonly name = 'EXPO'

  async send(tokens: string[], message: PushMessage): Promise<void> {
    const valid = tokens.filter((t) => t.startsWith('ExponentPushToken') || t.startsWith('ExpoPushToken'))
    if (valid.length === 0) return

    const payload = valid.map((to) => ({
      to,
      title: message.title,
      body: message.body,
      sound: 'default',
      priority: 'high',
      ...(message.data ? { data: message.data } : {}),
    }))

    try {
      const res = await fetch(EXPO_PUSH_URL, {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify(payload),
      })
      if (!res.ok) {
        console.warn(`[push:expo] send failed (${res.status})`)
      }
    } catch (e) {
      console.warn('[push:expo] send error:', (e as Error).message)
    }
  }
}

export function createPushProvider(): PushProvider {
  return new ExpoPushProvider()
}

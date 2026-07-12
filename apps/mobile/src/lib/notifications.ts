import * as Notifications from 'expo-notifications'
import { Platform } from 'react-native'

// Local, device-side rent reminders for tenants. Everything is guarded so the
// web build (and any platform without notification support) degrades cleanly
// to a "not available here" state instead of throwing.

let configured = false

export function configureNotifications(): void {
  if (configured || Platform.OS === 'web') return
  configured = true
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: true,
      shouldSetBadge: false,
    }),
  })
}

export function remindersSupported(): boolean {
  return Platform.OS !== 'web'
}

function ordinal(n: number): string {
  const s = ['th', 'st', 'nd', 'rd']
  const v = n % 100
  return `${n}${s[(v - 20) % 10] ?? s[v] ?? s[0]}`
}

/**
 * Requests permission (if needed) and schedules recurring monthly reminders:
 * one on the rent due day, and — when the due day allows — one three days
 * earlier. Replaces any previously scheduled reminders.
 */
export async function enableRentReminders(opts: {
  dueDay: number
  rentLabel: string
  propertyLabel: string
}): Promise<'scheduled' | 'denied' | 'unsupported'> {
  if (!remindersSupported()) return 'unsupported'

  const current = await Notifications.getPermissionsAsync()
  const granted =
    current.granted || (await Notifications.requestPermissionsAsync()).granted
  if (!granted) return 'denied'

  await Notifications.cancelAllScheduledNotificationsAsync()

  const dueDay = Math.min(Math.max(Math.round(opts.dueDay), 1), 28)

  await Notifications.scheduleNotificationAsync({
    content: {
      title: 'Rent is due today',
      body: `Your ${opts.rentLabel} rent for ${opts.propertyLabel} is due today.`,
    },
    trigger: { type: Notifications.SchedulableTriggerInputTypes.MONTHLY, day: dueDay, hour: 9, minute: 0 },
  })

  const soonDay = dueDay - 3
  if (soonDay >= 1) {
    await Notifications.scheduleNotificationAsync({
      content: {
        title: 'Rent due in 3 days',
        body: `Heads-up: your ${opts.rentLabel} rent for ${opts.propertyLabel} is due on the ${ordinal(dueDay)}.`,
      },
      trigger: { type: Notifications.SchedulableTriggerInputTypes.MONTHLY, day: soonDay, hour: 9, minute: 0 },
    })
  }

  return 'scheduled'
}

export async function disableRentReminders(): Promise<void> {
  if (!remindersSupported()) return
  await Notifications.cancelAllScheduledNotificationsAsync()
}

export async function scheduledReminderCount(): Promise<number> {
  if (!remindersSupported()) return 0
  const all = await Notifications.getAllScheduledNotificationsAsync()
  return all.length
}

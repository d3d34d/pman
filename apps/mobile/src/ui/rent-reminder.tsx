import { useEffect, useState } from 'react'
import { View } from 'react-native'
import {
  disableRentReminders,
  enableRentReminders,
  remindersSupported,
  scheduledReminderCount,
} from '@/lib/notifications'
import { Body, Button, Card, Muted, Row } from './kit'

/**
 * Tenant-facing toggle for local rent reminders. On web (where local
 * scheduling isn't available) it explains that reminders live in the app.
 */
export function RentReminderCard({
  dueDay,
  rentLabel,
  propertyLabel,
}: {
  dueDay: number
  rentLabel: string
  propertyLabel: string
}) {
  const supported = remindersSupported()
  const [count, setCount] = useState(0)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')

  useEffect(() => {
    if (supported) scheduledReminderCount().then(setCount)
  }, [supported])

  async function enable() {
    setBusy(true)
    setMessage('')
    try {
      const result = await enableRentReminders({ dueDay, rentLabel, propertyLabel })
      if (result === 'denied') setMessage('Notifications are turned off for PMAN in your device settings.')
      else if (result === 'scheduled') {
        setMessage("You'll get a reminder around rent time each month.")
        setCount(await scheduledReminderCount())
      }
    } finally {
      setBusy(false)
    }
  }

  async function disable() {
    setBusy(true)
    setMessage('')
    await disableRentReminders()
    setCount(0)
    setBusy(false)
  }

  if (!supported) {
    return (
      <Card>
        <Body bold>Rent reminders</Body>
        <Muted small>Open PMAN on your phone to get a reminder around rent time each month.</Muted>
      </Card>
    )
  }

  const on = count > 0

  return (
    <Card>
      <Row>
        <View style={{ flex: 1, marginRight: 10 }}>
          <Body bold>Rent reminders</Body>
          <Muted small>
            {on ? `On — reminders scheduled around the ${dueDay}${suffix(dueDay)} each month.` : 'Get a heads-up before rent is due each month.'}
          </Muted>
        </View>
        <Button
          title={on ? 'Turn off' : 'Turn on'}
          compact
          variant={on ? 'secondary' : 'primary'}
          loading={busy}
          onPress={on ? disable : enable}
        />
      </Row>
      {message ? (
        <View style={{ marginTop: 6 }}>
          <Muted small>{message}</Muted>
        </View>
      ) : null}
    </Card>
  )
}

function suffix(n: number): string {
  const v = n % 100
  if (v >= 11 && v <= 13) return 'th'
  return ['th', 'st', 'nd', 'rd'][n % 10] ?? 'th'
}

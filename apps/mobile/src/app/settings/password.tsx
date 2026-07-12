import { router } from 'expo-router'
import { useState } from 'react'
import { api, setApiToken } from '@/lib/api'
import { useAuth, type User } from '@/lib/auth'
import { backOr } from '@/lib/nav'
import { Body, Button, Card, ErrorText, Field, Muted, Screen, Spacer } from '@/ui/kit'

export default function ChangePassword() {
  const { refreshToken } = useAuth()
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(false)

  async function submit() {
    setError('')
    if (next.length < 8) return setError('New password must be at least 8 characters.')
    if (next !== confirm) return setError('The new passwords do not match.')
    setBusy(true)
    try {
      // The server rotates every session; it returns a fresh token for THIS
      // device so we stay logged in while other devices are signed out.
      const res = await api<{ token: string; user: User }>('/auth/change-password', {
        method: 'POST',
        body: { currentPassword: current, newPassword: next },
      })
      setApiToken(res.token)
      await refreshToken(res.token, res.user)
      setDone(true)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  if (done) {
    return (
      <Screen>
        <Card style={{ alignItems: 'center', paddingVertical: 24 }}>
          <Body bold style={{ fontSize: 18 }}>Password changed ✅</Body>
          <Muted small>You were signed out on any other devices.</Muted>
        </Card>
        <Button title="Done" onPress={() => backOr('/')} />
      </Screen>
    )
  }

  return (
    <Screen>
      <Muted>Changing your password signs you out everywhere else.</Muted>
      <Spacer h={16} />
      <Field label="Current password" value={current} onChangeText={setCurrent} secureTextEntry />
      <Field label="New password" value={next} onChangeText={setNext} secureTextEntry hint="At least 8 characters." />
      <Field label="Confirm new password" value={confirm} onChangeText={setConfirm} secureTextEntry />
      <ErrorText>{error}</ErrorText>
      <Button title="Change password" onPress={submit} loading={busy} disabled={!current || !next || !confirm} />
      <Button title="Cancel" variant="secondary" onPress={() => router.back()} />
    </Screen>
  )
}

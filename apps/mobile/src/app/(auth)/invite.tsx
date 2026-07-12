import { router } from 'expo-router'
import { useState } from 'react'
import { api } from '@/lib/api'
import { useAuth, type User } from '@/lib/auth'
import { Button, ErrorText, Field, Muted, Screen, Spacer, Title } from '@/ui/kit'

export default function Invite() {
  const { signIn } = useAuth()
  const [code, setCode] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit() {
    setError('')
    setBusy(true)
    try {
      const res = await api<{ token: string; user: User }>('/auth/accept-invite', {
        method: 'POST',
        body: { code: code.trim().toUpperCase(), email: email.trim(), password },
      })
      await signIn(res.token, res.user)
      router.replace('/home')
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Screen>
      <Title>Tenant sign-up</Title>
      <Muted>Enter the invite code your property manager gave you to activate your portal account.</Muted>
      <Spacer h={20} />
      <Field label="Invite code" value={code} onChangeText={setCode} placeholder="e.g. 4F7A2B91" autoCapitalize="none" />
      <Field label="Email" value={email} onChangeText={setEmail} placeholder="you@example.com" keyboardType="email-address" autoCapitalize="none" />
      <Field label="Password" value={password} onChangeText={setPassword} placeholder="At least 8 characters" secureTextEntry />
      <ErrorText>{error}</ErrorText>
      <Button title="Activate account" onPress={submit} loading={busy} disabled={!code || !email || password.length < 8} />
    </Screen>
  )
}

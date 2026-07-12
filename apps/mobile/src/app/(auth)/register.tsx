import { router } from 'expo-router'
import { useState } from 'react'
import { api } from '@/lib/api'
import { useAuth, type User } from '@/lib/auth'
import { Button, ErrorText, Field, Muted, Screen, Spacer, Title } from '@/ui/kit'

export default function Register() {
  const { signIn } = useAuth()
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit() {
    setError('')
    setBusy(true)
    try {
      const res = await api<{ token: string; user: User }>('/auth/register', {
        method: 'POST',
        body: { name: name.trim(), email: email.trim(), password, phone: phone.trim() || undefined },
      })
      await signIn(res.token, res.user)
      router.replace('/dashboard')
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Screen>
      <Title>Create manager account</Title>
      <Muted>Manage properties, leases, rent and tenants.</Muted>
      <Spacer h={20} />
      <Field label="Full name" value={name} onChangeText={setName} placeholder="Riley Morgan" autoCapitalize="words" />
      <Field label="Email" value={email} onChangeText={setEmail} placeholder="you@example.com" keyboardType="email-address" autoCapitalize="none" />
      <Field label="Phone (optional)" value={phone} onChangeText={setPhone} placeholder="555-0100" keyboardType="phone-pad" />
      <Field label="Password" value={password} onChangeText={setPassword} placeholder="At least 8 characters" secureTextEntry />
      <ErrorText>{error}</ErrorText>
      <Button title="Create account" onPress={submit} loading={busy} disabled={!name || !email || password.length < 8} />
    </Screen>
  )
}

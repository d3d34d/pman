import { router } from 'expo-router'
import { useState } from 'react'
import { api } from '@/lib/api'
import { useAuth, type User } from '@/lib/auth'
import { backOr } from '@/lib/nav'
import { Button, ErrorText, Field, Muted, Screen, Spacer } from '@/ui/kit'

export default function EditProfile() {
  const { user, updateUser } = useAuth()
  const [name, setName] = useState(user?.name ?? '')
  const [email, setEmail] = useState(user?.email ?? '')
  const [phone, setPhone] = useState(user?.phone ?? '')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit() {
    setError('')
    if (!name.trim()) return setError('Name is required.')
    setBusy(true)
    try {
      const res = await api<{ user: User }>('/me', {
        method: 'PATCH',
        body: { name: name.trim(), email: email.trim(), phone: phone.trim() || null },
      })
      await updateUser(res.user)
      backOr('/')
    } catch (e) {
      setError((e as Error).message)
      setBusy(false)
    }
  }

  return (
    <Screen>
      <Muted>Update your account details.</Muted>
      <Spacer h={16} />
      <Field label="Full name" value={name} onChangeText={setName} autoCapitalize="words" />
      <Field label="Email" value={email} onChangeText={setEmail} keyboardType="email-address" autoCapitalize="none" />
      <Field label="Phone" value={phone} onChangeText={setPhone} keyboardType="phone-pad" />
      <ErrorText>{error}</ErrorText>
      <Button title="Save changes" onPress={submit} loading={busy} disabled={!name.trim()} />
      <Button title="Cancel" variant="secondary" onPress={() => router.back()} />
    </Screen>
  )
}

import { router } from 'expo-router'
import { useState } from 'react'
import { api } from '@/lib/api'
import { useAuth } from '@/lib/auth'
import { colors } from '@/lib/theme'
import { Body, Button, Card, ErrorText, Field, Muted, Screen, Spacer } from '@/ui/kit'

export default function DeleteAccount() {
  const { user, signOut } = useAuth()
  const isManager = user?.role === 'MANAGER'
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit() {
    setError('')
    if (confirm.trim().toUpperCase() !== 'DELETE') return setError('Type DELETE to confirm.')
    setBusy(true)
    try {
      await api('/auth/delete-account', { method: 'POST', body: { password } })
      await signOut()
      router.replace('/welcome')
    } catch (e) {
      setError((e as Error).message)
      setBusy(false)
    }
  }

  return (
    <Screen>
      <Card style={{ backgroundColor: colors.redSoft, borderColor: 'transparent' }}>
        <Body bold style={{ color: colors.red }}>This permanently deletes your account.</Body>
        <Spacer h={6} />
        <Muted small>
          {isManager
            ? 'Everything you manage — properties, units, leases, tenants, payment history and documents — is permanently removed. This cannot be undone.'
            : 'Your login, saved cards and messages are permanently removed. Your rent history stays with your property manager as their record. This cannot be undone.'}
        </Muted>
      </Card>

      <Spacer h={10} />
      <Field label="Your password" value={password} onChangeText={setPassword} secureTextEntry />
      <Field label={'Type DELETE to confirm'} value={confirm} onChangeText={setConfirm} autoCapitalize="none" placeholder="DELETE" />
      <ErrorText>{error}</ErrorText>
      <Button
        title="Permanently delete my account"
        variant="danger"
        onPress={submit}
        loading={busy}
        disabled={!password || confirm.trim().toUpperCase() !== 'DELETE'}
      />
      <Button title="Cancel" variant="secondary" onPress={() => router.back()} />
    </Screen>
  )
}

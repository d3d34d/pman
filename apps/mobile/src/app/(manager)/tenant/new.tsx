import { useQueryClient } from '@tanstack/react-query'
import { router } from 'expo-router'
import { useState } from 'react'
import { api } from '@/lib/api'
import { Button, ErrorText, Field, Screen } from '@/ui/kit'

export default function NewTenant() {
  const qc = useQueryClient()
  const [fullName, setFullName] = useState('')
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [emergencyName, setEmergencyName] = useState('')
  const [emergencyPhone, setEmergencyPhone] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit() {
    setError('')
    setBusy(true)
    try {
      const res = await api<{ tenant: { id: string } }>('/tenants', {
        method: 'POST',
        body: {
          fullName: fullName.trim(),
          email: email.trim() || undefined,
          phone: phone.trim() || undefined,
          emergencyName: emergencyName.trim() || undefined,
          emergencyPhone: emergencyPhone.trim() || undefined,
        },
      })
      qc.invalidateQueries()
      router.replace(`/tenant/${res.tenant.id}`)
    } catch (e) {
      setError((e as Error).message)
      setBusy(false)
    }
  }

  return (
    <Screen>
      <Field label="Full name" value={fullName} onChangeText={setFullName} placeholder="Jane Doe" autoCapitalize="words" />
      <Field label="Email (optional)" value={email} onChangeText={setEmail} keyboardType="email-address" autoCapitalize="none" placeholder="jane@example.com" />
      <Field label="Phone (optional)" value={phone} onChangeText={setPhone} keyboardType="phone-pad" placeholder="555-0100" />
      <Field label="Emergency contact name (optional)" value={emergencyName} onChangeText={setEmergencyName} autoCapitalize="words" />
      <Field label="Emergency contact phone (optional)" value={emergencyPhone} onChangeText={setEmergencyPhone} keyboardType="phone-pad" />
      <ErrorText>{error}</ErrorText>
      <Button title="Add tenant" onPress={submit} loading={busy} disabled={!fullName.trim()} />
    </Screen>
  )
}

import { useQuery, useQueryClient } from '@tanstack/react-query'
import { router, useLocalSearchParams } from 'expo-router'
import { useEffect, useState } from 'react'
import { api } from '@/lib/api'
import { Button, ErrorText, Field, Loading, Screen } from '@/ui/kit'

type TenantDetail = {
  tenant: { fullName: string; email: string | null; phone: string | null; emergencyName: string | null; emergencyPhone: string | null }
}

export default function EditTenant() {
  const { id } = useLocalSearchParams<{ id: string }>()
  const qc = useQueryClient()
  const { data } = useQuery({ queryKey: ['tenant', id], queryFn: () => api<TenantDetail>(`/tenants/${id}`) })

  const [fullName, setFullName] = useState('')
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [emergencyName, setEmergencyName] = useState('')
  const [emergencyPhone, setEmergencyPhone] = useState('')
  const [loaded, setLoaded] = useState(false)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (data && !loaded) {
      setFullName(data.tenant.fullName)
      setEmail(data.tenant.email ?? '')
      setPhone(data.tenant.phone ?? '')
      setEmergencyName(data.tenant.emergencyName ?? '')
      setEmergencyPhone(data.tenant.emergencyPhone ?? '')
      setLoaded(true)
    }
  }, [data, loaded])

  if (!loaded) return <Screen><Loading /></Screen>

  async function submit() {
    setError('')
    setBusy(true)
    try {
      await api(`/tenants/${id}`, {
        method: 'PATCH',
        body: {
          fullName: fullName.trim(),
          email: email.trim(),
          phone: phone.trim() || undefined,
          emergencyName: emergencyName.trim() || undefined,
          emergencyPhone: emergencyPhone.trim() || undefined,
        },
      })
      qc.invalidateQueries()
      router.back()
    } catch (e) {
      setError((e as Error).message)
      setBusy(false)
    }
  }

  return (
    <Screen>
      <Field label="Full name" value={fullName} onChangeText={setFullName} autoCapitalize="words" />
      <Field label="Email" value={email} onChangeText={setEmail} keyboardType="email-address" autoCapitalize="none" />
      <Field label="Phone" value={phone} onChangeText={setPhone} keyboardType="phone-pad" />
      <Field label="Emergency contact name" value={emergencyName} onChangeText={setEmergencyName} autoCapitalize="words" />
      <Field label="Emergency contact phone" value={emergencyPhone} onChangeText={setEmergencyPhone} keyboardType="phone-pad" />
      <ErrorText>{error}</ErrorText>
      <Button title="Save changes" onPress={submit} loading={busy} disabled={!fullName.trim()} />
    </Screen>
  )
}

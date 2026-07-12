import { useQuery, useQueryClient } from '@tanstack/react-query'
import { router } from 'expo-router'
import { useState } from 'react'
import { api } from '@/lib/api'
import { Button, ErrorText, Field, Loading, Screen, SectionHeader, Segment } from '@/ui/kit'

type Properties = { properties: { id: string; name: string }[] }
type PropertyDetail = { units: { id: string; label: string }[] }

const PRIORITIES = ['LOW', 'NORMAL', 'HIGH', 'URGENT'] as const

export default function NewMaintenance() {
  const qc = useQueryClient()
  const [propertyId, setPropertyId] = useState('')
  const [unitId, setUnitId] = useState('')
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [priority, setPriority] = useState<(typeof PRIORITIES)[number]>('NORMAL')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const properties = useQuery({ queryKey: ['properties'], queryFn: () => api<Properties>('/properties') })
  const propertyDetail = useQuery({
    queryKey: ['property', propertyId],
    queryFn: () => api<PropertyDetail>(`/properties/${propertyId}`),
    enabled: !!propertyId,
  })

  async function submit() {
    setError('')
    setBusy(true)
    try {
      await api('/maintenance', {
        method: 'POST',
        body: { unitId, title: title.trim(), description: description.trim(), priority },
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
      <SectionHeader title="Where" />
      {!properties.data ? (
        <Loading />
      ) : (
        <Segment
          options={properties.data.properties.map((p) => p.id) as unknown as readonly string[]}
          value={propertyId}
          onChange={(id) => {
            setPropertyId(id)
            setUnitId('')
          }}
          labels={Object.fromEntries(properties.data.properties.map((p) => [p.id, p.name]))}
        />
      )}
      {propertyId && propertyDetail.data && (
        <Segment
          options={propertyDetail.data.units.map((u) => u.id) as unknown as readonly string[]}
          value={unitId}
          onChange={setUnitId}
          labels={Object.fromEntries(propertyDetail.data.units.map((u) => [u.id, u.label]))}
        />
      )}

      <SectionHeader title="What" />
      <Field label="Title" value={title} onChangeText={setTitle} placeholder="Leaking faucet" />
      <Field label="Details" value={description} onChangeText={setDescription} multiline placeholder="What's wrong, where, since when…" />
      <Segment label="Priority" options={PRIORITIES} value={priority} onChange={setPriority} />
      <ErrorText>{error}</ErrorText>
      <Button title="Create request" onPress={submit} loading={busy} disabled={!unitId || !title.trim() || !description.trim()} />
    </Screen>
  )
}

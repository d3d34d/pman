import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Stack, useLocalSearchParams } from 'expo-router'
import { useState } from 'react'
import { Image, View } from 'react-native'
import { api, getBaseUrl } from '@/lib/api'
import { fmtDate } from '@/lib/dates'
import { fmtMoney, parseMoney } from '@/lib/money'
import { Body, Button, Card, Chip, ErrorText, Field, KeyValue, Loading, Muted, Row, Screen, SectionHeader, Segment } from '@/ui/kit'

type Requests = {
  requests: {
    id: string
    title: string
    description: string
    status: string
    priority: string
    vendorName: string | null
    costCents: number | null
    createdAt: string
    resolvedAt: string | null
    unit: { label: string; property: { id: string; name: string } }
    createdBy: { name: string; role: string }
  }[]
}

type Documents = { documents: { id: string; filename: string; url: string; mimeType: string | null }[] }

const STATUSES = ['OPEN', 'IN_PROGRESS', 'RESOLVED'] as const
const PRIORITIES = ['LOW', 'NORMAL', 'HIGH', 'URGENT'] as const

export default function MaintenanceDetail() {
  const { id } = useLocalSearchParams<{ id: string }>()
  const qc = useQueryClient()
  const [vendor, setVendor] = useState('')
  const [cost, setCost] = useState('')
  const [error, setError] = useState('')

  const { data } = useQuery({
    queryKey: ['maintenance', 'ALL'],
    queryFn: () => api<Requests>('/maintenance'),
  })
  const photos = useQuery({
    queryKey: ['documents', 'MAINTENANCE', id],
    queryFn: () => api<Documents>(`/documents?ownerType=MAINTENANCE&ownerId=${id}`),
  })

  const update = useMutation({
    mutationFn: (body: object) => api(`/maintenance/${id}`, { method: 'PATCH', body }),
    onSuccess: () => qc.invalidateQueries(),
    onError: (e) => setError((e as Error).message),
  })

  const request = data?.requests.find((r) => r.id === id)
  if (!request) return <Screen><Loading /></Screen>

  return (
    <Screen>
      <Stack.Screen options={{ title: request.title }} />
      <Card>
        <Row>
          <Body bold style={{ fontSize: 17, flex: 1, marginRight: 8 }}>{request.title}</Body>
          <Chip status={request.status} />
        </Row>
        <Muted small>
          {request.unit.property.name} · {request.unit.label} · opened {fmtDate(request.createdAt)} by{' '}
          {request.createdBy.role === 'TENANT' ? `${request.createdBy.name} (tenant)` : request.createdBy.name}
        </Muted>
        <View style={{ height: 8 }} />
        <Body>{request.description}</Body>
        {request.vendorName ? <KeyValue k="Vendor" v={request.vendorName} /> : null}
        {request.costCents != null ? <KeyValue k="Cost" v={fmtMoney(request.costCents)} /> : null}
        {request.resolvedAt ? <KeyValue k="Resolved" v={fmtDate(request.resolvedAt)} /> : null}
      </Card>

      {photos.data && photos.data.documents.length > 0 && (
        <>
          <SectionHeader title="Photos" />
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            {photos.data.documents.map((d) => (
              <Image
                key={d.id}
                source={{ uri: `${getBaseUrl()}${d.url}` }}
                style={{ width: 110, height: 110, borderRadius: 10 }}
              />
            ))}
          </View>
        </>
      )}

      <SectionHeader title="Update status" />
      <Segment options={STATUSES} value={request.status as (typeof STATUSES)[number]} onChange={(s) => update.mutate({ status: s })} />
      <Segment label="Priority" options={PRIORITIES} value={request.priority as (typeof PRIORITIES)[number]} onChange={(p) => update.mutate({ priority: p })} />

      <SectionHeader title="Vendor & cost" />
      <Field label="Vendor" value={vendor || (request.vendorName ?? '')} onChangeText={setVendor} placeholder="SafeHome Services" />
      <Field label="Cost" value={cost} onChangeText={setCost} keyboardType="decimal-pad" placeholder={request.costCents != null ? (request.costCents / 100).toFixed(2) : '150'} />
      <ErrorText>{error}</ErrorText>
      <Button
        title="Save vendor / cost"
        variant="secondary"
        loading={update.isPending}
        onPress={() => {
          const body: Record<string, unknown> = {}
          if (vendor.trim()) body.vendorName = vendor.trim()
          if (cost.trim()) {
            const cents = parseMoney(cost)
            if (cents === null) return setError('Cost must be a dollar amount')
            body.costCents = cents
          }
          if (Object.keys(body).length > 0) update.mutate(body)
        }}
      />
    </Screen>
  )
}

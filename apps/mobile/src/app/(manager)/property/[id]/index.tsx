import { useQuery } from '@tanstack/react-query'
import { router, Stack, useLocalSearchParams } from 'expo-router'
import { api } from '@/lib/api'
import { fmtMoney } from '@/lib/money'
import { Button, Card, Chip, EmptyState, ListRow, Loading, Muted, Row, Screen, SectionHeader, Body } from '@/ui/kit'
import { DocumentsSection } from '@/ui/documents'

type PropertyDetail = {
  property: { id: string; name: string; address: string; type: string | null; notes: string | null }
  units: {
    id: string
    label: string
    bedrooms: number | null
    bathrooms: number | null
    sqft: number | null
    marketRentCents: number | null
    occupied: boolean
    currentLease: { id: string; status: string; tenants: { id: string; fullName: string }[] } | null
  }[]
}

export default function PropertyScreen() {
  const { id } = useLocalSearchParams<{ id: string }>()
  const { data, isLoading } = useQuery({
    queryKey: ['property', id],
    queryFn: () => api<PropertyDetail>(`/properties/${id}`),
  })

  if (isLoading || !data) return <Screen><Loading /></Screen>
  const { property, units } = data

  return (
    <Screen>
      <Stack.Screen options={{ title: property.name }} />
      <Card>
        <Body bold style={{ fontSize: 17 }}>{property.name}</Body>
        <Muted>{property.address}</Muted>
        {property.type ? <Muted small>{property.type}</Muted> : null}
        {property.notes ? <Muted small>{property.notes}</Muted> : null}
      </Card>

      <Row style={{ gap: 8 }}>
        <Button title="+ Add unit" compact variant="secondary" onPress={() => router.push(`/property/${property.id}/add-unit`)} />
        <Button title="Announce" compact variant="secondary" onPress={() => router.push(`/property/${property.id}/announce`)} />
      </Row>

      <SectionHeader title={`Units (${units.length})`} />
      {units.length === 0 ? (
        <EmptyState title="No units yet" hint="Add units like “Apt 1A” or “Left side”." />
      ) : (
        units.map((u) => (
          <ListRow
            key={u.id}
            title={u.label}
            subtitle={
              u.currentLease
                ? u.currentLease.tenants.map((t) => t.fullName).join(', ')
                : [u.bedrooms != null ? `${u.bedrooms} bd` : null, u.bathrooms != null ? `${u.bathrooms} ba` : null, u.marketRentCents ? `${fmtMoney(u.marketRentCents)}/mo market` : null]
                    .filter(Boolean)
                    .join(' · ') || 'Vacant'
            }
            right={<Chip status={u.occupied ? 'OCCUPIED' : 'VACANT'} />}
            onPress={() => router.push(`/unit/${u.id}`)}
          />
        ))
      )}

      <DocumentsSection ownerType="PROPERTY" ownerId={property.id} title="Property documents" />
    </Screen>
  )
}

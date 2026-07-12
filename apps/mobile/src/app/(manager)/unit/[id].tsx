import { useQuery } from '@tanstack/react-query'
import { router, Stack, useLocalSearchParams } from 'expo-router'
import { api } from '@/lib/api'
import { fmtDate } from '@/lib/dates'
import { fmtMoney } from '@/lib/money'
import { Body, Button, Card, Chip, EmptyState, KeyValue, ListRow, Loading, Muted, Screen, SectionHeader } from '@/ui/kit'

type UnitDetail = {
  unit: {
    id: string
    label: string
    bedrooms: number | null
    bathrooms: number | null
    sqft: number | null
    marketRentCents: number | null
    notes: string | null
    property: { id: string; name: string }
  }
  leases: {
    id: string
    status: string
    startDate: string
    endDate: string | null
    tenants: { tenant: { id: string; fullName: string } }[]
    rentTerms: { amountCents: number; effectiveFrom: string }[]
  }[]
}

export default function UnitScreen() {
  const { id } = useLocalSearchParams<{ id: string }>()
  const { data, isLoading } = useQuery({ queryKey: ['unit', id], queryFn: () => api<UnitDetail>(`/units/${id}`) })

  if (isLoading || !data) return <Screen><Loading /></Screen>
  const { unit, leases } = data
  const activeLease = leases.find((l) => l.status === 'ACTIVE' || l.status === 'MONTH_TO_MONTH')

  return (
    <Screen>
      <Stack.Screen options={{ title: `${unit.property.name} · ${unit.label}` }} />
      <Card>
        <Body bold style={{ fontSize: 17 }}>{unit.label}</Body>
        <Muted>{unit.property.name}</Muted>
        {unit.bedrooms != null || unit.bathrooms != null || unit.sqft != null ? (
          <Muted small>
            {[unit.bedrooms != null ? `${unit.bedrooms} bd` : null, unit.bathrooms != null ? `${unit.bathrooms} ba` : null, unit.sqft ? `${unit.sqft} sqft` : null]
              .filter(Boolean)
              .join(' · ')}
          </Muted>
        ) : null}
        {unit.marketRentCents ? <KeyValue k="Market rent" v={`${fmtMoney(unit.marketRentCents)}/mo`} /> : null}
      </Card>

      {!activeLease && (
        <Button title="+ Create lease for this unit" onPress={() => router.push(`/lease/new?unitId=${unit.id}`)} />
      )}

      <SectionHeader title="Lease history" />
      {leases.length === 0 ? (
        <EmptyState title="Never leased" hint="Create a lease to move a tenant in." />
      ) : (
        leases.map((l) => {
          const latestRent = [...l.rentTerms].sort((a, b) => a.effectiveFrom.localeCompare(b.effectiveFrom)).at(-1)
          return (
            <ListRow
              key={l.id}
              title={l.tenants.map((t) => t.tenant.fullName).join(', ') || '—'}
              subtitle={`${fmtDate(l.startDate)} → ${l.endDate ? fmtDate(l.endDate) : 'open'}${latestRent ? ` · ${fmtMoney(latestRent.amountCents)}/mo` : ''}`}
              right={<Chip status={l.status} />}
              onPress={() => router.push(`/lease/${l.id}`)}
            />
          )
        })
      )}
    </Screen>
  )
}

import { useQuery } from '@tanstack/react-query'
import { router } from 'expo-router'
import { View } from 'react-native'
import { api } from '@/lib/api'
import { useAuth } from '@/lib/auth'
import { fmtDate, periodLabel } from '@/lib/dates'
import { fmtMoney } from '@/lib/money'
import { Chip, EmptyState, ErrorText, ListRow, Loading, Muted, Screen, SectionHeader, StatTile, Subtitle, Title } from '@/ui/kit'

type Dashboard = {
  period: string
  occupancy: { totalUnits: number; occupiedUnits: number }
  rent: { dueCents: number; collectedCents: number; outstandingCents: number }
  overdue: { leaseId: string; unitLabel: string; propertyName: string; tenants: string; balanceCents: number; status: string }[]
  expiringLeases: { leaseId: string; unitLabel: string; propertyName: string; tenants: string; endDate: string }[]
  openMaintenanceCount: number
  pendingSubmissionsCount: number
}

export default function DashboardScreen() {
  const { user } = useAuth()
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['dashboard'],
    queryFn: () => api<Dashboard>('/dashboard'),
  })

  if (isLoading) return <Screen><Loading /></Screen>
  if (error || !data) {
    return (
      <Screen>
        <ErrorText>{(error as Error)?.message ?? 'Failed to load'}</ErrorText>
        <EmptyState title="Could not load dashboard" hint="Is the API server running? Pull to retry from another tab." />
      </Screen>
    )
  }

  const occupancyPct = data.occupancy.totalUnits
    ? Math.round((data.occupancy.occupiedUnits / data.occupancy.totalUnits) * 100)
    : 0

  return (
    <Screen>
      <Title>Hi {user?.name.split(' ')[0]}</Title>
      <Subtitle>{periodLabel(data.period)} at a glance</Subtitle>

      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
        <StatTile
          label="Occupancy"
          value={`${occupancyPct}%`}
          sub={`${data.occupancy.occupiedUnits} of ${data.occupancy.totalUnits} units`}
          tone={occupancyPct >= 90 ? 'PAID' : occupancyPct >= 70 ? 'PARTIAL' : 'LATE'}
        />
        <StatTile
          label="Rent collected"
          value={fmtMoney(data.rent.collectedCents)}
          sub={`of ${fmtMoney(data.rent.dueCents)} due`}
          tone={data.rent.outstandingCents === 0 ? 'PAID' : 'PARTIAL'}
        />
        <StatTile
          label="Outstanding"
          value={fmtMoney(data.rent.outstandingCents)}
          sub="this month"
          tone={data.rent.outstandingCents === 0 ? 'PAID' : 'LATE'}
        />
        <StatTile label="Open maintenance" value={String(data.openMaintenanceCount)} sub="requests" tone={data.openMaintenanceCount === 0 ? 'PAID' : 'UNPAID'} />
        <StatTile label="Payments to review" value={String(data.pendingSubmissionsCount)} sub="submitted" tone={data.pendingSubmissionsCount === 0 ? 'PAID' : 'UNPAID'} />
      </View>

      {data.pendingSubmissionsCount > 0 && (
        <ListRow
          title={`${data.pendingSubmissionsCount} payment${data.pendingSubmissionsCount === 1 ? '' : 's'} awaiting your review`}
          subtitle="Tenants submitted proof — approve to record them"
          right={<Chip status="UPCOMING" label="Review" />}
          onPress={() => router.push('/payment-approvals')}
        />
      )}

      <SectionHeader title="Owes money" />
      {data.overdue.length === 0 ? (
        <EmptyState title="Everyone is paid up 🎉" />
      ) : (
        data.overdue.map((o) => (
          <ListRow
            key={o.leaseId}
            title={`${o.tenants}`}
            subtitle={`${o.propertyName} · ${o.unitLabel}`}
            right={
              <View style={{ alignItems: 'flex-end', gap: 4 }}>
                <Muted small>{fmtMoney(o.balanceCents)}</Muted>
                <Chip status={o.status} />
              </View>
            }
            onPress={() => router.push(`/lease/${o.leaseId}`)}
          />
        ))
      )}

      <SectionHeader title="Leases ending soon" />
      {data.expiringLeases.length === 0 ? (
        <EmptyState title="No leases expiring in the next 90 days" />
      ) : (
        data.expiringLeases.map((l) => (
          <ListRow
            key={l.leaseId}
            title={l.tenants}
            subtitle={`${l.propertyName} · ${l.unitLabel}`}
            right={<Muted small>ends {fmtDate(l.endDate)}</Muted>}
            onPress={() => router.push(`/lease/${l.leaseId}`)}
          />
        ))
      )}
    </Screen>
  )
}

import { useQuery } from '@tanstack/react-query'
import { router } from 'expo-router'
import { useState } from 'react'
import { api } from '@/lib/api'
import { fmtDate } from '@/lib/dates'
import { fmtMoney } from '@/lib/money'
import { Button, Chip, EmptyState, ListRow, Loading, Row, Screen, Segment } from '@/ui/kit'

type Leases = {
  leases: {
    id: string
    status: string
    startDate: string
    endDate: string | null
    unit: { label: string }
    property: { name: string }
    tenants: { fullName: string }[]
    currentRentCents: number | null
  }[]
}

const FILTERS = ['ALL', 'ACTIVE', 'MONTH_TO_MONTH', 'ENDED'] as const

export default function LeasesScreen() {
  const [filter, setFilter] = useState<(typeof FILTERS)[number]>('ALL')
  const { data, isLoading } = useQuery({
    queryKey: ['leases', filter],
    queryFn: () => api<Leases>(filter === 'ALL' ? '/leases' : `/leases?status=${filter}`),
  })

  return (
    <Screen>
      <Row style={{ marginBottom: 12, flexWrap: 'wrap', gap: 8 }}>
        <Segment options={FILTERS} value={filter} onChange={setFilter} labels={{ ALL: 'All', ACTIVE: 'Active', MONTH_TO_MONTH: 'M2M', ENDED: 'Ended' }} />
        <Button title="+ New lease" compact onPress={() => router.push('/lease/new')} />
      </Row>

      {isLoading || !data ? (
        <Loading />
      ) : data.leases.length === 0 ? (
        <EmptyState title="No leases" hint="Create one from a vacant unit or with the button above." />
      ) : (
        data.leases.map((l) => (
          <ListRow
            key={l.id}
            title={l.tenants.map((t) => t.fullName).join(', ') || '—'}
            subtitle={`${l.property.name} · ${l.unit.label} · ${l.currentRentCents != null ? `${fmtMoney(l.currentRentCents)}/mo · ` : ''}${fmtDate(l.startDate)} → ${l.endDate ? fmtDate(l.endDate) : 'open'}`}
            right={<Chip status={l.status} />}
            onPress={() => router.push(`/lease/${l.id}`)}
          />
        ))
      )}
    </Screen>
  )
}

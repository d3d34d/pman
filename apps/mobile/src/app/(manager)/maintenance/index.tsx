import { useQuery } from '@tanstack/react-query'
import { router } from 'expo-router'
import { useState } from 'react'
import { View } from 'react-native'
import { api } from '@/lib/api'
import { fmtDate } from '@/lib/dates'
import { Button, Chip, EmptyState, ListRow, Loading, Row, Screen, Segment } from '@/ui/kit'

type Requests = {
  requests: {
    id: string
    title: string
    status: string
    priority: string
    createdAt: string
    unit: { label: string; property: { name: string } }
    createdBy: { name: string; role: string }
  }[]
}

const FILTERS = ['ALL', 'OPEN', 'IN_PROGRESS', 'RESOLVED'] as const

export default function MaintenanceScreen() {
  const [filter, setFilter] = useState<(typeof FILTERS)[number]>('ALL')
  const { data, isLoading } = useQuery({
    queryKey: ['maintenance', filter],
    queryFn: () => api<Requests>(filter === 'ALL' ? '/maintenance' : `/maintenance?status=${filter}`),
  })

  return (
    <Screen>
      <Row style={{ marginBottom: 12, flexWrap: 'wrap', gap: 8 }}>
        <Segment options={FILTERS} value={filter} onChange={setFilter} labels={{ ALL: 'All', OPEN: 'Open', IN_PROGRESS: 'In progress', RESOLVED: 'Resolved' }} />
        <Button title="+ New" compact onPress={() => router.push('/maintenance/new')} />
      </Row>

      {isLoading || !data ? (
        <Loading />
      ) : data.requests.length === 0 ? (
        <EmptyState title="No maintenance requests" />
      ) : (
        data.requests.map((r) => (
          <ListRow
            key={r.id}
            title={r.title}
            subtitle={`${r.unit.property.name} · ${r.unit.label} · ${fmtDate(r.createdAt)} · by ${r.createdBy.role === 'TENANT' ? `${r.createdBy.name} (tenant)` : r.createdBy.name}`}
            right={
              <View style={{ alignItems: 'flex-end', gap: 4 }}>
                <Chip status={r.status} />
                {r.priority !== 'NORMAL' && <Chip status={r.priority} />}
              </View>
            }
            onPress={() => router.push(`/maintenance/${r.id}`)}
          />
        ))
      )}
    </Screen>
  )
}

import { useQuery } from '@tanstack/react-query'
import { router } from 'expo-router'
import { View } from 'react-native'
import { api } from '@/lib/api'
import { fmtDate } from '@/lib/dates'
import { Button, Chip, EmptyState, ListRow, Loading, Muted, Row, Screen } from '@/ui/kit'

type Requests = {
  requests: {
    id: string
    title: string
    description: string
    status: string
    priority: string
    createdAt: string
    unit: { label: string; property: { name: string } }
  }[]
}

export default function TenantRequests() {
  const { data, isLoading } = useQuery({ queryKey: ['portal-maintenance'], queryFn: () => api<Requests>('/portal/maintenance') })

  return (
    <Screen>
      <Row style={{ marginBottom: 12 }}>
        <Muted>Maintenance requests</Muted>
        <Button title="+ New request" compact onPress={() => router.push('/request-new')} />
      </Row>

      {isLoading || !data ? (
        <Loading />
      ) : data.requests.length === 0 ? (
        <EmptyState title="No requests yet" hint="Something broken? Send your manager a request with photos." />
      ) : (
        data.requests.map((r) => (
          <ListRow
            key={r.id}
            title={r.title}
            subtitle={`${fmtDate(r.createdAt)} · ${r.description.slice(0, 60)}${r.description.length > 60 ? '…' : ''}`}
            right={
              <View style={{ alignItems: 'flex-end', gap: 4 }}>
                <Chip status={r.status} />
                {r.priority !== 'NORMAL' && <Chip status={r.priority} />}
              </View>
            }
          />
        ))
      )}
    </Screen>
  )
}

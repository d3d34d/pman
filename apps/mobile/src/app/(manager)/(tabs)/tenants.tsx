import { useQuery } from '@tanstack/react-query'
import { router } from 'expo-router'
import { useState } from 'react'
import { api } from '@/lib/api'
import { Button, Chip, EmptyState, ListRow, Loading, Row, Screen, Segment } from '@/ui/kit'

type Tenants = {
  tenants: {
    id: string
    fullName: string
    email: string | null
    phone: string | null
    status: string
    hasPortalAccount: boolean
    activeLease: { id: string; unitLabel: string; propertyName: string } | null
  }[]
}

export default function TenantsScreen() {
  const [filter, setFilter] = useState<'ACTIVE' | 'FORMER'>('ACTIVE')
  const { data, isLoading } = useQuery({
    queryKey: ['tenants', filter],
    queryFn: () => api<Tenants>(`/tenants?status=${filter}`),
  })

  return (
    <Screen>
      <Row style={{ marginBottom: 12 }}>
        <Segment options={['ACTIVE', 'FORMER'] as const} value={filter} onChange={setFilter} labels={{ ACTIVE: 'Current', FORMER: 'Former' }} />
        <Button title="+ Add tenant" compact onPress={() => router.push('/tenant/new')} />
      </Row>

      {isLoading || !data ? (
        <Loading />
      ) : data.tenants.length === 0 ? (
        <EmptyState
          title={filter === 'ACTIVE' ? 'No tenants yet' : 'No former tenants'}
          hint={filter === 'ACTIVE' ? 'Add a tenant, then create a lease to move them in.' : undefined}
        />
      ) : (
        data.tenants.map((t) => (
          <ListRow
            key={t.id}
            title={t.fullName}
            subtitle={
              t.activeLease
                ? `${t.activeLease.propertyName} · ${t.activeLease.unitLabel}`
                : (t.phone ?? t.email ?? 'No active lease')
            }
            right={t.hasPortalAccount ? <Chip status="ACTIVE" label="Portal" /> : undefined}
            onPress={() => router.push(`/tenant/${t.id}`)}
          />
        ))
      )}
    </Screen>
  )
}

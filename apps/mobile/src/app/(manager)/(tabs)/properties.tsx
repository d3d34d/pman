import { useQuery } from '@tanstack/react-query'
import { router } from 'expo-router'
import { api } from '@/lib/api'
import { Button, Chip, EmptyState, ListRow, Loading, Row, Screen } from '@/ui/kit'

type Properties = {
  properties: { id: string; name: string; address: string; type: string | null; unitCount: number; occupiedCount: number }[]
}

export default function PropertiesScreen() {
  const { data, isLoading } = useQuery({ queryKey: ['properties'], queryFn: () => api<Properties>('/properties') })

  return (
    <Screen>
      <Row style={{ marginBottom: 12 }}>
        <Chip status="OCCUPIED" label={`${data?.properties.reduce((s, p) => s + p.occupiedCount, 0) ?? 0} occupied`} />
        <Button title="+ Add property" compact onPress={() => router.push('/property/new')} />
      </Row>

      {isLoading || !data ? (
        <Loading />
      ) : data.properties.length === 0 ? (
        <EmptyState title="No properties yet" hint="Add your first property to start tracking units and leases." />
      ) : (
        data.properties.map((p) => (
          <ListRow
            key={p.id}
            title={p.name}
            subtitle={`${p.address}${p.type ? ` · ${p.type}` : ''}`}
            right={<Chip status={p.occupiedCount === p.unitCount && p.unitCount > 0 ? 'OCCUPIED' : 'VACANT'} label={`${p.occupiedCount}/${p.unitCount} occupied`} />}
            onPress={() => router.push(`/property/${p.id}`)}
          />
        ))
      )}
    </Screen>
  )
}

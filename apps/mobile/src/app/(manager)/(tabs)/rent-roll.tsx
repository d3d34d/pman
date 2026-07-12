import { useQuery } from '@tanstack/react-query'
import { router } from 'expo-router'
import { useState } from 'react'
import { View } from 'react-native'
import { api } from '@/lib/api'
import { addPeriods, currentPeriod, periodLabel } from '@/lib/dates'
import { fmtMoney } from '@/lib/money'
import { Card, Chip, EmptyState, ListRow, Loading, MonthStepper, Muted, Row, Screen, Body } from '@/ui/kit'

type RentRoll = {
  period: string
  rows: {
    lease: { id: string; unit: { label: string }; property: { name: string }; tenants: { id: string; fullName: string }[] }
    status: string
    dueCents: number
    paidCents: number
    balanceCents: number
  }[]
  totals: { dueCents: number; paidCents: number }
}

export default function RentRollScreen() {
  const [period, setPeriod] = useState(currentPeriod())
  const { data, isLoading } = useQuery({
    queryKey: ['rent-roll', period],
    queryFn: () => api<RentRoll>(`/rent-roll?period=${period}`),
  })

  return (
    <Screen>
      <MonthStepper label={periodLabel(period)} onPrev={() => setPeriod((p) => addPeriods(p, -1))} onNext={() => setPeriod((p) => addPeriods(p, 1))} />

      {isLoading || !data ? (
        <Loading />
      ) : (
        <>
          <Card>
            <Row>
              <View>
                <Muted small>Collected</Muted>
                <Body bold style={{ fontSize: 18 }}>{fmtMoney(data.totals.paidCents)}</Body>
              </View>
              <View style={{ alignItems: 'flex-end' }}>
                <Muted small>Billed</Muted>
                <Body bold style={{ fontSize: 18 }}>{fmtMoney(data.totals.dueCents)}</Body>
              </View>
            </Row>
          </Card>

          {data.rows.length === 0 ? (
            <EmptyState title="No active leases this month" hint="Create a lease from a property's unit." />
          ) : (
            data.rows.map((r) => (
              <ListRow
                key={r.lease.id}
                title={r.lease.tenants.map((t) => t.fullName).join(', ') || '—'}
                subtitle={`${r.lease.property.name} · ${r.lease.unit.label}  ·  ${fmtMoney(r.paidCents)} of ${fmtMoney(r.dueCents)}`}
                right={<Chip status={r.status} />}
                onPress={() => router.push(`/lease/${r.lease.id}`)}
              />
            ))
          )}
        </>
      )}
    </Screen>
  )
}

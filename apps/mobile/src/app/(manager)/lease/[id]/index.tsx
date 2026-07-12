import { useQuery } from '@tanstack/react-query'
import { router, Stack, useLocalSearchParams } from 'expo-router'
import { View } from 'react-native'
import { api } from '@/lib/api'
import { fmtDate, periodLabel } from '@/lib/dates'
import { fmtMoney } from '@/lib/money'
import { colors } from '@/lib/theme'
import { Body, Button, Card, Chip, KeyValue, Loading, Muted, Row, Screen, SectionHeader } from '@/ui/kit'
import { DocumentsSection } from '@/ui/documents'

type LeaseDetail = {
  lease: {
    id: string
    status: string
    startDate: string
    endDate: string | null
    dueDay: number
    unit: { id: string; label: string }
    property: { id: string; name: string }
    tenants: { id: string; fullName: string }[]
    currentRentCents: number | null
    depositCents: number
    graceDays: number
    lateFeeCents: number
    notes: string | null
    rentTerms: { id: string; amountCents: number; effectiveFrom: string; note: string | null }[]
  }
  finance: {
    balanceCents: number
    dueNowCents: number
    totalChargedCents: number
    totalPaidCents: number
    currentPeriod: { status: string; dueCents: number; paidCents: number }
  }
}

type Ledger = {
  charges: { id: string; type: string; amountCents: number; paidCents: number; period: string; dueDate: string; description: string | null }[]
  payments: { id: string; amountCents: number; receivedDate: string; method: string; note: string | null }[]
}

export default function LeaseScreen() {
  const { id } = useLocalSearchParams<{ id: string }>()
  const { data, isLoading } = useQuery({ queryKey: ['lease', id], queryFn: () => api<LeaseDetail>(`/leases/${id}`) })
  const ledger = useQuery({ queryKey: ['ledger', id], queryFn: () => api<Ledger>(`/leases/${id}/ledger`) })

  if (isLoading || !data) return <Screen><Loading /></Screen>
  const { lease, finance } = data
  const open = lease.status !== 'ENDED'

  const entries = ledger.data
    ? [
        ...ledger.data.charges.map((c) => ({
          key: `c-${c.id}`,
          date: c.dueDate,
          label: c.type === 'RENT' ? `Rent · ${periodLabel(c.period)}` : c.type === 'LATE_FEE' ? `Late fee · ${periodLabel(c.period)}` : (c.description ?? 'Charge'),
          amountCents: c.amountCents,
          charge: true,
          settled: c.paidCents >= c.amountCents,
        })),
        ...ledger.data.payments.map((p) => ({
          key: `p-${p.id}`,
          date: p.receivedDate,
          label: `Payment · ${p.method.replaceAll('_', ' ').toLowerCase()}${p.note ? ` — ${p.note}` : ''}`,
          amountCents: -p.amountCents,
          charge: false,
          settled: true,
        })),
      ].sort((a, b) => b.date.localeCompare(a.date))
    : []

  return (
    <Screen>
      <Stack.Screen options={{ title: `${lease.property.name} · ${lease.unit.label}` }} />

      <Card>
        <Row>
          <Body bold style={{ fontSize: 17 }}>{lease.tenants.map((t) => t.fullName).join(', ')}</Body>
          <Chip status={lease.status} />
        </Row>
        <Muted small>{lease.property.name} · {lease.unit.label}</Muted>
        <View style={{ height: 8 }} />
        <KeyValue k="Rent" v={lease.currentRentCents != null ? `${fmtMoney(lease.currentRentCents)}/mo` : '—'} />
        <KeyValue k="Term" v={`${fmtDate(lease.startDate)} → ${lease.endDate ? fmtDate(lease.endDate) : 'open'}`} />
        <KeyValue k="Due day" v={`${lease.dueDay}${lease.dueDay === 1 ? 'st' : lease.dueDay === 2 ? 'nd' : lease.dueDay === 3 ? 'rd' : 'th'} of the month`} />
        <KeyValue k="Deposit" v={fmtMoney(lease.depositCents)} />
        <KeyValue k="Late fee" v={lease.lateFeeCents > 0 ? `${fmtMoney(lease.lateFeeCents)} after ${lease.graceDays} days` : 'None'} />
      </Card>

      <Card style={{ backgroundColor: finance.dueNowCents > 0 ? colors.redSoft : colors.greenSoft, borderColor: 'transparent' }}>
        <Row>
          <View>
            <Muted small>Owed today</Muted>
            <Body bold style={{ fontSize: 22, color: finance.dueNowCents > 0 ? colors.red : colors.green }}>
              {fmtMoney(finance.dueNowCents)}
            </Body>
            {finance.balanceCents < 0 ? <Muted small>{fmtMoney(-finance.balanceCents)} credit</Muted> : null}
          </View>
          <View style={{ alignItems: 'flex-end', gap: 4 }}>
            <Muted small>This month</Muted>
            <Chip status={finance.currentPeriod.status} />
          </View>
        </Row>
      </Card>

      {open && (
        <>
          <Row style={{ gap: 8, flexWrap: 'wrap' }}>
            <Button title="Record payment" compact onPress={() => router.push(`/lease/${lease.id}/record-payment`)} />
            <Button title="Change rent" compact variant="secondary" onPress={() => router.push(`/lease/${lease.id}/change-rent`)} />
            <Button title="Add charge" compact variant="secondary" onPress={() => router.push(`/lease/${lease.id}/add-charge`)} />
            <Button title="Message" compact variant="secondary" onPress={() => router.push(`/lease/${lease.id}/messages`)} />
            <Button title="End lease" compact variant="danger" onPress={() => router.push(`/lease/${lease.id}/end`)} />
          </Row>
        </>
      )}

      <SectionHeader title="Rent history" />
      <Card>
        {lease.rentTerms.map((t, i) => (
          <Row key={t.id} style={{ paddingVertical: 4 }}>
            <Muted small>
              {fmtDate(t.effectiveFrom)}
              {t.note ? ` · ${t.note}` : ''}
            </Muted>
            <Body bold>
              {fmtMoney(t.amountCents)}/mo
              {i > 0 ? (t.amountCents > lease.rentTerms[i - 1].amountCents ? ' ↑' : t.amountCents < lease.rentTerms[i - 1].amountCents ? ' ↓' : '') : ''}
            </Body>
          </Row>
        ))}
      </Card>

      <SectionHeader title="Ledger" />
      {!ledger.data ? (
        <Loading />
      ) : (
        entries.map((e) => (
          <Card key={e.key} style={{ paddingVertical: 10 }}>
            <Row>
              <View style={{ flex: 1 }}>
                <Body>{e.label}</Body>
                <Muted small>{fmtDate(e.date)}{e.charge && !e.settled ? ' · unpaid' : ''}</Muted>
              </View>
              <Body bold style={{ color: e.charge ? colors.text : colors.green }}>
                {e.charge ? fmtMoney(e.amountCents) : `−${fmtMoney(-e.amountCents)}`}
              </Body>
            </Row>
          </Card>
        ))
      )}

      <DocumentsSection ownerType="LEASE" ownerId={lease.id} title="Lease documents" />
    </Screen>
  )
}

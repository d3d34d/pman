import { useQuery } from '@tanstack/react-query'
import { router } from 'expo-router'
import { View } from 'react-native'
import { api } from '@/lib/api'
import { useAuth } from '@/lib/auth'
import { fmtDate } from '@/lib/dates'
import { fmtMoney } from '@/lib/money'
import type { Overview } from '@/lib/portal-types'
import { colors } from '@/lib/theme'
import { Body, Button, Card, Chip, EmptyState, KeyValue, Loading, Muted, Row, Screen, SectionHeader, Title } from '@/ui/kit'
import { RentReminderCard } from '@/ui/rent-reminder'

type Announcements = {
  announcements: { id: string; title: string; body: string; createdAt: string; property: { name: string } }[]
}

export default function TenantHome() {
  const { user } = useAuth()
  const { data, isLoading } = useQuery({ queryKey: ['portal-overview'], queryFn: () => api<Overview>('/portal/overview') })
  const announcements = useQuery({ queryKey: ['portal-announcements'], queryFn: () => api<Announcements>('/portal/announcements') })

  if (isLoading || !data) return <Screen><Loading /></Screen>

  if (!data.lease) {
    return (
      <Screen>
        <Title>Hi {user?.name.split(' ')[0]}</Title>
        <EmptyState title="No lease on file" hint="Ask your property manager to link you to a lease." />
      </Screen>
    )
  }

  const owes = data.balanceCents > 0
  const renewal = data.renewal

  return (
    <Screen>
      <Title>Hi {user?.name.split(' ')[0]}</Title>
      <Muted>{data.lease.propertyName} · {data.lease.unitLabel}</Muted>

      <Card style={{ backgroundColor: owes ? colors.redSoft : colors.greenSoft, borderColor: 'transparent', marginTop: 12 }}>
        <Row>
          <View>
            <Muted small>{owes ? 'You currently owe' : 'Your balance'}</Muted>
            <Body bold style={{ fontSize: 26, color: owes ? colors.red : colors.green }}>
              {fmtMoney(Math.max(data.balanceCents, 0))}
            </Body>
          </View>
          <View style={{ alignItems: 'flex-end', gap: 4 }}>
            {data.currentPeriod && <Chip status={data.currentPeriod.status} />}
            {data.nextDueDate && <Muted small>next due {fmtDate(data.nextDueDate)}</Muted>}
          </View>
        </Row>
        <View style={{ marginTop: 12 }}>
          <Button title={owes ? `Submit a payment` : 'Submit a payment'} onPress={() => router.push('/submit-payment')} />
        </View>
      </Card>

      <SectionHeader title="Your lease" action={<Button title="Documents" compact variant="secondary" onPress={() => router.push('/documents')} />} />
      <Card>
        <KeyValue k="Rent" v={data.lease.currentRentCents != null ? `${fmtMoney(data.lease.currentRentCents)}/mo` : '—'} />
        <KeyValue k="Term" v={`${fmtDate(data.lease.startDate)} → ${data.lease.endDate ? fmtDate(data.lease.endDate) : 'open'}`} />
        <KeyValue k="Due" v={`Day ${data.lease.dueDay} of the month`} />
        <KeyValue k="Deposit" v={fmtMoney(data.lease.depositCents)} />
        {data.lease.coTenants.length > 1 && <KeyValue k="Tenants" v={data.lease.coTenants.join(', ')} />}
        <KeyValue k="Address" v={data.lease.propertyAddress} />
      </Card>

      {renewal?.endDate && renewal.daysRemaining != null && (
        <Card style={renewal.expiringSoon ? { backgroundColor: colors.amberSoft, borderColor: 'transparent' } : undefined}>
          <Row>
            <View style={{ flex: 1, marginRight: 10 }}>
              <Body bold>{renewal.expiringSoon ? 'Your lease is ending soon' : 'Lease renewal'}</Body>
              <Muted small>
                {renewal.daysRemaining > 0
                  ? `${renewal.daysRemaining} days left — ends ${fmtDate(renewal.endDate)}.`
                  : `Ended ${fmtDate(renewal.endDate)}.`}
              </Muted>
            </View>
            {renewal.expiringSoon && <Chip status="PARTIAL" label="Soon" />}
          </Row>
          {renewal.expiringSoon && (
            <View style={{ marginTop: 10 }}>
              <Button title="Message your manager" compact variant="secondary" onPress={() => router.push('/messages')} />
            </View>
          )}
        </Card>
      )}

      <SectionHeader title="Reminders" />
      <RentReminderCard
        dueDay={data.lease.dueDay}
        rentLabel={data.lease.currentRentCents != null ? fmtMoney(data.lease.currentRentCents) : 'monthly'}
        propertyLabel={`${data.lease.propertyName} · ${data.lease.unitLabel}`}
      />

      <SectionHeader title="Announcements" />
      {!announcements.data || announcements.data.announcements.length === 0 ? (
        <EmptyState title="Nothing new" />
      ) : (
        announcements.data.announcements.map((a) => (
          <Card key={a.id}>
            <Body bold>{a.title}</Body>
            <Muted small>{fmtDate(a.createdAt)}</Muted>
            <Body style={{ marginTop: 6 }}>{a.body}</Body>
          </Card>
        ))
      )}
    </Screen>
  )
}

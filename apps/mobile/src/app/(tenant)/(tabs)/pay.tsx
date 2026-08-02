import { useQuery } from '@tanstack/react-query'
import { router } from 'expo-router'
import { View } from 'react-native'
import { api } from '@/lib/api'
import { fmtDate } from '@/lib/dates'
import { fmtMoney } from '@/lib/money'
import type { Overview } from '@/lib/portal-types'
import { colors } from '@/lib/theme'
import { Body, Button, Card, Chip, EmptyState, ListRow, Loading, Muted, Row, Screen, SectionHeader } from '@/ui/kit'

type Submissions = {
  submissions: {
    id: string
    amountCents: number
    method: string
    paidOn: string
    status: string
    reviewNote: string | null
    createdAt: string
  }[]
}

const METHOD_LABEL: Record<string, string> = {
  ZELLE: 'Zelle',
  BANK_TRANSFER: 'Bank transfer',
  CASH: 'Cash',
  CHECK: 'Check',
  OTHER: 'Other',
}

export default function PayScreen() {
  const overview = useQuery({ queryKey: ['portal-overview'], queryFn: () => api<Overview>('/portal/overview') })
  const subs = useQuery({ queryKey: ['payment-submissions'], queryFn: () => api<Submissions>('/portal/payment-submissions') })

  if (overview.isLoading || subs.isLoading) return <Screen><Loading /></Screen>

  // Distinguish "the request failed" from "you have no lease". Showing the
  // empty state on an error tells a tenant their lease or their submitted
  // payment doesn't exist, which invites a duplicate submission.
  if (overview.isError) {
    return (
      <Screen>
        <EmptyState title="Can’t load your account" hint="Check your connection and pull to try again." />
      </Screen>
    )
  }
  if (!overview.data?.lease) {
    return (
      <Screen>
        <EmptyState title="No active lease" hint="Ask your property manager to link you to a lease." />
      </Screen>
    )
  }

  const due = overview.data.balanceCents

  return (
    <Screen>
      <Card style={{ backgroundColor: due > 0 ? colors.redSoft : colors.greenSoft, borderColor: 'transparent' }}>
        <Muted small>Balance due</Muted>
        <Body bold style={{ fontSize: 26, color: due > 0 ? colors.red : colors.green }}>{fmtMoney(Math.max(due, 0))}</Body>
        {overview.data.nextDueDate && <Muted small>next rent due {fmtDate(overview.data.nextDueDate)}</Muted>}
      </Card>

      <Card>
        <Body bold>How paying works</Body>
        <Muted small>
          Pay your rent the way you already do — Zelle, bank transfer, cash or check — then submit the details and a
          screenshot here. Your manager reviews it and marks it paid.
        </Muted>
      </Card>

      <Button title="Submit a payment" onPress={() => router.push('/submit-payment')} />

      <SectionHeader title="Your submissions" />
      {subs.isError ? (
        <EmptyState title="Couldn’t load your submissions" hint="They’re safe — pull to refresh and try again." />
      ) : !subs.data || subs.data.submissions.length === 0 ? (
        <EmptyState title="Nothing submitted yet" hint="Tap “Submit a payment” after you’ve paid." />
      ) : (
        subs.data.submissions.map((s) => (
          <ListRow
            key={s.id}
            title={`${fmtMoney(s.amountCents)} · ${METHOD_LABEL[s.method] ?? s.method}`}
            subtitle={`Paid ${fmtDate(s.paidOn)}${s.reviewNote ? ` · ${s.reviewNote}` : ''}`}
            right={
              <View style={{ alignItems: 'flex-end' }}>
                <Chip status={s.status === 'APPROVED' ? 'PAID' : s.status === 'REJECTED' ? 'LATE' : 'UPCOMING'} label={s.status === 'APPROVED' ? 'Approved' : s.status === 'REJECTED' ? 'Rejected' : 'Pending'} />
              </View>
            }
          />
        ))
      )}
      <Row style={{ marginTop: 6 }}>
        <Muted small>Approved payments appear in your receipts.</Muted>
        <Button title="Receipts" compact variant="secondary" onPress={() => router.push('/receipts')} />
      </Row>
    </Screen>
  )
}

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { Image, View } from 'react-native'
import { api, getBaseUrl } from '@/lib/api'
import { fmtDate } from '@/lib/dates'
import { fmtMoney } from '@/lib/money'
import { colors } from '@/lib/theme'
import { Body, Button, Card, Chip, EmptyState, ErrorText, Field, Loading, Muted, Row, Screen, Segment } from '@/ui/kit'

type Submissions = {
  submissions: {
    id: string
    amountCents: number
    method: string
    paidOn: string
    reference: string | null
    note: string | null
    status: string
    reviewNote: string | null
    tenantName: string
    propertyName: string
    unitLabel: string
    proofUrl: string | null
  }[]
}

const METHOD_LABEL: Record<string, string> = {
  ZELLE: 'Zelle',
  BANK_TRANSFER: 'Bank transfer',
  CASH: 'Cash',
  CHECK: 'Check',
  OTHER: 'Other',
}

const FILTERS = ['PENDING', 'APPROVED', 'REJECTED'] as const

export default function PaymentApprovals() {
  const qc = useQueryClient()
  const [filter, setFilter] = useState<(typeof FILTERS)[number]>('PENDING')
  const [rejectingId, setRejectingId] = useState('')
  const [reason, setReason] = useState('')
  const [error, setError] = useState('')

  const { data, isLoading } = useQuery({
    queryKey: ['payment-submissions', filter],
    queryFn: () => api<Submissions>(`/payment-submissions?status=${filter}`),
  })

  const approve = useMutation({
    mutationFn: (id: string) => api(`/payment-submissions/${id}/approve`, { method: 'POST', body: {} }),
    onSuccess: () => qc.invalidateQueries(),
    onError: (e) => setError((e as Error).message),
  })
  const reject = useMutation({
    mutationFn: (id: string) => api(`/payment-submissions/${id}/reject`, { method: 'POST', body: { reason: reason.trim() || undefined } }),
    onSuccess: () => {
      setRejectingId('')
      setReason('')
      qc.invalidateQueries()
    },
    onError: (e) => setError((e as Error).message),
  })

  return (
    <Screen>
      <Segment options={FILTERS} value={filter} onChange={setFilter} labels={{ PENDING: 'Pending', APPROVED: 'Approved', REJECTED: 'Rejected' }} />
      <ErrorText>{error}</ErrorText>

      {isLoading || !data ? (
        <Loading />
      ) : data.submissions.length === 0 ? (
        <EmptyState title={filter === 'PENDING' ? 'Nothing to review' : `No ${filter.toLowerCase()} submissions`} />
      ) : (
        data.submissions.map((s) => (
          <Card key={s.id}>
            <Row>
              <View style={{ flex: 1, marginRight: 8 }}>
                <Body bold style={{ fontSize: 18 }}>{fmtMoney(s.amountCents)}</Body>
                <Muted small>{s.tenantName} · {s.propertyName} · {s.unitLabel}</Muted>
              </View>
              <Chip status={s.status === 'APPROVED' ? 'PAID' : s.status === 'REJECTED' ? 'LATE' : 'UPCOMING'} label={s.status[0] + s.status.slice(1).toLowerCase()} />
            </Row>

            <View style={{ marginTop: 8 }}>
              <Muted small>{METHOD_LABEL[s.method] ?? s.method} · paid {fmtDate(s.paidOn)}{s.reference ? ` · ${s.reference}` : ''}</Muted>
              {s.note ? <Muted small>“{s.note}”</Muted> : null}
              {s.reviewNote ? <Muted small>Rejected: {s.reviewNote}</Muted> : null}
            </View>

            {s.proofUrl ? (
              <Image source={{ uri: `${getBaseUrl()}${s.proofUrl}` }} style={{ width: '100%', height: 200, borderRadius: 10, marginTop: 10 }} resizeMode="contain" />
            ) : (
              <Muted small>No screenshot attached.</Muted>
            )}

            {s.status === 'PENDING' && (
              <>
                <Row style={{ gap: 8, marginTop: 12 }}>
                  <Button title="Approve & record" compact onPress={() => approve.mutate(s.id)} loading={approve.isPending} />
                  <Button title="Reject" compact variant="danger" onPress={() => setRejectingId(rejectingId === s.id ? '' : s.id)} />
                </Row>
                {rejectingId === s.id && (
                  <View style={{ marginTop: 8 }}>
                    <Field label="Reason (optional)" value={reason} onChangeText={setReason} placeholder="Couldn't find this payment…" />
                    <Button title="Confirm reject" variant="danger" onPress={() => reject.mutate(s.id)} loading={reject.isPending} />
                  </View>
                )}
              </>
            )}
          </Card>
        ))
      )}
      <Muted small>Approving records the payment in the tenant’s ledger and clears their balance.</Muted>
    </Screen>
  )
}

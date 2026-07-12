import { useQuery, useQueryClient } from '@tanstack/react-query'
import { router, useLocalSearchParams } from 'expo-router'
import { useEffect, useState } from 'react'
import { api } from '@/lib/api'
import { isDateStr, todayStr } from '@/lib/dates'
import { centsToInput, fmtMoney, parseMoney } from '@/lib/money'
import { Button, Card, ErrorText, Field, Muted, Screen, Segment, Spacer } from '@/ui/kit'

const METHODS = ['CASH', 'CHECK', 'BANK_TRANSFER', 'ZELLE', 'OTHER'] as const

export default function RecordPayment() {
  const { id } = useLocalSearchParams<{ id: string }>()
  const qc = useQueryClient()
  const { data } = useQuery({
    queryKey: ['ledger', id],
    queryFn: () => api<{ balanceCents: number; dueNowCents: number }>(`/leases/${id}/ledger`),
  })

  const [amount, setAmount] = useState('')
  const [prefilled, setPrefilled] = useState(false)
  const [receivedDate, setReceivedDate] = useState(todayStr())
  const [method, setMethod] = useState<(typeof METHODS)[number]>('BANK_TRANSFER')
  const [reference, setReference] = useState('')
  const [note, setNote] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (data && !prefilled && data.dueNowCents > 0) {
      setAmount(centsToInput(data.dueNowCents))
      setPrefilled(true)
    }
  }, [data, prefilled])

  async function submit() {
    setError('')
    const amountCents = parseMoney(amount)
    if (amountCents === null || amountCents <= 0) return setError('Amount must be a dollar amount, e.g. 1400')
    if (!isDateStr(receivedDate)) return setError('Received date must be YYYY-MM-DD')
    setBusy(true)
    try {
      await api(`/leases/${id}/payments`, {
        method: 'POST',
        body: { amountCents, receivedDate, method, reference: reference.trim() || undefined, note: note.trim() || undefined },
      })
      qc.invalidateQueries()
      router.back()
    } catch (e) {
      setError((e as Error).message)
      setBusy(false)
    }
  }

  return (
    <Screen>
      {data && (
        <Card>
          <Muted>
            Owed today: <Muted>{fmtMoney(data.dueNowCents)}</Muted>
            {data.balanceCents < 0 ? ` (credit of ${fmtMoney(-data.balanceCents)})` : ''}
          </Muted>
        </Card>
      )}
      <Spacer h={6} />
      <Field label="Amount received" value={amount} onChangeText={setAmount} keyboardType="decimal-pad" placeholder="1400" />
      <Field label="Date received" value={receivedDate} onChangeText={setReceivedDate} placeholder="YYYY-MM-DD" autoCapitalize="none" />
      <Segment label="Method" options={METHODS} value={method} onChange={setMethod} labels={{ CASH: 'Cash', CHECK: 'Check', BANK_TRANSFER: 'Bank transfer', ZELLE: 'Zelle', OTHER: 'Other' }} />
      <Field label="Reference (optional)" value={reference} onChangeText={setReference} placeholder="Check #1042" />
      <Field label="Note (optional)" value={note} onChangeText={setNote} placeholder="Partial — rest next week" />
      <ErrorText>{error}</ErrorText>
      <Button title="Record payment" onPress={submit} loading={busy} disabled={!amount.trim()} />
      <Muted small>Payments apply to the oldest unpaid charges first.</Muted>
    </Screen>
  )
}

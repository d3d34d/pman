import { useQuery, useQueryClient } from '@tanstack/react-query'
import { router, useLocalSearchParams } from 'expo-router'
import { useState } from 'react'
import { api } from '@/lib/api'
import { firstOfNextMonth, fmtDate, isDateStr } from '@/lib/dates'
import { fmtMoney, parseMoney } from '@/lib/money'
import { Body, Button, Card, ErrorText, Field, Loading, Muted, Row, Screen, SectionHeader, Spacer } from '@/ui/kit'

type LeaseDetail = {
  lease: {
    currentRentCents: number | null
    rentTerms: { id: string; amountCents: number; effectiveFrom: string; note: string | null }[]
  }
}

export default function ChangeRent() {
  const { id } = useLocalSearchParams<{ id: string }>()
  const qc = useQueryClient()
  const { data } = useQuery({ queryKey: ['lease', id], queryFn: () => api<LeaseDetail>(`/leases/${id}`) })

  const [amount, setAmount] = useState('')
  const [effectiveFrom, setEffectiveFrom] = useState(firstOfNextMonth())
  const [note, setNote] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  if (!data) return <Screen><Loading /></Screen>
  const current = data.lease.currentRentCents

  async function submit() {
    setError('')
    const amountCents = parseMoney(amount)
    if (amountCents === null || amountCents <= 0) return setError('New rent must be a dollar amount, e.g. 1500')
    if (!isDateStr(effectiveFrom)) return setError('Effective date must be YYYY-MM-DD')
    setBusy(true)
    try {
      await api(`/leases/${id}/rent-terms`, {
        method: 'POST',
        body: { amountCents, effectiveFrom, note: note.trim() || undefined },
      })
      qc.invalidateQueries()
      router.back()
    } catch (e) {
      setError((e as Error).message)
      setBusy(false)
    }
  }

  const newCents = parseMoney(amount)
  const delta = current != null && newCents != null ? newCents - current : null

  return (
    <Screen>
      <Card>
        <Row>
          <Muted>Current rent</Muted>
          <Body bold>{current != null ? `${fmtMoney(current)}/mo` : '—'}</Body>
        </Row>
        {delta != null && delta !== 0 && (
          <Row>
            <Muted>Change</Muted>
            <Body bold style={{ color: delta > 0 ? '#B45309' : '#16A34A' }}>
              {delta > 0 ? '+' : '−'}{fmtMoney(Math.abs(delta))} ({((Math.abs(delta) / current!) * 100).toFixed(1)}%)
            </Body>
          </Row>
        )}
      </Card>
      <Spacer h={6} />
      <Field label="New monthly rent" value={amount} onChangeText={setAmount} keyboardType="decimal-pad" placeholder="1500" />
      <Field
        label="Effective from"
        value={effectiveFrom}
        onChangeText={setEffectiveFrom}
        placeholder="YYYY-MM-DD"
        autoCapitalize="none"
        hint="Applies to billing months from this date's month onward. Months already billed keep their original rent."
      />
      <Field label="Reason (optional)" value={note} onChangeText={setNote} placeholder="Annual increase / good-tenant discount…" />
      <ErrorText>{error}</ErrorText>
      <Button title="Apply rent change" onPress={submit} loading={busy} disabled={!amount.trim()} />

      <SectionHeader title="Rent history" />
      <Card>
        {data.lease.rentTerms.map((t) => (
          <Row key={t.id} style={{ paddingVertical: 4 }}>
            <Muted small>
              {fmtDate(t.effectiveFrom)}
              {t.note ? ` · ${t.note}` : ''}
            </Muted>
            <Body bold>{fmtMoney(t.amountCents)}/mo</Body>
          </Row>
        ))}
      </Card>
    </Screen>
  )
}

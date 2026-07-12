import { useQueryClient } from '@tanstack/react-query'
import { router, useLocalSearchParams } from 'expo-router'
import { useState } from 'react'
import { api } from '@/lib/api'
import { isDateStr, todayStr } from '@/lib/dates'
import { parseMoney } from '@/lib/money'
import { Button, ErrorText, Field, Muted, Screen, Spacer } from '@/ui/kit'

export default function AddCharge() {
  const { id } = useLocalSearchParams<{ id: string }>()
  const qc = useQueryClient()
  const [amount, setAmount] = useState('')
  const [dueDate, setDueDate] = useState(todayStr())
  const [description, setDescription] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit() {
    setError('')
    const amountCents = parseMoney(amount)
    if (amountCents === null || amountCents <= 0) return setError('Amount must be a dollar amount, e.g. 75')
    if (!isDateStr(dueDate)) return setError('Due date must be YYYY-MM-DD')
    setBusy(true)
    try {
      await api(`/leases/${id}/charges`, {
        method: 'POST',
        body: { amountCents, dueDate, description: description.trim() },
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
      <Muted>One-off charges outside monthly rent — damage repair, utilities owed, parking, pet fees…</Muted>
      <Spacer h={16} />
      <Field label="Amount" value={amount} onChangeText={setAmount} keyboardType="decimal-pad" placeholder="75" />
      <Field label="Due date" value={dueDate} onChangeText={setDueDate} placeholder="YYYY-MM-DD" autoCapitalize="none" />
      <Field label="Description" value={description} onChangeText={setDescription} placeholder="Broken window repair" />
      <ErrorText>{error}</ErrorText>
      <Button title="Add charge" onPress={submit} loading={busy} disabled={!amount.trim() || !description.trim()} />
    </Screen>
  )
}

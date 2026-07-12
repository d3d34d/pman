import { useQuery, useQueryClient } from '@tanstack/react-query'
import { router } from 'expo-router'
import { useState } from 'react'
import { api } from '@/lib/api'
import { isDateStr, todayStr } from '@/lib/dates'
import { parseMoney } from '@/lib/money'
import { Button, ErrorText, Field, Loading, Screen, Segment } from '@/ui/kit'

type Properties = { properties: { id: string; name: string }[] }

const CATEGORIES = ['REPAIRS', 'UTILITIES', 'TAXES', 'INSURANCE', 'MANAGEMENT', 'OTHER'] as const

export default function NewExpense() {
  const qc = useQueryClient()
  const properties = useQuery({ queryKey: ['properties'], queryFn: () => api<Properties>('/properties') })

  const [propertyId, setPropertyId] = useState('')
  const [category, setCategory] = useState<(typeof CATEGORIES)[number]>('REPAIRS')
  const [amount, setAmount] = useState('')
  const [incurredOn, setIncurredOn] = useState(todayStr())
  const [description, setDescription] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit() {
    setError('')
    const amountCents = parseMoney(amount)
    if (amountCents === null || amountCents <= 0) return setError('Amount must be a dollar amount, e.g. 220')
    if (!isDateStr(incurredOn)) return setError('Date must be YYYY-MM-DD')
    setBusy(true)
    try {
      await api('/expenses', {
        method: 'POST',
        body: { propertyId, category, amountCents, incurredOn, description: description.trim() || undefined },
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
      {!properties.data ? (
        <Loading />
      ) : (
        <Segment
          label="Property"
          options={properties.data.properties.map((p) => p.id) as unknown as readonly string[]}
          value={propertyId}
          onChange={setPropertyId}
          labels={Object.fromEntries(properties.data.properties.map((p) => [p.id, p.name]))}
        />
      )}
      <Segment label="Category" options={CATEGORIES} value={category} onChange={setCategory} labels={{ REPAIRS: 'Repairs', UTILITIES: 'Utilities', TAXES: 'Taxes', INSURANCE: 'Insurance', MANAGEMENT: 'Management', OTHER: 'Other' }} />
      <Field label="Amount" value={amount} onChangeText={setAmount} keyboardType="decimal-pad" placeholder="220" />
      <Field label="Date" value={incurredOn} onChangeText={setIncurredOn} placeholder="YYYY-MM-DD" autoCapitalize="none" />
      <Field label="Description (optional)" value={description} onChangeText={setDescription} placeholder="Gutter repair after storm" />
      <ErrorText>{error}</ErrorText>
      <Button title="Add expense" onPress={submit} loading={busy} disabled={!propertyId || !amount.trim()} />
    </Screen>
  )
}

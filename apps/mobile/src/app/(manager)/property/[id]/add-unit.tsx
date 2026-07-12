import { useQueryClient } from '@tanstack/react-query'
import { router, useLocalSearchParams } from 'expo-router'
import { useState } from 'react'
import { api } from '@/lib/api'
import { parseMoney } from '@/lib/money'
import { Button, ErrorText, Field, Screen } from '@/ui/kit'

export default function AddUnit() {
  const { id } = useLocalSearchParams<{ id: string }>()
  const qc = useQueryClient()
  const [label, setLabel] = useState('')
  const [bedrooms, setBedrooms] = useState('')
  const [bathrooms, setBathrooms] = useState('')
  const [sqft, setSqft] = useState('')
  const [marketRent, setMarketRent] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit() {
    setError('')
    const rentCents = marketRent.trim() ? parseMoney(marketRent) : undefined
    if (marketRent.trim() && rentCents === null) {
      setError('Market rent must be a dollar amount, e.g. 1400')
      return
    }
    setBusy(true)
    try {
      await api(`/properties/${id}/units`, {
        method: 'POST',
        body: {
          label: label.trim(),
          bedrooms: bedrooms.trim() ? Number(bedrooms) : undefined,
          bathrooms: bathrooms.trim() ? Number(bathrooms) : undefined,
          sqft: sqft.trim() ? Number(sqft) : undefined,
          marketRentCents: rentCents ?? undefined,
        },
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
      <Field label="Unit label" value={label} onChangeText={setLabel} placeholder="Apt 2B / Left side / Unit 5" />
      <Field label="Bedrooms (optional)" value={bedrooms} onChangeText={setBedrooms} keyboardType="number-pad" placeholder="2" />
      <Field label="Bathrooms (optional)" value={bathrooms} onChangeText={setBathrooms} keyboardType="decimal-pad" placeholder="1.5" />
      <Field label="Square feet (optional)" value={sqft} onChangeText={setSqft} keyboardType="number-pad" placeholder="850" />
      <Field label="Market rent (optional)" value={marketRent} onChangeText={setMarketRent} keyboardType="decimal-pad" placeholder="1400" hint="What you'd list it for — used for vacant units." />
      <ErrorText>{error}</ErrorText>
      <Button title="Add unit" onPress={submit} loading={busy} disabled={!label.trim()} />
    </Screen>
  )
}

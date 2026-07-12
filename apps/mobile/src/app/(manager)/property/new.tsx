import { useQueryClient } from '@tanstack/react-query'
import { router } from 'expo-router'
import { useState } from 'react'
import { api } from '@/lib/api'
import { Button, ErrorText, Field, Screen } from '@/ui/kit'

export default function NewProperty() {
  const qc = useQueryClient()
  const [name, setName] = useState('')
  const [address, setAddress] = useState('')
  const [type, setType] = useState('')
  const [notes, setNotes] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit() {
    setError('')
    setBusy(true)
    try {
      const res = await api<{ property: { id: string } }>('/properties', {
        method: 'POST',
        body: { name: name.trim(), address: address.trim(), type: type.trim() || undefined, notes: notes.trim() || undefined },
      })
      qc.invalidateQueries()
      router.replace(`/property/${res.property.id}`)
    } catch (e) {
      setError((e as Error).message)
      setBusy(false)
    }
  }

  return (
    <Screen>
      <Field label="Name" value={name} onChangeText={setName} placeholder="Maple Court Apartments" />
      <Field label="Address" value={address} onChangeText={setAddress} placeholder="410 Maple Court, Springfield" />
      <Field label="Type (optional)" value={type} onChangeText={setType} placeholder="Apartment building, duplex, single-family…" />
      <Field label="Notes (optional)" value={notes} onChangeText={setNotes} multiline />
      <ErrorText>{error}</ErrorText>
      <Button title="Create property" onPress={submit} loading={busy} disabled={!name.trim() || !address.trim()} />
    </Screen>
  )
}

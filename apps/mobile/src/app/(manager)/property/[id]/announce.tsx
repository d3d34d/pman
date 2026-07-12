import { useQueryClient } from '@tanstack/react-query'
import { router, useLocalSearchParams } from 'expo-router'
import { useState } from 'react'
import { api } from '@/lib/api'
import { Button, ErrorText, Field, Muted, Screen, Spacer } from '@/ui/kit'

export default function Announce() {
  const { id } = useLocalSearchParams<{ id: string }>()
  const qc = useQueryClient()
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit() {
    setError('')
    setBusy(true)
    try {
      await api(`/properties/${id}/announcements`, { method: 'POST', body: { title: title.trim(), body: body.trim() } })
      qc.invalidateQueries()
      router.back()
    } catch (e) {
      setError((e as Error).message)
      setBusy(false)
    }
  }

  return (
    <Screen>
      <Muted>Announcements are visible to every tenant of this property in their portal.</Muted>
      <Spacer h={16} />
      <Field label="Title" value={title} onChangeText={setTitle} placeholder="Water shutoff Thursday" />
      <Field label="Message" value={body} onChangeText={setBody} multiline placeholder="Details…" />
      <ErrorText>{error}</ErrorText>
      <Button title="Post announcement" onPress={submit} loading={busy} disabled={!title.trim() || !body.trim()} />
    </Screen>
  )
}

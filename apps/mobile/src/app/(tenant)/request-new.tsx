import { useQueryClient } from '@tanstack/react-query'
import * as ImagePicker from 'expo-image-picker'
import { router } from 'expo-router'
import { useState } from 'react'
import { Image, View } from 'react-native'
import { api, apiUpload } from '@/lib/api'
import { Button, ErrorText, Field, Muted, Screen, Segment, Spacer } from '@/ui/kit'

const PRIORITIES = ['LOW', 'NORMAL', 'HIGH', 'URGENT'] as const

export default function NewRequest() {
  const qc = useQueryClient()
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [priority, setPriority] = useState<(typeof PRIORITIES)[number]>('NORMAL')
  const [photos, setPhotos] = useState<{ uri: string; name: string; mimeType?: string }[]>([])
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function pickPhoto() {
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: 'images', quality: 0.7 })
    if (!result.canceled && result.assets[0]) {
      const a = result.assets[0]
      setPhotos((p) => [...p, { uri: a.uri, name: a.fileName ?? `photo-${p.length + 1}.jpg`, mimeType: a.mimeType ?? 'image/jpeg' }])
    }
  }

  async function submit() {
    setError('')
    setBusy(true)
    try {
      const res = await api<{ request: { id: string } }>('/portal/maintenance', {
        method: 'POST',
        body: { title: title.trim(), description: description.trim(), priority },
      })
      for (const photo of photos) {
        await apiUpload(`/portal/maintenance/${res.request.id}/photos`, photo)
      }
      qc.invalidateQueries()
      router.back()
    } catch (e) {
      setError((e as Error).message)
      setBusy(false)
    }
  }

  return (
    <Screen>
      <Field label="What needs fixing?" value={title} onChangeText={setTitle} placeholder="Kitchen faucet dripping" />
      <Field label="Details" value={description} onChangeText={setDescription} multiline placeholder="Where is it, since when, how bad…" />
      <Segment label="Urgency" options={PRIORITIES} value={priority} onChange={setPriority} />

      <Muted small>Photos help your manager fix it faster.</Muted>
      <Spacer h={8} />
      {photos.length > 0 && (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 10 }}>
          {photos.map((p, i) => (
            <Image key={i} source={{ uri: p.uri }} style={{ width: 90, height: 90, borderRadius: 10 }} />
          ))}
        </View>
      )}
      <Button title={photos.length ? '+ Add another photo' : '+ Add photo'} variant="secondary" onPress={pickPhoto} />

      <ErrorText>{error}</ErrorText>
      <Button title="Submit request" onPress={submit} loading={busy} disabled={!title.trim() || !description.trim()} />
    </Screen>
  )
}

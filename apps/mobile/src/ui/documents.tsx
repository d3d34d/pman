import { useQuery, useQueryClient } from '@tanstack/react-query'
import * as DocumentPicker from 'expo-document-picker'
import { useState } from 'react'
import { Linking, Pressable, View } from 'react-native'
import { api, apiUpload, getBaseUrl } from '@/lib/api'
import { fmtDate } from '@/lib/dates'
import { colors } from '@/lib/theme'
import { Body, Button, Card, EmptyState, ErrorText, Muted, Row, SectionHeader } from './kit'

type OwnerType = 'PROPERTY' | 'LEASE' | 'TENANT'

type Documents = {
  documents: { id: string; filename: string; url: string; mimeType: string | null; uploadedAt: string }[]
}

function iconFor(mimeType: string | null, filename: string): string {
  const m = mimeType ?? ''
  if (m.startsWith('image/')) return '🖼️'
  if (m.includes('pdf') || filename.toLowerCase().endsWith('.pdf')) return '📄'
  return '📎'
}

export function DocumentsSection({ ownerType, ownerId, title = 'Documents' }: { ownerType: OwnerType; ownerId: string; title?: string }) {
  const qc = useQueryClient()
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const queryKey = ['documents', ownerType, ownerId]

  const { data } = useQuery({
    queryKey,
    queryFn: () => api<Documents>(`/documents?ownerType=${ownerType}&ownerId=${ownerId}`),
  })

  async function pickAndUpload() {
    setError('')
    try {
      const result = await DocumentPicker.getDocumentAsync({ copyToCacheDirectory: true, multiple: false })
      if (result.canceled || !result.assets?.[0]) return
      const asset = result.assets[0]
      setBusy(true)
      await apiUpload(
        '/documents',
        { uri: asset.uri, name: asset.name ?? 'file', mimeType: asset.mimeType ?? undefined },
        { ownerType, ownerId },
      )
      qc.invalidateQueries({ queryKey })
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  async function remove(id: string) {
    setError('')
    try {
      await api(`/documents/${id}`, { method: 'DELETE' })
      qc.invalidateQueries({ queryKey })
    } catch (e) {
      setError((e as Error).message)
    }
  }

  const docs = data?.documents ?? []

  return (
    <>
      <SectionHeader title={title} action={<Button title={busy ? 'Uploading…' : '+ Upload'} compact variant="secondary" onPress={pickAndUpload} disabled={busy} />} />
      <ErrorText>{error}</ErrorText>
      {docs.length === 0 ? (
        <EmptyState title="No documents" hint="Attach leases, receipts, IDs or photos (PDF or image)." />
      ) : (
        docs.map((d) => (
          <Card key={d.id} style={{ paddingVertical: 10 }}>
            <Row>
              <Pressable style={{ flex: 1, marginRight: 10 }} onPress={() => Linking.openURL(`${getBaseUrl()}${d.url}`)}>
                <Body>
                  {iconFor(d.mimeType, d.filename)} {d.filename}
                </Body>
                <Muted small>Uploaded {fmtDate(d.uploadedAt)} · tap to open</Muted>
              </Pressable>
              <RemoveButton onConfirm={() => remove(d.id)} />
            </Row>
          </Card>
        ))
      )}
    </>
  )
}

/** Compact two-tap delete for a single row (arms on first tap). */
function RemoveButton({ onConfirm }: { onConfirm: () => void }) {
  const [armed, setArmed] = useState(false)
  return (
    <Pressable
      onPress={() => {
        if (armed) {
          setArmed(false)
          onConfirm()
        } else {
          setArmed(true)
          setTimeout(() => setArmed(false), 3000)
        }
      }}
      style={{ paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8, backgroundColor: colors.redSoft }}
    >
      <View>
        <Body style={{ color: colors.red, fontSize: 13, fontWeight: '600' }}>{armed ? 'Confirm?' : 'Remove'}</Body>
      </View>
    </Pressable>
  )
}

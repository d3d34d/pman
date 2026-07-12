import { useQuery } from '@tanstack/react-query'
import { Linking, Pressable } from 'react-native'
import { api, getBaseUrl } from '@/lib/api'
import { fmtDate } from '@/lib/dates'
import { Body, Card, EmptyState, Loading, Muted, Screen } from '@/ui/kit'

type Documents = { documents: { id: string; filename: string; url: string; mimeType: string | null; uploadedAt: string }[] }

function iconFor(mimeType: string | null, filename: string): string {
  const m = mimeType ?? ''
  if (m.startsWith('image/')) return '🖼️'
  if (m.includes('pdf') || filename.toLowerCase().endsWith('.pdf')) return '📄'
  return '📎'
}

export default function TenantDocuments() {
  const { data, isLoading } = useQuery({ queryKey: ['portal-documents'], queryFn: () => api<Documents>('/portal/documents') })

  if (isLoading || !data) return <Screen><Loading /></Screen>

  return (
    <Screen>
      <Muted>Your lease agreement and any documents your manager has shared with you.</Muted>
      {data.documents.length === 0 ? (
        <EmptyState title="No documents yet" hint="Your manager hasn't attached any documents to your lease." />
      ) : (
        data.documents.map((d) => (
          <Pressable key={d.id} onPress={() => Linking.openURL(`${getBaseUrl()}${d.url}`)}>
            <Card>
              <Body>
                {iconFor(d.mimeType, d.filename)} {d.filename}
              </Body>
              <Muted small>Added {fmtDate(d.uploadedAt)} · tap to open</Muted>
            </Card>
          </Pressable>
        ))
      )}
    </Screen>
  )
}

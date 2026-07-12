import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { router, Stack, useLocalSearchParams } from 'expo-router'
import { useState } from 'react'
import { View } from 'react-native'
import { api } from '@/lib/api'
import { fmtDate } from '@/lib/dates'
import { Body, Button, Card, Chip, ConfirmButton, EmptyState, ErrorText, Field, KeyValue, ListRow, Loading, Muted, Row, Screen, SectionHeader } from '@/ui/kit'
import { DocumentsSection } from '@/ui/documents'

type TenantDetail = {
  tenant: {
    id: string
    fullName: string
    email: string | null
    phone: string | null
    emergencyName: string | null
    emergencyPhone: string | null
    status: string
    user: { id: string; email: string } | null
    leases: {
      lease: {
        id: string
        status: string
        startDate: string
        endDate: string | null
        unit: { label: string; property: { name: string } }
      }
    }[]
    notes: { id: string; body: string; createdAt: string; author: { name: string } }[]
    invites: { code: string; expiresAt: string }[]
  }
}

export default function TenantScreen() {
  const { id } = useLocalSearchParams<{ id: string }>()
  const qc = useQueryClient()
  const [noteText, setNoteText] = useState('')
  const [error, setError] = useState('')

  const { data, isLoading } = useQuery({ queryKey: ['tenant', id], queryFn: () => api<TenantDetail>(`/tenants/${id}`) })

  const invite = useMutation({
    mutationFn: () => api(`/tenants/${id}/invite`, { method: 'POST', body: {} }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['tenant', id] }),
    onError: (e) => setError((e as Error).message),
  })

  const addNote = useMutation({
    mutationFn: () => api(`/tenants/${id}/notes`, { method: 'POST', body: { body: noteText.trim() } }),
    onSuccess: () => {
      setNoteText('')
      qc.invalidateQueries({ queryKey: ['tenant', id] })
    },
    onError: (e) => setError((e as Error).message),
  })

  const archive = useMutation({
    mutationFn: () => api(`/tenants/${id}/archive`, { method: 'POST', body: {} }),
    onSuccess: async () => {
      qc.invalidateQueries()
      router.back()
    },
    onError: (e) => setError((e as Error).message),
  })

  if (isLoading || !data) return <Screen><Loading /></Screen>
  const t = data.tenant

  return (
    <Screen>
      <Stack.Screen options={{ title: t.fullName }} />
      <Card>
        <Row>
          <Body bold style={{ fontSize: 17 }}>{t.fullName}</Body>
          <Chip status={t.status} />
        </Row>
        {t.phone ? <KeyValue k="Phone" v={t.phone} /> : null}
        {t.email ? <KeyValue k="Email" v={t.email} /> : null}
        {t.emergencyName ? <KeyValue k="Emergency" v={`${t.emergencyName}${t.emergencyPhone ? ` · ${t.emergencyPhone}` : ''}`} /> : null}
      </Card>

      <Row style={{ gap: 8, marginBottom: 4 }}>
        <Button title="Edit" compact variant="secondary" onPress={() => router.push(`/tenant/${t.id}/edit`)} />
      </Row>

      <SectionHeader title="Tenant portal" />
      <Card>
        {t.user ? (
          <Body>✅ Portal account active ({t.user.email})</Body>
        ) : t.invites.length > 0 ? (
          <View>
            <Body bold style={{ fontSize: 18, letterSpacing: 2 }}>{t.invites[0].code}</Body>
            <Muted small>Share this invite code — valid until {fmtDate(t.invites[0].expiresAt)}. The tenant signs up in the app with it.</Muted>
          </View>
        ) : (
          <View>
            <Muted small>No portal account yet. Generate an invite code so this tenant can see their balance and submit maintenance requests.</Muted>
            <View style={{ marginTop: 10 }}>
              <Button title="Generate invite code" compact onPress={() => invite.mutate()} loading={invite.isPending} />
            </View>
          </View>
        )}
      </Card>

      <SectionHeader title="Leases" />
      {t.leases.length === 0 ? (
        <EmptyState title="No leases" hint="Create a lease from a vacant unit." />
      ) : (
        t.leases.map(({ lease }) => (
          <ListRow
            key={lease.id}
            title={`${lease.unit.property.name} · ${lease.unit.label}`}
            subtitle={`${fmtDate(lease.startDate)} → ${lease.endDate ? fmtDate(lease.endDate) : 'open'}`}
            right={<Chip status={lease.status} />}
            onPress={() => router.push(`/lease/${lease.id}`)}
          />
        ))
      )}

      <SectionHeader title="Notes" />
      <Card>
        <Field label="Add a note" value={noteText} onChangeText={setNoteText} multiline placeholder="Called about late rent…" />
        <Button title="Save note" compact variant="secondary" onPress={() => addNote.mutate()} loading={addNote.isPending} disabled={!noteText.trim()} />
      </Card>
      {t.notes.map((n) => (
        <Card key={n.id}>
          <Body>{n.body}</Body>
          <Muted small>{n.author.name} · {fmtDate(n.createdAt)}</Muted>
        </Card>
      ))}

      <DocumentsSection ownerType="TENANT" ownerId={t.id} title="Tenant documents" />

      <ErrorText>{error}</ErrorText>
      {t.status === 'ACTIVE' && (
        <>
          <SectionHeader title="Danger zone" />
          <ConfirmButton title="Archive tenant (mark as former)" onConfirm={() => archive.mutate()} />
        </>
      )}
    </Screen>
  )
}

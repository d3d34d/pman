import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { TextInput, View } from 'react-native'
import { api } from '@/lib/api'
import { fmtDate } from '@/lib/dates'
import { colors } from '@/lib/theme'
import { Body, Button, EmptyState, ErrorText, Loading, Muted, Screen } from './kit'

export type ThreadData = {
  messages: { id: string; body: string; createdAt: string; sender: { id: string; name: string; role: string } }[]
  meId: string
}

/** Message thread shared by the tenant portal and the manager's inbox. */
export function MessageThread({
  queryKey,
  listPath,
  sendPath,
  emptyHint,
}: {
  queryKey: unknown[]
  listPath: string
  sendPath: string
  emptyHint: string
}) {
  const qc = useQueryClient()
  const [draft, setDraft] = useState('')
  const [error, setError] = useState('')

  const { data, isLoading } = useQuery({
    queryKey,
    queryFn: () => api<ThreadData>(listPath),
    refetchInterval: 15_000,
  })

  const send = useMutation({
    mutationFn: (body: string) => api(sendPath, { method: 'POST', body: { body } }),
    onSuccess: () => {
      setDraft('')
      setError('')
      qc.invalidateQueries({ queryKey })
    },
    onError: (e) => setError((e as Error).message),
  })

  if (isLoading || !data) return <Screen><Loading /></Screen>

  return (
    <Screen>
      {data.messages.length === 0 ? (
        <EmptyState title="No messages yet" hint={emptyHint} />
      ) : (
        data.messages.map((m) => {
          const mine = m.sender.id === data.meId
          return (
            <View key={m.id} style={{ alignItems: mine ? 'flex-end' : 'flex-start', marginBottom: 10 }}>
              <View
                style={{
                  maxWidth: '85%',
                  backgroundColor: mine ? colors.primary : colors.card,
                  borderColor: colors.border,
                  borderWidth: mine ? 0 : 1,
                  borderRadius: 14,
                  paddingHorizontal: 12,
                  paddingVertical: 9,
                }}
              >
                <Body style={{ color: mine ? colors.white : colors.text }}>{m.body}</Body>
              </View>
              <View style={{ marginTop: 3 }}>
                <Muted small>
                  {mine ? 'You' : m.sender.name} · {fmtDate(m.createdAt)}
                </Muted>
              </View>
            </View>
          )
        })
      )}

      <View style={{ marginTop: 12 }}>
        <TextInput
          style={{
            backgroundColor: colors.card,
            borderWidth: 1,
            borderColor: colors.border,
            borderRadius: 10,
            paddingHorizontal: 12,
            paddingTop: 10,
            paddingBottom: 10,
            minHeight: 70,
            textAlignVertical: 'top',
            fontSize: 15,
            color: colors.text,
            marginBottom: 10,
          }}
          value={draft}
          onChangeText={setDraft}
          placeholder="Write a message…"
          placeholderTextColor="#9AA7B2"
          multiline
        />
        <ErrorText>{error}</ErrorText>
        <Button title="Send" onPress={() => send.mutate(draft.trim())} loading={send.isPending} disabled={!draft.trim()} />
      </View>
    </Screen>
  )
}

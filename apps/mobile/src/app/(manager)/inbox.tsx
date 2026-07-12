import { useQuery } from '@tanstack/react-query'
import { router } from 'expo-router'
import { api } from '@/lib/api'
import { fmtDate } from '@/lib/dates'
import { Chip, EmptyState, ListRow, Loading, Muted, Screen } from '@/ui/kit'

type Threads = {
  threads: {
    leaseId: string
    propertyName: string
    unitLabel: string
    tenants: string
    lastMessage: string
    lastAt: string
    unread: number
  }[]
}

export default function ManagerInbox() {
  const { data, isLoading } = useQuery({ queryKey: ['message-threads'], queryFn: () => api<Threads>('/messages'), refetchInterval: 20_000 })

  if (isLoading || !data) return <Screen><Loading /></Screen>

  return (
    <Screen>
      <Muted>Conversations with your tenants.</Muted>
      {data.threads.length === 0 ? (
        <EmptyState title="No messages" hint="Tenants can message you from their portal." />
      ) : (
        data.threads.map((t) => (
          <ListRow
            key={t.leaseId}
            title={t.tenants || `${t.propertyName} · ${t.unitLabel}`}
            subtitle={`${t.propertyName} · ${t.unitLabel} — ${t.lastMessage.slice(0, 50)}${t.lastMessage.length > 50 ? '…' : ''} · ${fmtDate(t.lastAt)}`}
            right={t.unread > 0 ? <Chip status="LATE" label={`${t.unread} new`} /> : undefined}
            onPress={() => router.push(`/lease/${t.leaseId}/messages`)}
          />
        ))
      )}
    </Screen>
  )
}

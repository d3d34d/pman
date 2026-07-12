import { useQuery } from '@tanstack/react-query'
import { router } from 'expo-router'
import { api } from '@/lib/api'
import { fmtDate } from '@/lib/dates'
import { Body, Button, Card, EmptyState, Loading, Muted, Row, Screen } from '@/ui/kit'

type Announcements = {
  announcements: { id: string; title: string; body: string; createdAt: string; property: { id: string; name: string } }[]
}

export default function AnnouncementsScreen() {
  const { data, isLoading } = useQuery({ queryKey: ['announcements'], queryFn: () => api<Announcements>('/announcements') })

  return (
    <Screen>
      <Row style={{ marginBottom: 12 }}>
        <Muted>Broadcasts appear in tenants&apos; portals.</Muted>
        <Button title="+ New" compact onPress={() => router.push('/properties')} />
      </Row>
      <Muted small>To post one, open a property and tap “Announce”.</Muted>

      {isLoading || !data ? (
        <Loading />
      ) : data.announcements.length === 0 ? (
        <EmptyState title="No announcements yet" />
      ) : (
        data.announcements.map((a) => (
          <Card key={a.id}>
            <Body bold>{a.title}</Body>
            <Muted small>{a.property.name} · {fmtDate(a.createdAt)}</Muted>
            <Body style={{ marginTop: 6 }}>{a.body}</Body>
          </Card>
        ))
      )}
    </Screen>
  )
}

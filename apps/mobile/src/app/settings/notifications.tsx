import { useQuery, useQueryClient } from '@tanstack/react-query'
import { router } from 'expo-router'
import { useEffect } from 'react'
import { Pressable, View } from 'react-native'
import { api } from '@/lib/api'
import { fmtDate } from '@/lib/dates'
import type { NotificationsResponse } from '@/lib/notifications-center'
import { colors } from '@/lib/theme'
import { Body, Card, EmptyState, Loading, Muted, Screen } from '@/ui/kit'

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  return fmtDate(iso)
}

export default function NotificationCenter() {
  const qc = useQueryClient()
  const { data, isLoading } = useQuery({
    queryKey: ['notifications'],
    queryFn: () => api<NotificationsResponse>('/me/notifications'),
  })

  // Opening the center clears the unread badge.
  useEffect(() => {
    if (data && data.unreadCount > 0) {
      api('/me/notifications/read-all', { method: 'POST', body: {} }).then(() => {
        qc.invalidateQueries({ queryKey: ['notifications-unread'] })
      })
    }
  }, [data, qc])

  if (isLoading || !data) return <Screen><Loading /></Screen>

  return (
    <Screen>
      {data.notifications.length === 0 ? (
        <EmptyState title="No notifications yet" hint="Payment activity and updates will show up here." />
      ) : (
        data.notifications.map((n) => (
          <Pressable key={n.id} onPress={() => n.data?.screen && router.push(n.data.screen as never)}>
            <Card style={!n.read ? { borderColor: colors.primary } : undefined}>
              <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 10 }}>
                {!n.read && <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: colors.primary, marginTop: 6 }} />}
                <View style={{ flex: 1 }}>
                  <Body bold>{n.title}</Body>
                  <Muted small>{n.body}</Muted>
                  <Muted small>{timeAgo(n.createdAt)}{n.data?.screen ? ' · tap to open' : ''}</Muted>
                </View>
              </View>
            </Card>
          </Pressable>
        ))
      )}
    </Screen>
  )
}

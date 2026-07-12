import { useQuery } from '@tanstack/react-query'
import { api } from './api'
import { useAuth } from './auth'

export type AppNotification = {
  id: string
  type: string
  title: string
  body: string
  data: { screen?: string; submissionId?: string } | null
  read: boolean
  createdAt: string
}

export type NotificationsResponse = { unreadCount: number; notifications: AppNotification[] }

/**
 * Live unread-notification count for the signed-in user. Polls so a badge
 * updates without a manual refresh. Disabled when logged out.
 */
export function useUnreadCount(): number {
  const { user } = useAuth()
  const { data } = useQuery({
    queryKey: ['notifications-unread'],
    queryFn: () => api<{ unreadCount: number }>('/me/notifications/unread-count'),
    enabled: !!user,
    refetchInterval: 20_000,
  })
  return data?.unreadCount ?? 0
}

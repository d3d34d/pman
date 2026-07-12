import { useLocalSearchParams } from 'expo-router'
import { MessageThread } from '@/ui/thread'

export default function LeaseMessages() {
  const { id } = useLocalSearchParams<{ id: string }>()
  return (
    <MessageThread
      queryKey={['lease-messages', id]}
      listPath={`/leases/${id}/messages`}
      sendPath={`/leases/${id}/messages`}
      emptyHint="Start a conversation with this tenant."
    />
  )
}

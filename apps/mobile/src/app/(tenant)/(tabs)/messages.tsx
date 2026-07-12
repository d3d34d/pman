import { MessageThread } from '@/ui/thread'

export default function TenantMessages() {
  return (
    <MessageThread
      queryKey={['portal-messages']}
      listPath="/portal/messages"
      sendPath="/portal/messages"
      emptyHint="Send your property manager a message — they'll see it right away."
    />
  )
}

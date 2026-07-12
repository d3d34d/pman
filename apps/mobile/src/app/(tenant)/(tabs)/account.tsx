import { router } from 'expo-router'
import { useAuth } from '@/lib/auth'
import { useUnreadCount } from '@/lib/notifications-center'
import { Body, Button, Card, Chip, ListRow, Muted, Screen, SectionHeader, Spacer } from '@/ui/kit'

export default function TenantMore() {
  const { user, signOut } = useAuth()
  const unread = useUnreadCount()

  return (
    <Screen>
      <Card>
        <Body bold>{user?.name}</Body>
        <Muted small>{user?.email}</Muted>
      </Card>

      <ListRow
        title="Notifications"
        subtitle="Payment updates and activity"
        right={unread > 0 ? <Chip status="LATE" label={`${unread} new`} /> : undefined}
        onPress={() => router.push('/settings/notifications')}
      />

      <SectionHeader title="Payments" />
      <ListRow title="Submit a payment" subtitle="Tell your manager you paid" onPress={() => router.push('/submit-payment')} />
      <ListRow title="Receipts & statement" subtitle="Payment history and CSV export" onPress={() => router.push('/receipts')} />

      <SectionHeader title="Your lease" />
      <ListRow title="Documents" subtitle="Lease agreement and shared files" onPress={() => router.push('/documents')} />
      <ListRow title="Message your manager" subtitle="Questions, renewals, anything" onPress={() => router.push('/messages')} />
      <ListRow title="Maintenance requests" subtitle="Report something broken" onPress={() => router.push('/requests')} />

      <SectionHeader title="Account" />
      <ListRow title="Edit profile" subtitle="Name, email, phone" onPress={() => router.push('/settings/profile')} />
      <ListRow title="Change password" subtitle="Signs you out on other devices" onPress={() => router.push('/settings/password')} />

      <Spacer h={20} />
      <Button
        title="Log out"
        variant="secondary"
        onPress={async () => {
          await signOut()
          router.replace("/welcome")
        }}
      />
      <Button title="Delete account" variant="ghost" onPress={() => router.push('/settings/delete-account')} />
    </Screen>
  )
}

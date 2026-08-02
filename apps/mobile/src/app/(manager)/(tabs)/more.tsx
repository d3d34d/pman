import { router } from 'expo-router'
import { Linking } from 'react-native'
import { PRIVACY_POLICY_URL } from '@/lib/legal'
import { useAuth } from '@/lib/auth'
import { useUnreadCount } from '@/lib/notifications-center'
import { Body, Button, Card, Chip, ListRow, Muted, Row, Screen, SectionHeader, Spacer } from '@/ui/kit'

export default function MoreScreen() {
  const { user, signOut } = useAuth()
  const unread = useUnreadCount()

  return (
    <Screen>
      <Card>
        <Body bold>{user?.name}</Body>
        <Muted small>{user?.email}</Muted>
      </Card>
      <Row style={{ gap: 8 }}>
        <Button title="Edit profile" compact variant="secondary" onPress={() => router.push('/settings/profile')} />
        <Button title="Change password" compact variant="secondary" onPress={() => router.push('/settings/password')} />
      </Row>

      <SectionHeader title="Manage" />
      <ListRow
        title="Notifications"
        subtitle="Payment activity and updates"
        right={unread > 0 ? <Chip status="LATE" label={`${unread} new`} /> : undefined}
        onPress={() => router.push('/settings/notifications')}
      />
      <ListRow title="Payment approvals" subtitle="Review tenant-submitted payments" onPress={() => router.push('/payment-approvals')} />
      <ListRow title="Messages" subtitle="Conversations with your tenants" onPress={() => router.push('/inbox')} />
      <ListRow title="All leases" subtitle="Every lease across your properties" onPress={() => router.push('/leases')} />
      <ListRow title="Maintenance" subtitle="Work orders and tenant requests" onPress={() => router.push('/maintenance')} />
      <ListRow title="Expenses" subtitle="Track property spending" onPress={() => router.push('/expenses')} />
      <ListRow title="Reports" subtitle="Income, delinquency, CSV export" onPress={() => router.push('/reports')} />
      <ListRow title="Announcements" subtitle="Broadcast messages to tenants" onPress={() => router.push('/announcements')} />

      <Spacer h={20} />
      <Button
        title="Log out"
        variant="secondary"
        onPress={async () => {
          await signOut()
          router.replace("/welcome")
        }}
      />
      <Button title="Privacy policy" variant="ghost" onPress={() => Linking.openURL(PRIVACY_POLICY_URL)} />
      <Button title="Delete account" variant="ghost" onPress={() => router.push('/settings/delete-account')} />
    </Screen>
  )
}

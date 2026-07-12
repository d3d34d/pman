import { Redirect, Stack } from 'expo-router'
import { useEffect } from 'react'
import { useAuth } from '@/lib/auth'
import { registerForPush } from '@/lib/push'
import { colors } from '@/lib/theme'
import { Loading, Screen } from '@/ui/kit'

export default function ManagerLayout() {
  const { ready, user } = useAuth()

  // Register this device for payment-review alerts once a manager is signed in.
  useEffect(() => {
    if (ready && user?.role === 'MANAGER') registerForPush()
  }, [ready, user?.role])

  if (!ready) {
    return (
      <Screen scroll={false}>
        <Loading />
      </Screen>
    )
  }
  if (!user) return <Redirect href="/welcome" />
  if (user.role !== 'MANAGER') return <Redirect href="/home" />

  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: colors.bg },
        headerShadowVisible: false,
        headerTintColor: colors.text,
        contentStyle: { backgroundColor: colors.bg },
      }}
    >
      <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
      <Stack.Screen name="property/new" options={{ title: 'New property' }} />
      <Stack.Screen name="property/[id]/index" options={{ title: 'Property' }} />
      <Stack.Screen name="property/[id]/add-unit" options={{ title: 'Add unit' }} />
      <Stack.Screen name="property/[id]/announce" options={{ title: 'New announcement' }} />
      <Stack.Screen name="unit/[id]" options={{ title: 'Unit' }} />
      <Stack.Screen name="tenant/new" options={{ title: 'Add tenant' }} />
      <Stack.Screen name="tenant/[id]/index" options={{ title: 'Tenant' }} />
      <Stack.Screen name="tenant/[id]/edit" options={{ title: 'Edit tenant' }} />
      <Stack.Screen name="lease/new" options={{ title: 'New lease' }} />
      <Stack.Screen name="lease/[id]/index" options={{ title: 'Lease' }} />
      <Stack.Screen name="lease/[id]/record-payment" options={{ title: 'Record payment' }} />
      <Stack.Screen name="lease/[id]/change-rent" options={{ title: 'Change rent' }} />
      <Stack.Screen name="lease/[id]/add-charge" options={{ title: 'Add charge' }} />
      <Stack.Screen name="lease/[id]/end" options={{ title: 'End lease' }} />
      <Stack.Screen name="lease/[id]/messages" options={{ title: 'Messages' }} />
      <Stack.Screen name="leases" options={{ title: 'All leases' }} />
      <Stack.Screen name="payment-approvals" options={{ title: 'Payment approvals' }} />
      <Stack.Screen name="inbox" options={{ title: 'Messages' }} />
      <Stack.Screen name="maintenance/index" options={{ title: 'Maintenance' }} />
      <Stack.Screen name="maintenance/new" options={{ title: 'New request' }} />
      <Stack.Screen name="maintenance/[id]" options={{ title: 'Request' }} />
      <Stack.Screen name="expenses/index" options={{ title: 'Expenses' }} />
      <Stack.Screen name="expenses/new" options={{ title: 'Add expense' }} />
      <Stack.Screen name="reports" options={{ title: 'Reports' }} />
      <Stack.Screen name="announcements" options={{ title: 'Announcements' }} />
    </Stack>
  )
}

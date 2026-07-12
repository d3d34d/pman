import { Redirect, Stack } from 'expo-router'
import { useEffect } from 'react'
import { useAuth } from '@/lib/auth'
import { registerForPush } from '@/lib/push'
import { colors } from '@/lib/theme'
import { Loading, Screen } from '@/ui/kit'

export default function TenantLayout() {
  const { ready, user } = useAuth()

  // Register this device for payment-review alerts once a tenant is signed in.
  useEffect(() => {
    if (ready && user?.role === 'TENANT') registerForPush()
  }, [ready, user?.role])

  if (!ready) {
    return (
      <Screen scroll={false}>
        <Loading />
      </Screen>
    )
  }
  if (!user) return <Redirect href="/welcome" />
  if (user.role !== 'TENANT') return <Redirect href="/dashboard" />

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
      <Stack.Screen name="request-new" options={{ title: 'New maintenance request' }} />
      <Stack.Screen name="submit-payment" options={{ title: 'Submit a payment' }} />
      <Stack.Screen name="receipts" options={{ title: 'Receipts' }} />
      <Stack.Screen name="receipt/[id]" options={{ title: 'Receipt' }} />
      <Stack.Screen name="documents" options={{ title: 'Lease documents' }} />
    </Stack>
  )
}

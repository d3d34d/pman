import { Redirect, Stack } from 'expo-router'
import { useAuth } from '@/lib/auth'
import { colors } from '@/lib/theme'

export default function AuthLayout() {
  const { ready, user } = useAuth()
  if (ready && user) {
    return <Redirect href={user.role === 'MANAGER' ? '/dashboard' : '/home'} />
  }
  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: colors.bg },
        headerShadowVisible: false,
        headerTintColor: colors.text,
        contentStyle: { backgroundColor: colors.bg },
      }}
    >
      <Stack.Screen name="welcome" options={{ headerShown: false }} />
      <Stack.Screen name="manager-login" options={{ title: 'Property Manager' }} />
      <Stack.Screen name="tenant-login" options={{ title: 'Tenant' }} />
      <Stack.Screen name="register" options={{ title: 'Create account' }} />
      <Stack.Screen name="invite" options={{ title: 'Tenant sign-up' }} />
    </Stack>
  )
}

import { Redirect, Stack } from 'expo-router'
import { useAuth } from '@/lib/auth'
import { colors } from '@/lib/theme'
import { Loading, Screen } from '@/ui/kit'

// Shared account screens, reachable by both roles.
export default function AccountLayout() {
  const { ready, user } = useAuth()
  if (!ready) {
    return (
      <Screen scroll={false}>
        <Loading />
      </Screen>
    )
  }
  if (!user) return <Redirect href="/welcome" />
  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: colors.bg },
        headerShadowVisible: false,
        headerTintColor: colors.text,
        contentStyle: { backgroundColor: colors.bg },
      }}
    >
      <Stack.Screen name="notifications" options={{ title: 'Notifications' }} />
      <Stack.Screen name="profile" options={{ title: 'Edit profile' }} />
      <Stack.Screen name="password" options={{ title: 'Change password' }} />
      <Stack.Screen name="delete-account" options={{ title: 'Delete account' }} />
    </Stack>
  )
}

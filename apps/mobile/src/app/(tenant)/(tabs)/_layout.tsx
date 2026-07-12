import { Tabs } from 'expo-router'
import { Text } from 'react-native'
import { useUnreadCount } from '@/lib/notifications-center'
import { colors } from '@/lib/theme'

function icon(glyph: string) {
  return ({ focused }: { focused: boolean }) => (
    <Text style={{ fontSize: 20, opacity: focused ? 1 : 0.45 }}>{glyph}</Text>
  )
}

export default function TenantTabs() {
  const unread = useUnreadCount()
  return (
    <Tabs
      screenOptions={{
        headerStyle: { backgroundColor: colors.bg },
        headerShadowVisible: false,
        headerTintColor: colors.text,
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.subtext,
        tabBarStyle: { backgroundColor: colors.card },
        sceneStyle: { backgroundColor: colors.bg },
      }}
    >
      <Tabs.Screen name="home" options={{ title: 'Home', tabBarIcon: icon('🏠') }} />
      <Tabs.Screen name="pay" options={{ title: 'Pay rent', tabBarIcon: icon('💳') }} />
      <Tabs.Screen name="messages" options={{ title: 'Messages', tabBarIcon: icon('💬') }} />
      <Tabs.Screen name="requests" options={{ title: 'Requests', tabBarIcon: icon('🔧') }} />
      <Tabs.Screen name="account" options={{ title: 'Account', tabBarIcon: icon('⚙️'), tabBarBadge: unread > 0 ? unread : undefined }} />
    </Tabs>
  )
}

import { Tabs } from 'expo-router'
import { Text } from 'react-native'
import { useUnreadCount } from '@/lib/notifications-center'
import { colors } from '@/lib/theme'

function icon(glyph: string) {
  return ({ focused }: { focused: boolean }) => (
    <Text style={{ fontSize: 20, opacity: focused ? 1 : 0.45 }}>{glyph}</Text>
  )
}

export default function ManagerTabs() {
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
      <Tabs.Screen name="dashboard" options={{ title: 'Dashboard', tabBarIcon: icon('📊') }} />
      <Tabs.Screen name="rent-roll" options={{ title: 'Rent', tabBarIcon: icon('💵') }} />
      <Tabs.Screen name="properties" options={{ title: 'Properties', tabBarIcon: icon('🏢') }} />
      <Tabs.Screen name="tenants" options={{ title: 'Tenants', tabBarIcon: icon('👥') }} />
      <Tabs.Screen name="more" options={{ title: 'More', tabBarIcon: icon('⚙️'), tabBarBadge: unread > 0 ? unread : undefined }} />
    </Tabs>
  )
}

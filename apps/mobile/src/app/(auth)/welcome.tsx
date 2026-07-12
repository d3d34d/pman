import { router } from 'expo-router'
import { Pressable, Text, View } from 'react-native'
import { colors } from '@/lib/theme'
import { Body, Muted, Screen, Spacer, Title } from '@/ui/kit'

function RoleCard({ glyph, title, subtitle, onPress }: { glyph: string; title: string; subtitle: string; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        {
          backgroundColor: colors.card,
          borderWidth: 1,
          borderColor: colors.border,
          borderRadius: 16,
          padding: 18,
          marginBottom: 14,
          flexDirection: 'row',
          alignItems: 'center',
          gap: 14,
        },
        pressed && { opacity: 0.7, borderColor: colors.primary },
      ]}
    >
      <View
        style={{
          width: 48,
          height: 48,
          borderRadius: 12,
          backgroundColor: colors.primarySoft,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Text style={{ fontSize: 24 }}>{glyph}</Text>
      </View>
      <View style={{ flex: 1 }}>
        <Body bold style={{ fontSize: 17 }}>{title}</Body>
        <Muted small>{subtitle}</Muted>
      </View>
      <Text style={{ fontSize: 24, color: colors.subtext }}>›</Text>
    </Pressable>
  )
}

export default function Welcome() {
  return (
    <Screen>
      <Spacer h={40} />
      <View style={{ alignItems: 'center' }}>
        <View
          style={{
            width: 64,
            height: 64,
            borderRadius: 16,
            backgroundColor: colors.primary,
            alignItems: 'center',
            justifyContent: 'center',
            marginBottom: 14,
          }}
        >
          <Text style={{ fontSize: 30 }}>🏠</Text>
        </View>
        <Title>PMAN</Title>
        <Muted>All-in-one property management</Muted>
      </View>

      <Spacer h={40} />
      <Muted small>Choose how you want to sign in</Muted>
      <Spacer h={10} />

      <RoleCard
        glyph="🏢"
        title="Property Manager"
        subtitle="Manage properties, leases, rent and tenants"
        onPress={() => router.push('/manager-login')}
      />
      <RoleCard
        glyph="🔑"
        title="Tenant"
        subtitle="Pay rent, see your lease, message your manager"
        onPress={() => router.push('/tenant-login')}
      />
    </Screen>
  )
}

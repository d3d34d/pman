import { router, useLocalSearchParams } from 'expo-router'
import { useEffect, useRef } from 'react'
import { Pressable, Text, View } from 'react-native'
import { api, DEMO } from '@/lib/api'
import { useAuth, type User } from '@/lib/auth'
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

/**
 * Demo shortcut: `?as=manager` or `?as=tenant` signs straight in, so a shared
 * link lands on the dashboard instead of a login form. Demo builds only —
 * `DEMO` is false in every real build, so this cannot bypass a real login.
 */
function useDemoAutoLogin() {
  const { as } = useLocalSearchParams<{ as?: string }>()
  const { signIn } = useAuth()
  const attempted = useRef(false)

  useEffect(() => {
    if (!DEMO || attempted.current) return
    const role = as === 'manager' ? 'MANAGER' : as === 'tenant' ? 'TENANT' : null
    if (!role) return
    attempted.current = true
    ;(async () => {
      try {
        const res = await api<{ token: string; user: User }>('/auth/login', {
          method: 'POST',
          body: {
            email: role === 'MANAGER' ? 'manager@pman.dev' : 'tenant@pman.dev',
            password: 'password123',
          },
        })
        await signIn(res.token, res.user)
        router.replace(role === 'MANAGER' ? '/dashboard' : '/home')
      } catch {
        // Fall through to the normal chooser.
      }
    })()
  }, [as, signIn])
}

export default function Welcome() {
  useDemoAutoLogin()
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

      {DEMO && (
        <View
          style={{
            marginTop: 10,
            backgroundColor: colors.primarySoft,
            borderWidth: 1,
            borderColor: colors.border,
            borderRadius: 14,
            padding: 16,
          }}
        >
          <Body bold>🧪 Live demo</Body>
          <Spacer h={6} />
          <Muted small>
            This runs on sample data right in your browser — no server, nothing to install. Sign in with either account
            (password <Text style={{ fontWeight: '700' }}>password123</Text>):
          </Muted>
          <Spacer h={8} />
          <Muted small>
            Manager · <Text style={{ fontWeight: '700' }}>manager@pman.dev</Text>
          </Muted>
          <Muted small>
            Tenant · <Text style={{ fontWeight: '700' }}>tenant@pman.dev</Text>
          </Muted>
          <Spacer h={8} />
          <Muted small>Everything is editable; your changes reset when you refresh the page.</Muted>
        </View>
      )}
    </Screen>
  )
}

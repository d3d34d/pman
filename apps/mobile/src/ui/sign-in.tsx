import { Link, router } from 'expo-router'
import type { Href } from 'expo-router'
import { useState } from 'react'
import { Text, View } from 'react-native'
import { api } from '@/lib/api'
import { useAuth, type User } from '@/lib/auth'
import { colors } from '@/lib/theme'
import { Button, ErrorText, Field, Muted, Screen, Spacer, Title } from './kit'

/**
 * Shared email/password sign-in, locked to one role. Signing in with the wrong
 * kind of account is rejected with a pointer to the other section, so the two
 * sign-in areas stay genuinely separate.
 */
export function SignInForm({
  role,
  heading,
  blurb,
  primaryAction,
  switchLabel,
  switchHref,
}: {
  role: 'MANAGER' | 'TENANT'
  heading: string
  blurb: string
  primaryAction: { label: string; href: Href }
  switchLabel: string
  switchHref: Href
}) {
  const { signIn } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit() {
    setError('')
    setBusy(true)
    try {
      const res = await api<{ token: string; user: User }>('/auth/login', {
        method: 'POST',
        body: { email: email.trim(), password },
      })
      if (res.user.role !== role) {
        // Right password, wrong section. Don't sign in here.
        setError(
          role === 'MANAGER'
            ? 'That’s a tenant account. Use the Tenant sign in instead.'
            : 'That’s a property-manager account. Use the Property Manager sign in instead.',
        )
        return
      }
      await signIn(res.token, res.user)
      router.replace(role === 'MANAGER' ? '/dashboard' : '/home')
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Screen>
      <Spacer h={12} />
      <Title>{heading}</Title>
      <Muted>{blurb}</Muted>
      <Spacer h={24} />
      <Field label="Email" value={email} onChangeText={setEmail} placeholder="you@example.com" keyboardType="email-address" autoCapitalize="none" />
      <Field label="Password" value={password} onChangeText={setPassword} placeholder="••••••••" secureTextEntry />
      <ErrorText>{error}</ErrorText>
      <Button title="Log in" onPress={submit} loading={busy} disabled={!email || !password} />
      <Spacer h={18} />
      <View style={{ alignItems: 'center', gap: 12 }}>
        <Link href={primaryAction.href}>
          <Text style={{ color: colors.primary, fontWeight: '600' }}>{primaryAction.label}</Text>
        </Link>
        <Link href={switchHref}>
          <Text style={{ color: colors.subtext, fontWeight: '600' }}>{switchLabel}</Text>
        </Link>
      </View>
    </Screen>
  )
}

import { Redirect, useLocalSearchParams } from 'expo-router'
import { useAuth } from '@/lib/auth'
import { Loading, Screen } from '@/ui/kit'

export default function Index() {
  const { ready, user } = useAuth()
  // Carry `?as=` through the redirect so a shared demo link like
  // `…/pman/?as=manager` reaches the welcome screen's auto-login.
  const { as } = useLocalSearchParams<{ as?: string }>()
  if (!ready) {
    return (
      <Screen scroll={false}>
        <Loading />
      </Screen>
    )
  }
  if (!user) return <Redirect href={as ? `/welcome?as=${as}` : '/welcome'} />

  if (user.role === 'MANAGER') return <Redirect href="/dashboard" />
  return <Redirect href="/home" />
}

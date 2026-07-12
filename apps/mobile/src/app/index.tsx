import { Redirect } from 'expo-router'
import { useAuth } from '@/lib/auth'
import { Loading, Screen } from '@/ui/kit'

export default function Index() {
  const { ready, user } = useAuth()
  if (!ready) {
    return (
      <Screen scroll={false}>
        <Loading />
      </Screen>
    )
  }
  if (!user) return <Redirect href="/welcome" />
  if (user.role === 'MANAGER') return <Redirect href="/dashboard" />
  return <Redirect href="/home" />
}

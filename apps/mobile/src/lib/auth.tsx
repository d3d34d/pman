import * as SecureStore from 'expo-secure-store'
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { Platform } from 'react-native'
import { api, ApiError, setApiToken } from './api'

export type User = {
  id: string
  email: string
  role: 'MANAGER' | 'TENANT'
  name: string
  phone: string | null
}

type AuthState = {
  ready: boolean
  user: User | null
  signIn: (token: string, user: User) => Promise<void>
  signOut: () => Promise<void>
  /** Persist updated profile fields after a PATCH /me. */
  updateUser: (user: User) => Promise<void>
  /** Replace the stored token (e.g. after a password change rotates sessions). */
  refreshToken: (token: string, user: User) => Promise<void>
}

const TOKEN_KEY = 'pman.token'
const USER_KEY = 'pman.user'

const storage = {
  async get(key: string): Promise<string | null> {
    if (Platform.OS === 'web') return typeof localStorage === 'undefined' ? null : localStorage.getItem(key)
    return SecureStore.getItemAsync(key)
  },
  async set(key: string, value: string): Promise<void> {
    if (Platform.OS === 'web') {
      localStorage.setItem(key, value)
      return
    }
    await SecureStore.setItemAsync(key, value)
  },
  async remove(key: string): Promise<void> {
    if (Platform.OS === 'web') {
      localStorage.removeItem(key)
      return
    }
    await SecureStore.deleteItemAsync(key)
  },
}

const AuthContext = createContext<AuthState | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false)
  const [user, setUser] = useState<User | null>(null)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const [token, storedUser] = await Promise.all([storage.get(TOKEN_KEY), storage.get(USER_KEY)])
        if (token && storedUser && !cancelled) {
          setApiToken(token)
          setUser(JSON.parse(storedUser))
          // Refresh the profile in the background. Only sign out when the
          // server actually rejects the token — a network failure (no signal,
          // server down) must NOT log someone out of their own app.
          api<{ user: User }>('/me')
            .then((res) => !cancelled && setUser(res.user))
            .catch((e: unknown) => {
              const rejected = e instanceof ApiError && (e.status === 401 || e.status === 403)
              if (!cancelled && rejected) {
                setApiToken(null)
                setUser(null)
                storage.remove(TOKEN_KEY)
                storage.remove(USER_KEY)
              }
            })
        }
      } finally {
        if (!cancelled) setReady(true)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  const value = useMemo<AuthState>(
    () => ({
      ready,
      user,
      async signIn(token, nextUser) {
        setApiToken(token)
        setUser(nextUser)
        await storage.set(TOKEN_KEY, token)
        await storage.set(USER_KEY, JSON.stringify(nextUser))
      },
      async signOut() {
        setApiToken(null)
        setUser(null)
        await storage.remove(TOKEN_KEY)
        await storage.remove(USER_KEY)
      },
      async updateUser(nextUser) {
        setUser(nextUser)
        await storage.set(USER_KEY, JSON.stringify(nextUser))
      },
      async refreshToken(token, nextUser) {
        setApiToken(token)
        setUser(nextUser)
        await storage.set(TOKEN_KEY, token)
        await storage.set(USER_KEY, JSON.stringify(nextUser))
      },
    }),
    [ready, user],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider')
  return ctx
}

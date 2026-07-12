import Constants from 'expo-constants'
import * as Notifications from 'expo-notifications'
import { Platform } from 'react-native'
import { api } from './api'

let registered = false

/**
 * Registers this device's Expo push token with the server so the user can
 * receive alerts (e.g. a manager when a tenant submits a payment).
 *
 * No-ops safely when it can't work:
 *  - on web (no native push),
 *  - in Expo Go on SDK 53+ (remote push needs a dev/production build),
 *  - before `eas init` provides a projectId.
 * The full server pipeline still works; this just lights up once the app runs
 * as a real build.
 */
export async function registerForPush(): Promise<void> {
  if (registered || Platform.OS === 'web') return

  const projectId =
    Constants.expoConfig?.extra?.eas?.projectId ?? (Constants as { easConfig?: { projectId?: string } }).easConfig?.projectId
  if (!projectId) {
    // Not built with EAS yet — nothing to register against.
    return
  }

  try {
    const perm = await Notifications.getPermissionsAsync()
    const granted = perm.granted || (await Notifications.requestPermissionsAsync()).granted
    if (!granted) return

    const { data: token } = await Notifications.getExpoPushTokenAsync({ projectId })
    await api('/me/push-token', { method: 'POST', body: { token, platform: Platform.OS } })
    registered = true
  } catch {
    // Expo Go / simulator / offline — silently skip; alerts arrive in a real build.
  }
}

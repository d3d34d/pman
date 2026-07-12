import { router } from 'expo-router'
import type { Href } from 'expo-router'

/** Go back, or land somewhere sensible when there is no history
 *  (deep link, notification tap, cold start on an inner screen). */
export function backOr(fallback: Href): void {
  if (router.canGoBack()) router.back()
  else router.replace(fallback)
}

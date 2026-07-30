import Constants from 'expo-constants'
import { Platform } from 'react-native'
import { handleDemo, handleDemoCsv, handleDemoUpload } from '../demo/backend'

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message)
  }
}

export const API_PORT = 4000

// DEMO MODE: the GitHub Pages build sets EXPO_PUBLIC_DEMO=1, which routes every
// call to an in-browser backend (../demo/backend) instead of a real server, so
// the static site works with the demo logins and full click-through. Off
// everywhere else (local dev, native builds) — there it talks to the real API.
export const DEMO = process.env.EXPO_PUBLIC_DEMO === '1'

/**
 * Where the app talks to the API.
 *
 * Release builds MUST be built with `EXPO_PUBLIC_API_URL` set to a public
 * https host (see apps/mobile/eas.json). There is deliberately no localhost
 * fallback in production: a shipped app has no Metro server to derive a host
 * from, so falling back would point every installed copy at the user's own
 * device and fail with a confusing network error. Failing loudly at build/run
 * time is far easier to diagnose than that.
 */
export function getBaseUrl(): string {
  const configured = process.env.EXPO_PUBLIC_API_URL?.trim()
  if (configured) return configured.replace(/\/+$/, '') // tolerate a trailing slash

  if (!__DEV__) {
    throw new ApiError(
      0,
      'This build has no API server configured. Rebuild with EXPO_PUBLIC_API_URL set to your API URL.',
    )
  }

  // Dev only: derive the API host from wherever Metro is serving the app, so a
  // physical phone on the same Wi-Fi reaches the dev machine with no config.
  const hostUri = Constants.expoConfig?.hostUri
  let host = hostUri ? hostUri.split(':')[0] : 'localhost'

  // An Android emulator is its own VM: `localhost` is the emulator itself, and
  // the host machine is reachable only via the 10.0.2.2 alias.
  if (Platform.OS === 'android' && (host === 'localhost' || host === '127.0.0.1')) {
    host = '10.0.2.2'
  }

  return `http://${host}:${API_PORT}`
}

let authToken: string | null = null

export function setApiToken(token: string | null) {
  authToken = token
}

type ApiOptions = {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
  body?: object
}

/**
 * Turns transport-level failures (airplane mode, server down, DNS) into a
 * message a real user can act on. `fetch` rejects with "Network request
 * failed" / "Failed to fetch", which tells a tenant nothing.
 */
function networkError(e: unknown): ApiError {
  if (e instanceof ApiError) return e
  return new ApiError(0, 'Can’t reach the server. Check your connection and try again.')
}

export async function api<T = unknown>(path: string, opts: ApiOptions = {}): Promise<T> {
  if (DEMO) {
    return (await handleDemo(opts.method ?? 'GET', path, opts.body ?? null, authToken)) as T
  }

  let res: Response
  try {
    res = await fetch(`${getBaseUrl()}${path}`, {
      method: opts.method ?? 'GET',
      headers: {
        ...(opts.body ? { 'content-type': 'application/json' } : {}),
        ...(authToken ? { authorization: `Bearer ${authToken}` } : {}),
      },
      body: opts.body ? JSON.stringify(opts.body) : undefined,
    })
  } catch (e) {
    throw networkError(e)
  }

  const text = await res.text()
  let json: unknown = {}
  try {
    json = text ? JSON.parse(text) : {}
  } catch {
    // A proxy/tunnel returned HTML (e.g. a 502 page) instead of our JSON.
    if (!res.ok) throw new ApiError(res.status, `Server error (${res.status}). Please try again.`)
    throw new ApiError(res.status, 'Unexpected response from the server.')
  }
  if (!res.ok) throw new ApiError(res.status, (json as { error?: string }).error ?? `Request failed (${res.status})`)
  return json as T
}

/** Resolve any image/file uri to a data: URL (DEMO mode only; web). */
async function toDataUrl(uri: string): Promise<string> {
  if (uri.startsWith('data:')) return uri
  const blob = await (await fetch(uri)).blob()
  return await new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = () => reject(new Error('Could not read the selected file'))
    reader.readAsDataURL(blob)
  })
}

/** Multipart upload that works on native (uri-based) and web (blob-based). */
export async function apiUpload<T = unknown>(
  path: string,
  file: { uri: string; name: string; mimeType?: string },
  fields: Record<string, string> = {},
): Promise<T> {
  if (DEMO) {
    const url = await toDataUrl(file.uri)
    return (await handleDemoUpload(path, { url, name: file.name, mimeType: file.mimeType ?? 'application/octet-stream' }, fields, authToken)) as T
  }

  const form = new FormData()
  for (const [k, v] of Object.entries(fields)) form.append(k, v)

  if (file.uri.startsWith('data:') || file.uri.startsWith('blob:')) {
    const blob = await (await fetch(file.uri)).blob()
    form.append('file', blob, file.name)
  } else {
    form.append('file', {
      uri: file.uri,
      name: file.name,
      type: file.mimeType ?? 'application/octet-stream',
    } as unknown as Blob)
  }

  const res = await fetch(`${getBaseUrl()}${path}`, {
    method: 'POST',
    headers: authToken ? { authorization: `Bearer ${authToken}` } : {},
    body: form,
  })
  const json = await res.json()
  if (!res.ok) throw new ApiError(res.status, (json as { error?: string }).error ?? 'Upload failed')
  return json as T
}

/**
 * Download an authenticated file (e.g. a report CSV). The endpoint is fetched
 * with the auth header, then delivered to the user: on web a browser download
 * is triggered; on native the file is written to the cache and the share sheet
 * is opened so it can be saved or emailed.
 */
export async function downloadFile(path: string, filename: string, mimeType = 'text/csv'): Promise<void> {
  if (DEMO) {
    const text = await handleDemoCsv(path, authToken)
    const blob = new Blob([text], { type: mimeType })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    document.body.appendChild(a)
    a.click()
    a.remove()
    URL.revokeObjectURL(url)
    return
  }

  const res = await fetch(`${getBaseUrl()}${path}`, {
    headers: authToken ? { authorization: `Bearer ${authToken}` } : {},
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new ApiError(res.status, text || `Download failed (${res.status})`)
  }

  if (Platform.OS === 'web') {
    const blob = await res.blob()
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    document.body.appendChild(a)
    a.click()
    a.remove()
    URL.revokeObjectURL(url)
    return
  }

  const text = await res.text()
  const { File, Paths } = await import('expo-file-system')
  const Sharing = await import('expo-sharing')
  const file = new File(Paths.cache, filename)
  file.create({ overwrite: true })
  file.write(text)
  if (await Sharing.isAvailableAsync()) {
    await Sharing.shareAsync(file.uri, { mimeType, UTI: 'public.comma-separated-values-text' })
  }
}

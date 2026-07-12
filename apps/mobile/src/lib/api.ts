import Constants from 'expo-constants'
import { Platform } from 'react-native'

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message)
  }
}

export const API_PORT = 4000

export function getBaseUrl(): string {
  if (process.env.EXPO_PUBLIC_API_URL) return process.env.EXPO_PUBLIC_API_URL

  // Derive the API host from wherever Metro is serving the app, so a physical
  // phone on the same Wi-Fi reaches the dev machine with no configuration.
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

export async function api<T = unknown>(path: string, opts: ApiOptions = {}): Promise<T> {
  const res = await fetch(`${getBaseUrl()}${path}`, {
    method: opts.method ?? 'GET',
    headers: {
      ...(opts.body ? { 'content-type': 'application/json' } : {}),
      ...(authToken ? { authorization: `Bearer ${authToken}` } : {}),
    },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  })
  const text = await res.text()
  const json = text ? JSON.parse(text) : {}
  if (!res.ok) throw new ApiError(res.status, (json as { error?: string }).error ?? `Request failed (${res.status})`)
  return json as T
}

/** Multipart upload that works on native (uri-based) and web (blob-based). */
export async function apiUpload<T = unknown>(
  path: string,
  file: { uri: string; name: string; mimeType?: string },
  fields: Record<string, string> = {},
): Promise<T> {
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

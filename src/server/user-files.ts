/**
 * Fetch a file from ONE volunteer's private file space, on the server (D12).
 *
 * The platform scopes "self" files to the x-user-id this worker sends. We send the
 * volunteer's ID — taken from the license_files row they created — so this can
 * only ever return that volunteer's own files, whatever path the row holds.
 * Called only from the openLicenseFile action after it has checked who's asking.
 */
import { platformWorkerFetch } from 'deepspace/worker'

export const LICENSE_MAX_BYTES = 5 * 1024 * 1024
export const LICENSE_MIMES = ['application/pdf', 'image/jpeg', 'image/png'] as const

/** Paths we accept: the app-origin file route, no traversal. */
export function isFilePath(path: string): boolean {
  return /^\/api\/files\/[^?#]+(\?[^#]*)?$/.test(path) && !path.includes('..') && !path.includes('//', 1)
}

export interface FetchedFile {
  bytes: Uint8Array
  mime: string
}

export async function fetchUserFile(
  env: { APP_IDENTITY_TOKEN?: string; DEEPSPACE_APP_ID: string } & Record<string, unknown>,
  ownerId: string,
  path: string,
): Promise<FetchedFile | null> {
  if (!isFilePath(path) || !ownerId) return null
  const headers = new Headers()
  headers.set('x-user-id', ownerId)
  if (env.APP_IDENTITY_TOKEN) {
    headers.set('x-app-identity-token', env.APP_IDENTITY_TOKEN)
    headers.set('x-app-id', env.DEEPSPACE_APP_ID)
  }
  const res = await platformWorkerFetch(
    env as never,
    new Request(`https://platform.internal${path.replace(/^\/api\/files/, '/internal/files')}`, { method: 'GET', headers }),
  )
  if (!res.ok) return null
  const buf = new Uint8Array(await res.arrayBuffer())
  if (buf.byteLength > LICENSE_MAX_BYTES) return null
  return { bytes: buf, mime: (res.headers.get('content-type') ?? '').split(';')[0] }
}

export function toBase64(bytes: Uint8Array): string {
  let bin = ''
  const CHUNK = 0x8000
  for (let i = 0; i < bytes.length; i += CHUNK) bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK))
  return btoa(bin)
}

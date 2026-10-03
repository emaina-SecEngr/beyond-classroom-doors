/**
 * Calling server actions from the browser.
 *
 * Every write in this app goes through a server action (the schemas grant members
 * no direct writes). The action route requires the caller's own JWT as a Bearer
 * token; the server derives identity from that token, never from params
 * (GUARDRAILS §1.1). The token is read per call and never stored or logged (§1.8).
 *
 * The result is always a value, never a throw, so pages can show the server's
 * refusal message as-is ("Sorry, someone just claimed this one.").
 */
import { getAuthToken } from 'deepspace'

export type ActionOutcome<T> = { success: true; data: T } | { success: false; error: string; code: string }

export async function callAction<T = unknown>(name: string, params: Record<string, unknown> = {}): Promise<ActionOutcome<T>> {
  const token = await getAuthToken()
  if (!token) return { success: false, error: 'Please sign in again.', code: 'signed_out' }

  let res: Response
  try {
    res = await fetch(`/api/actions/${encodeURIComponent(name)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(params),
    })
  } catch {
    return { success: false, error: 'Could not reach the server. Check your connection and try again.', code: 'network' }
  }

  if (res.status === 401) return { success: false, error: 'Your session expired. Please sign in again.', code: 'signed_out' }

  let body: unknown
  try {
    body = await res.json()
  } catch {
    return { success: false, error: `The server returned an unexpected response (${res.status}).`, code: 'bad_response' }
  }

  const b = body as { success?: boolean; data?: T; error?: string; code?: string }
  if (b && b.success === true) return { success: true, data: b.data as T }
  return {
    success: false,
    error: typeof b?.error === 'string' && b.error ? b.error : 'Something went wrong. Please try again.',
    code: typeof b?.code === 'string' ? b.code : 'error',
  }
}

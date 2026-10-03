/**
 * Shared types and helpers for the admin views (Approvals page, Staff desk).
 * Display only — every action is re-checked on the server.
 */
import { useEffect, useState } from 'react'
import { callAction } from '../../lib/actions'
import type { VolunteerStatusRow } from '../../lib/me'

export interface Access {
  nonprofitAdmin: boolean
  canVet: boolean
  vettingHelpEndsAt: number | null
}
export const NO_ACCESS: Access = { nonprofitAdmin: false, canVet: false, vettingHelpEndsAt: null }

/** Ask the server who I am (nonprofit admin? may I decide on volunteers?). null while loading. */
export function useAccess(enabled = true): Access | null {
  const [access, setAccess] = useState<Access | null>(null)
  useEffect(() => {
    if (!enabled) return
    let live = true
    void callAction<Access>('myAccess').then((r) => {
      if (live) setAccess(r.success ? r.data : NO_ACCESS)
    })
    return () => {
      live = false
    }
  }, [enabled])
  return enabled ? access : NO_ACCESS
}

/** Set when the program admin has seen Approvals this browser session (see home.tsx). */
export const ADMIN_LANDED_KEY = 'bcd:admin-landed'

export function markAdminLanded(): void {
  try {
    sessionStorage.setItem(ADMIN_LANDED_KEY, '1')
  } catch {
    // Storage blocked: home.tsx treats that as "already landed", so no redirect loop.
  }
}

export interface Person {
  id: string
  name: string
  email: string
  platformRole: string
}

export interface StatusRow extends VolunteerStatusRow {
  identityConfirmed?: boolean | number
  qualificationType?: string
  clearanceExpiresAt?: number | null
}

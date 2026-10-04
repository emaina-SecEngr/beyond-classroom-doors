/**
 * Who am I in this app? Combines the DeepSpace session with this app's own records.
 *
 * This is for DISPLAY ONLY — choosing which links and buttons to show. Every
 * permission is enforced again on the server (schemas + server actions), so a
 * user who edits this in the browser gains nothing (GUARDRAILS §1.2).
 */
import { useAuthProfileReady, useQuery } from 'deepspace'
import type { AppRole, VolunteerStatus } from '../schemas/shared'

export interface ProfileRow {
  userId: string
  displayName: string
  profession: string
  employer: string
  skills?: string
  yearsExperience?: number | null
  hobbies?: string
  phone?: string
  accessNeeds?: string
  licenseType?: string
  licenseNumber?: string
  licenseState?: string
  preferredDistrict?: string
  preferredSchools?: string[]
}

export interface VolunteerStatusRow {
  userId: string
  status: VolunteerStatus
  clearanceExpiresAt?: number | null
  decisionReason?: string
}

export interface Me {
  /** Auth and the user's own records have loaded. */
  ready: boolean
  signedIn: boolean
  userId: string | null
  name: string
  isStaff: boolean
  appRole: AppRole | null
  /** The teacher's school (D9), if any. */
  schoolId: string | null
  profile: ProfileRow | null
  volunteer: VolunteerStatusRow | null
  canClaim: boolean
}

export function useMe(): Me {
  const { isLoaded, isSignedIn, user, userLoading, userId } = useAuthProfileReady({ requireUser: true })
  // Each of these is readable only by its owner (or staff), so filtering by my id
  // returns at most one row. Signed out, we query a sentinel that matches nothing.
  const me = userId ?? '__signed_out__'
  const roles = useQuery<{ userId: string; role: AppRole; schoolId?: string }>('role_assignments', { where: { userId: me }, limit: 1 })
  const statuses = useQuery<VolunteerStatusRow>('volunteer_status', { where: { userId: me }, limit: 1 })
  const profiles = useQuery<ProfileRow>('profiles', { where: { userId: me }, limit: 1 })

  const signedIn = isLoaded && isSignedIn
  const recordsReady = !signedIn || (roles.status !== 'loading' && statuses.status !== 'loading' && profiles.status !== 'loading')
  const volunteer = statuses.records[0]?.data ?? null
  const clearanceOk = (volunteer?.clearanceExpiresAt ?? 0) > Date.now() / 1000

  return {
    ready: isLoaded && (!isSignedIn || (!userLoading && !!user)) && recordsReady,
    signedIn,
    userId: signedIn ? userId : null,
    name: profiles.records[0]?.data.displayName || user?.name || '',
    isStaff: user?.role === 'admin',
    appRole: roles.records[0]?.data.role ?? null,
    schoolId: roles.records[0]?.data.schoolId ?? null,
    profile: profiles.records[0]?.data ?? null,
    volunteer,
    canClaim: volunteer?.status === 'approved' && clearanceOk,
  }
}

/**
 * Who may make someone program staff (decision R6).
 *
 * Staff = DeepSpace `admin`. Out of the box, DeepSpace lets ANY admin change ANY
 * user's role to ANY value over the realtime connection (useUsers().setRole),
 * with no audit entry. That would let one staff member quietly make others staff.
 *
 * This app narrows it: only the NONPROFIT ADMIN — the account that owns the app on
 * DeepSpace (OWNER_USER_ID, proven by the platform) — may grant or remove staff,
 * only between 'admin' and 'member', never on their own account. The worker's
 * AppRecordRoom applies this decision before DeepSpace's handler runs, and audits
 * every grant, removal and refused attempt.
 *
 * Pure function so it can be unit-tested (staff-guard.test.ts).
 */

export const SET_ROLE_MESSAGE = 'user.set_role'

export type StaffRole = 'admin' | 'member'

export type SetRoleDecision =
  | { allow: true; targetId: string; role: StaffRole }
  | { allow: false; targetId: string; error: string }

export function isSetRoleMessage(msg: unknown): msg is { type: string; payload?: unknown } {
  return typeof msg === 'object' && msg !== null && (msg as { type?: unknown }).type === SET_ROLE_MESSAGE
}

export function decideSetRole(callerId: string, ownerId: string | undefined, payload: unknown): SetRoleDecision {
  const p = (typeof payload === 'object' && payload !== null ? payload : {}) as { userId?: unknown; role?: unknown }
  const targetId = typeof p.userId === 'string' ? p.userId : ''

  if (!ownerId || !callerId || callerId !== ownerId) {
    return { allow: false, targetId, error: 'Only the nonprofit admin can change who is program staff.' }
  }
  if (!targetId) return { allow: false, targetId, error: 'Choose a person.' }
  if (targetId === ownerId) return { allow: false, targetId, error: 'The nonprofit admin’s own access can’t be changed here.' }
  if (p.role !== 'admin' && p.role !== 'member') {
    return { allow: false, targetId, error: 'Staff access can only be granted or removed.' }
  }
  return { allow: true, targetId, role: p.role }
}

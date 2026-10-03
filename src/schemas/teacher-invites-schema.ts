import type { CollectionSchema } from 'deepspace/schema'
import { STAFF_READ_ONLY, select } from './shared'

export const INVITE_STATUSES = ['pending', 'accepted', 'revoked'] as const

/**
 * Teacher invites (decision D10). The program admin (or staff) lists a school's
 * teachers by name and school email before they've signed in. When someone signs
 * in with that email, `acceptTeacherInvite` gives them teacher access at that
 * school. The email compared is the one on their DeepSpace account (verified at
 * sign-in) — never one the browser sends.
 *
 * Emails are personal data: members can't read this collection at all; staff can.
 * One invite per email (uniqueOn). Revoking keeps the row, so the history stays.
 */
export const teacherInvitesSchema: CollectionSchema = {
  name: 'teacher_invites',
  columns: [
    { name: 'email', storage: 'text', interpretation: 'plain', required: true },
    { name: 'name', storage: 'text', interpretation: 'plain', required: true },
    { name: 'schoolId', storage: 'text', interpretation: 'plain', required: true },
    { name: 'invitedBy', storage: 'text', interpretation: 'plain', required: true },
    { name: 'status', storage: 'text', interpretation: select(INVITE_STATUSES), required: true },
    { name: 'acceptedBy', storage: 'text', interpretation: 'plain' },
  ],
  uniqueOn: ['email'],
  permissions: {
    member: { read: false, create: false, update: false, delete: false },
    admin: STAFF_READ_ONLY,
  },
}

import type { CollectionSchema } from 'deepspace/schema'
import { SESSION_INVITE_STATUSES, STAFF_READ_ONLY, select } from './shared'

/**
 * A teacher invites an approved volunteer to one of her open sessions (D18).
 *
 * Readable by the invited volunteer (owner), the inviting teacher (in `collaborators`)
 * and staff. Written only by inviteVolunteer / respondToInvite / claim actions.
 * One invite per (session, volunteer). `replyEmail` is the TEACHER's own email, set
 * only if she ticked "include my email"; the volunteer's contact details are never here.
 */
export const sessionInvitesSchema: CollectionSchema = {
  name: 'session_invites',
  columns: [
    { name: 'sessionId', storage: 'text', interpretation: 'plain', required: true, immutable: true },
    { name: 'teacherId', storage: 'text', interpretation: 'plain', required: true, immutable: true },
    { name: 'volunteerId', storage: 'text', interpretation: 'plain', required: true, immutable: true },
    { name: 'teacherName', storage: 'text', interpretation: 'plain' },
    { name: 'note', storage: 'text', interpretation: 'plain' },
    { name: 'replyEmail', storage: 'text', interpretation: 'plain' },
    { name: 'status', storage: 'text', interpretation: select(SESSION_INVITE_STATUSES), required: true },
    { name: 'collaborators', storage: 'text', interpretation: { kind: 'json' } },
  ],
  uniqueOn: ['sessionId', 'volunteerId'],
  ownerField: 'volunteerId',
  collaboratorsField: 'collaborators',
  permissions: {
    member: { read: 'collaborator', create: false, update: false, delete: false },
    admin: STAFF_READ_ONLY,
  },
}

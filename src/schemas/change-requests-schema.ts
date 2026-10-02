import type { CollectionSchema } from 'deepspace/schema'
import { CHANGE_REQUEST_KINDS, CHANGE_REQUEST_STATUSES, STAFF_READ_ONLY, select } from './shared'

/**
 * Late cancellation or reschedule requests (SH6), handled by staff.
 * Readable by the requesting volunteer (owner), the owning teacher (in
 * `collaborators`, so they see a "change pending" flag) and staff.
 * Created by the volunteer's `requestChange` action; resolved by staff's action.
 */
export const changeRequestsSchema: CollectionSchema = {
  name: 'change_requests',
  columns: [
    { name: 'claimId', storage: 'text', interpretation: 'plain', required: true, immutable: true },
    { name: 'sessionId', storage: 'text', interpretation: 'plain', required: true, immutable: true },
    { name: 'volunteerId', storage: 'text', interpretation: 'plain', required: true, immutable: true },
    { name: 'kind', storage: 'text', interpretation: select(CHANGE_REQUEST_KINDS), required: true, immutable: true },
    { name: 'note', storage: 'text', interpretation: 'plain', immutable: true },
    { name: 'status', storage: 'text', interpretation: select(CHANGE_REQUEST_STATUSES), required: true },
    { name: 'resolvedBy', storage: 'text', interpretation: 'plain' },
    { name: 'collaborators', storage: 'text', interpretation: { kind: 'json' } },
  ],
  ownerField: 'volunteerId',
  collaboratorsField: 'collaborators',
  permissions: {
    member: { read: 'collaborator', create: false, update: false, delete: false },
    admin: STAFF_READ_ONLY,
  },
}

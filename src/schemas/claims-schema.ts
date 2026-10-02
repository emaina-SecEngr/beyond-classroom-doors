import type { CollectionSchema } from 'deepspace/schema'
import { CLAIM_STATUSES, STAFF_READ_ONLY, select } from './shared'

/**
 * A volunteer's claim on a session (M7, SH5, SH6).
 *
 * One ACTIVE claim per session, enforced by the database: `uniqueOn: ['activeSlot']`,
 * where activeSlot = sessionId while the claim is active and `withdrawn:<claimId>`
 * after withdrawal. Two simultaneous claims → one winner (standing test 3); a
 * withdrawn session can be claimed again without deleting history (standing test 15).
 *
 * Readable by the claimant (owner), the owning teacher (in `collaborators`), and staff.
 * Written only by claim / confirm / withdraw server actions. Never deleted (P3).
 */
export const claimsSchema: CollectionSchema = {
  name: 'claims',
  columns: [
    { name: 'sessionId', storage: 'text', interpretation: 'plain', required: true, immutable: true },
    { name: 'volunteerId', storage: 'text', interpretation: 'plain', required: true, immutable: true },
    { name: 'status', storage: 'text', interpretation: select(CLAIM_STATUSES), required: true },
    { name: 'activeSlot', storage: 'text', interpretation: 'plain', required: true },
    { name: 'confirmedAt', storage: 'number', interpretation: { kind: 'datetime' } },
    { name: 'withdrawnAt', storage: 'number', interpretation: { kind: 'datetime' } },
    { name: 'collaborators', storage: 'text', interpretation: { kind: 'json' } },
  ],
  uniqueOn: ['activeSlot'],
  ownerField: 'volunteerId',
  collaboratorsField: 'collaborators',
  permissions: {
    member: { read: 'collaborator', create: false, update: false, delete: false },
    admin: STAFF_READ_ONLY,
  },
}

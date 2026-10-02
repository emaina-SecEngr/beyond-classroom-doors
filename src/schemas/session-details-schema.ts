import type { CollectionSchema } from 'deepspace/schema'
import { STAFF_READ_ONLY } from './shared'

/**
 * Private logistics for a session (M5-AC2, P2): room, exact start time, notes.
 * Readable by the owning teacher (owner) and whoever is in `collaborators` — set by
 * `claimSession` to [claimantId] and cleared on withdrawal. Nobody else, including
 * other volunteers browsing the board, can read it. One row per session.
 */
export const sessionDetailsSchema: CollectionSchema = {
  name: 'session_details',
  columns: [
    { name: 'sessionId', storage: 'text', interpretation: 'plain', required: true, immutable: true },
    { name: 'teacherId', storage: 'text', interpretation: 'plain', required: true, immutable: true },
    { name: 'room', storage: 'text', interpretation: 'plain' },
    { name: 'startTime', storage: 'text', interpretation: 'plain' },
    { name: 'arrivalNote', storage: 'text', interpretation: 'plain' },
    { name: 'teacherNote', storage: 'text', interpretation: 'plain' },
    { name: 'collaborators', storage: 'text', interpretation: { kind: 'json' } },
  ],
  uniqueOn: ['sessionId'],
  ownerField: 'teacherId',
  collaboratorsField: 'collaborators',
  permissions: {
    member: { read: 'collaborator', create: false, update: false, delete: false },
    admin: STAFF_READ_ONLY,
  },
}

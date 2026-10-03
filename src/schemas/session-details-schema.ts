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
    // Session prep (D11). Teacher/staff: class, student count, which items are ready.
    // Volunteer (claimant): which items they need. Volunteer name is copied in at claim
    // time so the teacher can see who is coming (teachers can't read profiles).
    { name: 'classLabel', storage: 'text', interpretation: 'plain' },
    { name: 'studentCount', storage: 'number', interpretation: 'plain' },
    { name: 'equipmentRequested', storage: 'text', interpretation: { kind: 'json' } },
    { name: 'equipmentOther', storage: 'text', interpretation: 'plain' },
    { name: 'equipmentReady', storage: 'text', interpretation: { kind: 'json' } },
    { name: 'volunteerName', storage: 'text', interpretation: 'plain' },
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

import type { CollectionSchema } from 'deepspace/schema'
import { GRADES, SESSION_STATUSES, STAFF_READ_ONLY, TIME_BANDS, TOPICS, select } from './shared'

/**
 * The public face of a session — what the live board shows (M5, M6).
 * Deliberately minimal (P2): grade, topic, date and a time band. Room, exact time and
 * notes live in `session_details`, readable only by the teacher and the claimant.
 * Any signed-in member can read open requests, including unvetted applicants, so
 * nothing sensitive may be added here. `teacherId` is an opaque id; with
 * `roster: 'read-policy'` on users it does not resolve to a name.
 * Written only by server actions (create / cancel by the owning teacher; status
 * changes by claim / confirm / withdraw / report). Never deleted (P3).
 */
export const sessionRequestsSchema: CollectionSchema = {
  name: 'session_requests',
  columns: [
    { name: 'teacherId', storage: 'text', interpretation: 'plain', required: true, immutable: true },
    { name: 'grade', storage: 'text', interpretation: select(GRADES), required: true },
    { name: 'topic', storage: 'text', interpretation: select(TOPICS), required: true },
    { name: 'topicOther', storage: 'text', interpretation: 'plain' },
    { name: 'sessionDate', storage: 'number', interpretation: { kind: 'date' }, required: true },
    { name: 'timeBand', storage: 'text', interpretation: select(TIME_BANDS), required: true },
    { name: 'expectedHeadcount', storage: 'number', interpretation: 'plain' },
    { name: 'status', storage: 'text', interpretation: select(SESSION_STATUSES), required: true },
    // Copied from the teacher's assignment by createSessionRequest (D9); never from the client.
    { name: 'schoolId', storage: 'text', interpretation: 'plain', immutable: true },
  ],
  ownerField: 'teacherId',
  permissions: {
    member: { read: true, create: false, update: false, delete: false },
    admin: STAFF_READ_ONLY,
  },
}

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
    // D13: contact between the booked volunteer and the teacher. This row is readable
    // only by the teacher (owner), the booked volunteer (collaborator) and staff.
    { name: 'volunteerEmail', storage: 'text', interpretation: 'plain' },
    { name: 'volunteerPhone', storage: 'text', interpretation: 'plain' },
    { name: 'teacherEmail', storage: 'text', interpretation: 'plain' },
    { name: 'teacherName', storage: 'text', interpretation: 'plain' },
    // D17: the teacher's phone from their profile, copied at booking for the booked volunteer.
    { name: 'teacherPhone', storage: 'text', interpretation: 'plain' },
    // D18: the teacher's prep checklist for the volunteer's visit: [{ label, done }].
    { name: 'prepChecklist', storage: 'text', interpretation: { kind: 'json' } },
    // D14: the booked volunteer's access needs for this visit (private row).
    { name: 'accessNeeds', storage: 'text', interpretation: 'plain' },
    // D13: the teacher confirms the class is ready; either side can propose a new date.
    { name: 'readyAt', storage: 'number', interpretation: { kind: 'datetime' } },
    { name: 'proposedDate', storage: 'number', interpretation: { kind: 'date' } },
    { name: 'proposedTimeBand', storage: 'text', interpretation: 'plain' },
    { name: 'proposedBy', storage: 'text', interpretation: 'plain' },
    { name: 'proposedNote', storage: 'text', interpretation: 'plain' },
    // D20: thank-you perks for the booked volunteer: { mealUberEats?, mealGrubhub?,
    // rideDining?, rideAirport? } → voucher links. Set by the program admin or the
    // school's staff (`setSessionPerks`); cleared on withdraw or cancel.
    { name: 'perks', storage: 'text', interpretation: { kind: 'json' } },
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

import type { CollectionSchema } from 'deepspace/schema'
import { STAFF_READ_ONLY } from './shared'

/**
 * Teacher profile (D17). One row per teacher; recordId = userId.
 * Written only by the `saveTeacherProfile` action (teachers only). The school is NOT
 * here: it comes from the teacher's role assignment, set by the program admin (D9).
 * Name and phone are copied into a session's private details when a volunteer books,
 * so only that volunteer (and staff) see them.
 */
export const teacherProfilesSchema: CollectionSchema = {
  name: 'teacher_profiles',
  columns: [
    { name: 'userId', storage: 'text', interpretation: 'plain', required: true, immutable: true },
    { name: 'displayName', storage: 'text', interpretation: 'plain', required: true },
    { name: 'subject', storage: 'text', interpretation: 'plain' },
    { name: 'grades', storage: 'text', interpretation: { kind: 'json' } },
    { name: 'phone', storage: 'text', interpretation: 'plain' },
  ],
  uniqueOn: ['userId'],
  ownerField: 'userId',
  permissions: {
    member: { read: 'own', create: false, update: false, delete: false },
    admin: STAFF_READ_ONLY,
  },
}

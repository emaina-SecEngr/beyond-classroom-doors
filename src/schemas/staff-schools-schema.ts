import type { CollectionSchema } from 'deepspace/schema'
import { STAFF_READ_ONLY } from './shared'

/**
 * Which school each program staff member works with (decision D11).
 * Set only by the program admin (assignStaffSchool). Staff may change sessions
 * only at their school — enforced in the session actions. One row per staff
 * member, keyed by their user ID.
 */
export const staffSchoolsSchema: CollectionSchema = {
  name: 'staff_schools',
  columns: [
    { name: 'userId', storage: 'text', interpretation: 'plain', required: true, immutable: true },
    { name: 'schoolId', storage: 'text', interpretation: 'plain', required: true },
    { name: 'assignedBy', storage: 'text', interpretation: 'plain', required: true },
  ],
  uniqueOn: ['userId'],
  ownerField: 'userId',
  permissions: {
    member: { read: 'own', create: false, update: false, delete: false },
    admin: STAFF_READ_ONLY,
  },
}

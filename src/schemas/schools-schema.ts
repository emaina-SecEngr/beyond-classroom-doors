import type { CollectionSchema } from 'deepspace/schema'
import { STAFF_READ_ONLY } from './shared'

/**
 * Schools in the district that take part (decision D9).
 *
 * The program admin adds and edits schools (createSchool / updateSchool actions).
 * School names and front-office addresses are public information, so every
 * signed-in member can read them: the board shows which school a session is at,
 * and a booked volunteer needs the address. No student data lives here.
 * `active: false` hides a school from new teacher assignments and the board
 * filter without deleting its history.
 */
export const schoolsSchema: CollectionSchema = {
  name: 'schools',
  columns: [
    { name: 'name', storage: 'text', interpretation: 'plain', required: true },
    { name: 'district', storage: 'text', interpretation: 'plain' },
    { name: 'city', storage: 'text', interpretation: 'plain' },
    { name: 'address', storage: 'text', interpretation: 'plain' },
    { name: 'active', storage: 'number', interpretation: { kind: 'boolean' }, required: true },
    { name: 'createdByUser', storage: 'text', interpretation: 'plain', required: true },
  ],
  uniqueOn: ['name'],
  permissions: {
    member: { read: true, create: false, update: false, delete: false },
    admin: STAFF_READ_ONLY,
  },
}

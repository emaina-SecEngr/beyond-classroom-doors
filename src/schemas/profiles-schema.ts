import type { CollectionSchema } from 'deepspace/schema'
import { STAFF_READ_ONLY } from './shared'

/**
 * Volunteer profile (M1). One row per user; recordId = userId.
 * Written only by the `saveProfile` server action, because changing profession or
 * employer after vetting must reset status to `applied` (M1-AC4) — a plain client
 * write could not trigger that.
 * Display name lives here because `users.name` is system-managed (SDK refuses writes).
 */
export const profilesSchema: CollectionSchema = {
  name: 'profiles',
  columns: [
    { name: 'userId', storage: 'text', interpretation: 'plain', required: true, immutable: true },
    { name: 'displayName', storage: 'text', interpretation: 'plain', required: true },
    { name: 'profession', storage: 'text', interpretation: 'plain', required: true },
    { name: 'employer', storage: 'text', interpretation: 'plain' },
    // D12: richer volunteer profile. Read only by the volunteer and staff.
    { name: 'skills', storage: 'text', interpretation: 'plain' },
    { name: 'yearsExperience', storage: 'number', interpretation: 'plain' },
    { name: 'hobbies', storage: 'text', interpretation: 'plain' },
    // D13: optional phone, shared only with the teacher of a session they're booked for.
    { name: 'phone', storage: 'text', interpretation: 'plain' },
    // D14: what would help the volunteer on the day (step-free route, parking...). Optional,
    // never a diagnosis; copied only to sessions they book, for that teacher and staff.
    { name: 'accessNeeds', storage: 'text', interpretation: 'plain' },
    // License the volunteer reports; the program admin verifies it on the state's public lookup.
    { name: 'licenseType', storage: 'text', interpretation: 'plain' },
    { name: 'licenseNumber', storage: 'text', interpretation: 'plain' },
    { name: 'licenseState', storage: 'text', interpretation: 'plain' },
    // D17: where the volunteer would like to go — a district and up to five school IDs.
    { name: 'preferredDistrict', storage: 'text', interpretation: 'plain' },
    { name: 'preferredSchools', storage: 'text', interpretation: { kind: 'json' } },
  ],
  uniqueOn: ['userId'],
  ownerField: 'userId',
  permissions: {
    member: { read: 'own', create: false, update: false, delete: false },
    admin: STAFF_READ_ONLY,
  },
}

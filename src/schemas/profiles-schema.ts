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
  ],
  uniqueOn: ['userId'],
  ownerField: 'userId',
  permissions: {
    member: { read: 'own', create: false, update: false, delete: false },
    admin: STAFF_READ_ONLY,
  },
}

import type { CollectionSchema } from 'deepspace/schema'
import { STAFF_READ_ONLY } from './shared'

/**
 * Vetting help (decision R7). Vetting is the nonprofit admin's job. When the admin
 * can't do it (away, overloaded), they can ask ONE staff member at a time — or
 * several — to vet, for a limited time and with a reason. One row per staff member,
 * keyed by their user ID; ending help sets `endsAt` to now rather than deleting,
 * so the history stays (with the audit log as the full trail).
 *
 * Written only by the owner-only `grantVettingHelp` / `endVettingHelp` actions.
 * A staff member can read their own row so the desk knows to show the vetting queue;
 * `vetVolunteer` re-checks it on the server every time.
 */
export const vettingHelpSchema: CollectionSchema = {
  name: 'vetting_help',
  columns: [
    { name: 'userId', storage: 'text', interpretation: 'plain', required: true, immutable: true },
    { name: 'grantedBy', storage: 'text', interpretation: 'plain', required: true },
    { name: 'reason', storage: 'text', interpretation: 'plain', required: true },
    { name: 'startsAt', storage: 'number', interpretation: { kind: 'datetime' }, required: true },
    { name: 'endsAt', storage: 'number', interpretation: { kind: 'datetime' }, required: true },
  ],
  uniqueOn: ['userId'],
  ownerField: 'userId',
  permissions: {
    member: { read: 'own', create: false, update: false, delete: false },
    admin: STAFF_READ_ONLY,
  },
}

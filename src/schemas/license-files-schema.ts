import type { CollectionSchema } from 'deepspace/schema'
import { STAFF_READ_ONLY } from './shared'

/**
 * License documents a volunteer uploaded (decision D12).
 *
 * The file itself lives in the volunteer's PRIVATE file space ("self" scope) — only
 * they can fetch it through the normal file route. This row records it so the
 * program admin (or staff with delegated approvals) can open it through the
 * `openLicenseFile` action, which fetches it as that volunteer, and only that
 * volunteer's own files. Members read only their own rows. Written only by the
 * add/remove actions; removal is a flag, so the audit trail stays complete.
 */
export const licenseFilesSchema: CollectionSchema = {
  name: 'license_files',
  columns: [
    { name: 'volunteerId', storage: 'text', interpretation: 'plain', required: true, immutable: true },
    { name: 'path', storage: 'text', interpretation: 'plain', required: true, immutable: true },
    { name: 'name', storage: 'text', interpretation: 'plain', required: true },
    { name: 'mime', storage: 'text', interpretation: 'plain', required: true },
    { name: 'size', storage: 'number', interpretation: 'plain', required: true },
    { name: 'removed', storage: 'number', interpretation: { kind: 'boolean' } },
  ],
  ownerField: 'volunteerId',
  permissions: {
    member: { read: 'own', create: false, update: false, delete: false },
    admin: STAFF_READ_ONLY,
  },
}

import type { CollectionSchema } from 'deepspace/schema'
import { STAFF_READ_ONLY, VOLUNTEER_STATUSES, select } from './shared'

/**
 * Vetting outcome and clearance (M2, M3). One row per volunteer; recordId = userId.
 * Records the RESULT of off-app vetting only — no documents, no check results (D4).
 * Written only by server actions (vet / approve / reset), which check the current
 * status before every transition (stale-click protection) and write the audit log.
 * School admins are `member` to DeepSpace, so they see vetted volunteers through a
 * server action, not through this read rule.
 */
export const volunteerStatusSchema: CollectionSchema = {
  name: 'volunteer_status',
  columns: [
    { name: 'userId', storage: 'text', interpretation: 'plain', required: true, immutable: true },
    { name: 'status', storage: 'text', interpretation: select(VOLUNTEER_STATUSES), required: true },
    { name: 'identityConfirmed', storage: 'number', interpretation: { kind: 'boolean' } },
    { name: 'qualificationType', storage: 'text', interpretation: 'plain' },
    { name: 'licenseNumber', storage: 'text', interpretation: 'plain' },
    { name: 'licenseCheckedAt', storage: 'number', interpretation: { kind: 'datetime' } },
    { name: 'clearanceCompletedAt', storage: 'number', interpretation: { kind: 'datetime' } },
    { name: 'clearanceExpiresAt', storage: 'number', interpretation: { kind: 'datetime' } },
    { name: 'decisionReason', storage: 'text', interpretation: 'plain' },
    { name: 'vettedBy', storage: 'text', interpretation: 'plain' },
    { name: 'approvedBy', storage: 'text', interpretation: 'plain' },
  ],
  uniqueOn: ['userId'],
  ownerField: 'userId',
  permissions: {
    member: { read: 'own', create: false, update: false, delete: false },
    admin: STAFF_READ_ONLY,
  },
}

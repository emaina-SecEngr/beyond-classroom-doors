import type { CollectionSchema } from 'deepspace/schema'
import { APP_ROLES, STAFF_READ_ONLY, select } from './shared'

/**
 * App roles (decision R3): teacher and board member (the nonprofit board's volunteer approver).
 * DeepSpace's own roles are a fixed SDK enum (viewer/member/admin), so app roles live
 * here. Staff assign them only through the `assignRole` / `removeRole` server actions
 * (audited). Members can read their own row so the UI knows which dashboard to show —
 * that is a sign, not a lock: every teacher / school-admin server action re-checks this
 * collection on the server.
 */
export const roleAssignmentsSchema: CollectionSchema = {
  name: 'role_assignments',
  columns: [
    { name: 'userId', storage: 'text', interpretation: 'plain', required: true, immutable: true },
    { name: 'role', storage: 'text', interpretation: select(APP_ROLES), required: true },
    { name: 'assignedBy', storage: 'text', interpretation: 'plain', required: true },
  ],
  uniqueOn: ['userId'],
  ownerField: 'userId',
  permissions: {
    member: { read: 'own', create: false, update: false, delete: false },
    admin: STAFF_READ_ONLY,
  },
}

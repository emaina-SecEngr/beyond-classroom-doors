import type { CollectionSchema } from 'deepspace/schema'

/**
 * Append-only audit log (M9, GUARDRAILS §1.10).
 * Every privileged write records who (`actorId` = ctx.userId, or `system:cron`),
 * what, on which target, the state change and the reason.
 * Staff can read. NO role can create, update or delete directly — not even admin.
 * Entries are written only by server actions and cron, which bypass RBAC.
 * guardrail-check.sh fails the build if update/delete is ever granted here.
 */
export const auditLogSchema: CollectionSchema = {
  name: 'audit_log',
  columns: [
    { name: 'actorId', storage: 'text', interpretation: 'plain', required: true, immutable: true },
    { name: 'action', storage: 'text', interpretation: 'plain', required: true, immutable: true },
    { name: 'targetType', storage: 'text', interpretation: 'plain', required: true, immutable: true },
    { name: 'targetId', storage: 'text', interpretation: 'plain', required: true, immutable: true },
    { name: 'fromState', storage: 'text', interpretation: 'plain', immutable: true },
    { name: 'toState', storage: 'text', interpretation: 'plain', immutable: true },
    { name: 'reason', storage: 'text', interpretation: 'plain', immutable: true },
  ],
  permissions: {
    admin: { read: true, create: false, update: false, delete: false },
  },
}

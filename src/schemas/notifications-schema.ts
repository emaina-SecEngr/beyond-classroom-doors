import type { CollectionSchema } from 'deepspace/schema'
import { NOTIFICATION_KINDS, select } from './shared'

/**
 * In-app notifications (M8) — replace email for the build (decision I1).
 * Created only by server actions. Each user reads only their own.
 * The ONE client write allowed: the recipient may set `readAt` on their own
 * notifications (`writableFields`), so marking as read needs no server action and
 * cannot be used to rewrite a message. No emails or tokens in content (standing test 9).
 * Staff have no read rule here on purpose: notifications are private to the recipient.
 */
export const notificationsSchema: CollectionSchema = {
  name: 'notifications',
  columns: [
    { name: 'recipientId', storage: 'text', interpretation: 'plain', required: true, immutable: true },
    { name: 'kind', storage: 'text', interpretation: select(NOTIFICATION_KINDS), required: true, immutable: true },
    { name: 'title', storage: 'text', interpretation: 'plain', required: true, immutable: true },
    { name: 'body', storage: 'text', interpretation: 'plain', immutable: true },
    { name: 'link', storage: 'text', interpretation: 'plain', immutable: true },
    { name: 'readAt', storage: 'number', interpretation: { kind: 'datetime' } },
  ],
  ownerField: 'recipientId',
  permissions: {
    member: { read: 'own', create: false, update: 'own', delete: false, writableFields: ['readAt'] },
    admin: { read: 'own', create: false, update: 'own', delete: false, writableFields: ['readAt'] },
  },
}

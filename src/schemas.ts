import type { CollectionSchema } from 'deepspace/schema'
import { usersSchema } from './schemas/users-schema'
import { settingsSchema } from './schemas/admin-schema'
import { profilesSchema } from './schemas/profiles-schema'
import { volunteerStatusSchema } from './schemas/volunteer-status-schema'
import { roleAssignmentsSchema } from './schemas/role-assignments-schema'
import { sessionRequestsSchema } from './schemas/session-requests-schema'
import { sessionDetailsSchema } from './schemas/session-details-schema'
import { claimsSchema } from './schemas/claims-schema'
import { notificationsSchema } from './schemas/notifications-schema'
import { auditLogSchema } from './schemas/audit-log-schema'
import { changeRequestsSchema } from './schemas/change-requests-schema'
import { vettingHelpSchema } from './schemas/vetting-help-schema'
import { schoolsSchema } from './schemas/schools-schema'
import { teacherInvitesSchema } from './schemas/teacher-invites-schema'

/**
 * Every collection in the app. Baked in at deploy time; after first deploy, changes
 * must be ADDITIVE only (no rename, drop or type change) — GUARDRAILS §2.
 */
export const schemas: CollectionSchema[] = [
  usersSchema,
  settingsSchema,
  profilesSchema,
  volunteerStatusSchema,
  roleAssignmentsSchema,
  sessionRequestsSchema,
  sessionDetailsSchema,
  claimsSchema,
  notificationsSchema,
  auditLogSchema,
  changeRequestsSchema,
  vettingHelpSchema,
  schoolsSchema,
  teacherInvitesSchema,
]

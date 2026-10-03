import type { ColumnInterpretation } from 'deepspace/schema'

/**
 * Shared vocabulary for schemas, server actions and UI.
 * Single source of truth: change a list here, and the schema's select options,
 * the action validation and the UI dropdowns all follow.
 */

export const GRADES = ['9', '10', '11', '12'] as const

export const TOPICS = [
  'healthcare',
  'engineering',
  'skilled-trades',
  'technology',
  'business-finance',
  'public-service',
  'arts-media',
  'science-research',
  'other',
] as const

export const TIME_BANDS = ['morning', 'midday', 'afternoon'] as const

export const VOLUNTEER_STATUSES = [
  'applied',
  'vetted',
  'approved',
  'rejected',
  'declined',
  'renewal_pending',
] as const

export const SESSION_STATUSES = ['open', 'claimed', 'confirmed', 'completed', 'cancelled'] as const

export const CLAIM_STATUSES = ['active', 'withdrawn'] as const

export const APP_ROLES = ['teacher', 'board_member'] as const

export const NOTIFICATION_KINDS = [
  'claim_confirmed',
  'session_claimed',
  'session_confirmed',
  'session_withdrawn',
  'session_cancelled',
  'change_requested',
  'status_changed',
] as const

export const CHANGE_REQUEST_KINDS = ['cancel', 'reschedule'] as const
export const CHANGE_REQUEST_STATUSES = ['open', 'resolved'] as const

/** Self-service withdrawal is allowed only this far ahead of a session (SH6). */
export const SELF_WITHDRAW_MIN_HOURS = 48

/** Vetting help (R7): default and maximum length of a grant, in days. */
export const VETTING_HELP_DEFAULT_DAYS = 14
export const VETTING_HELP_MAX_DAYS = 30

export type Grade = (typeof GRADES)[number]
export type Topic = (typeof TOPICS)[number]
export type TimeBand = (typeof TIME_BANDS)[number]
export type VolunteerStatus = (typeof VOLUNTEER_STATUSES)[number]
export type SessionStatus = (typeof SESSION_STATUSES)[number]
export type ClaimStatus = (typeof CLAIM_STATUSES)[number]
export type AppRole = (typeof APP_ROLES)[number]
export type NotificationKind = (typeof NOTIFICATION_KINDS)[number]

/** Turn a list into a constrained select column (the database rejects other values). */
export const select = (options: readonly string[]): ColumnInterpretation => ({
  kind: 'select',
  options: [...options],
})

/** Read-only for staff; no direct writes for anyone. Every write goes through an audited server action. */
export const STAFF_READ_ONLY = { read: true, create: false, update: false, delete: false } as const

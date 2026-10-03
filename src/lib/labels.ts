/**
 * Display labels and formatting shared by the pages. Pure functions, no data access.
 */
import type { SessionStatus, TimeBand, Topic, VolunteerStatus } from '../schemas/shared'

export const TOPIC_LABELS: Record<Topic, string> = {
  healthcare: 'Healthcare',
  engineering: 'Engineering',
  'skilled-trades': 'Skilled trades',
  technology: 'Technology',
  'business-finance': 'Business & finance',
  'public-service': 'Public service',
  'arts-media': 'Arts & media',
  'science-research': 'Science & research',
  other: 'Other',
}

export const TIME_BAND_LABELS: Record<TimeBand, string> = {
  morning: 'Morning (from 8:00)',
  midday: 'Midday (from 11:00)',
  afternoon: 'Afternoon (from 1:00)',
}

export const TIME_BAND_SHORT: Record<TimeBand, string> = {
  morning: 'Morning',
  midday: 'Midday',
  afternoon: 'Afternoon',
}

export const SESSION_STATUS_LABELS: Record<SessionStatus, string> = {
  open: 'Open',
  claimed: 'Booked',
  confirmed: 'Confirmed',
  completed: 'Completed',
  cancelled: 'Cancelled',
}

export const VOLUNTEER_STATUS_LABELS: Record<VolunteerStatus, string> = {
  applied: 'Waiting for approval',
  vetted: 'Waiting for a decision',
  approved: 'Approved',
  rejected: 'Not approved',
  declined: 'Not approved',
  renewal_pending: 'Clearance renewal pending',
}

export type BadgeVariant = 'default' | 'secondary' | 'destructive' | 'outline' | 'success' | 'warning' | 'info'

export const SESSION_STATUS_BADGE: Record<SessionStatus, BadgeVariant> = {
  open: 'info',
  claimed: 'warning',
  confirmed: 'success',
  completed: 'secondary',
  cancelled: 'outline',
}

export const VOLUNTEER_STATUS_BADGE: Record<VolunteerStatus, BadgeVariant> = {
  applied: 'warning',
  vetted: 'info',
  approved: 'success',
  rejected: 'destructive',
  declined: 'destructive',
  renewal_pending: 'warning',
}

export function topicText(topic: string, topicOther?: string | null): string {
  if (topic === 'other' && topicOther) return topicOther
  return TOPIC_LABELS[topic as Topic] ?? topic
}

/** Session dates are stored as UTC midnight (a calendar date), so format them in UTC. */
export function formatSessionDate(seconds: number): string {
  return new Date(seconds * 1000).toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  })
}

/** Instants (claimedAt, clearance expiry, audit times) are shown in San Diego time. */
export function formatInstant(value: number | string | null | undefined): string {
  if (value === null || value === undefined || value === '') return '—'
  const d = typeof value === 'number' ? new Date(value * 1000) : new Date(value)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZone: 'America/Los_Angeles',
  })
}

export function formatDay(value: number | null | undefined): string {
  if (!value) return '—'
  return new Date(value * 1000).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' })
}

/** "10:15" → "10:15 AM"; empty → the band. */
export function sessionTimeText(timeBand: string, startTime?: string | null): string {
  if (startTime && /^\d{2}:\d{2}$/.test(startTime)) {
    const [h, m] = startTime.split(':').map(Number)
    const suffix = h >= 12 ? 'PM' : 'AM'
    return `${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')} ${suffix}`
  }
  return TIME_BAND_SHORT[timeBand as TimeBand] ?? timeBand
}

/** Today's date in San Diego as YYYY-MM-DD (for date inputs' min). */
export function todayInSanDiego(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles' }).format(new Date())
}

/** UTC-midnight seconds for today in San Diego — sessions on or after this are "upcoming". */
export function todaySeconds(): number {
  const [y, m, d] = todayInSanDiego().split('-').map(Number)
  return Date.UTC(y, m - 1, d) / 1000
}

export const PROGRAM_EMAIL = 'mainin2003@yahoo.com'

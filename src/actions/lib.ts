/**
 * Shared helpers for server actions.
 *
 * Trust model (GUARDRAILS §1, scaffold action-routes.ts): actions run with RBAC
 * OFF. Identity comes ONLY from ctx.userId (the verified JWT). Every action checks
 * WHO (role / status) and WHETHER (current record state) before writing, and
 * records every privileged write in the audit log.
 */
import type { ActionResult, ActionTools } from 'deepspace/worker'
import {
  APP_ROLES,
  type AppRole,
  type NotificationKind,
  type VolunteerStatus,
} from '../schemas/shared'

// ── Results ────────────────────────────────────────────────────────────────

export const ok = <T>(data: T): ActionResult<T> => ({ success: true, data })

/** A refusal the UI can render directly; `code` is a stable slug to branch on. */
export const fail = (error: string, code: string): ActionResult<never> => ({ success: false, error, code })

/** Thrown inside an action to stop with a clean refusal (see `run`). */
export class Refusal extends Error {
  constructor(
    message: string,
    public code: string,
  ) {
    super(message)
  }
}

export const refuse = (message: string, code: string): never => {
  throw new Refusal(message, code)
}

/** Wrap an action body: Refusals become clean results; anything else is logged without personal data. */
export async function run<T>(name: string, body: () => Promise<ActionResult<T>>): Promise<ActionResult<T>> {
  try {
    return await body()
  } catch (e) {
    if (e instanceof Refusal) return fail(e.message, e.code)
    const message = e instanceof Error ? e.message : String(e)
    console.error(`[action:${name}] failed: ${message}`)
    return fail('Something went wrong. Please try again.', 'internal_error')
  }
}

// ── Input validation (params are untrusted client input) ──────────────────

export function str(params: Record<string, unknown>, key: string, opts: { required?: boolean; max?: number } = {}): string {
  const raw = params[key]
  if (raw === undefined || raw === null || raw === '') {
    if (opts.required) refuse(`Missing ${key}.`, 'invalid_input')
    return ''
  }
  if (typeof raw !== 'string') refuse(`${key} must be text.`, 'invalid_input')
  const value = (raw as string).trim()
  if (opts.required && !value) refuse(`Missing ${key}.`, 'invalid_input')
  if (value.length > (opts.max ?? 200)) refuse(`${key} is too long (max ${opts.max ?? 200} characters).`, 'invalid_input')
  return value
}

export function oneOf<T extends string>(params: Record<string, unknown>, key: string, options: readonly T[]): T {
  const value = params[key]
  if (typeof value !== 'string' || !(options as readonly string[]).includes(value)) {
    refuse(`${key} must be one of: ${options.join(', ')}.`, 'invalid_input')
  }
  return value as T
}

export function int(params: Record<string, unknown>, key: string, opts: { min?: number; max?: number; required?: boolean } = {}): number | null {
  const raw = params[key]
  if (raw === undefined || raw === null || raw === '') {
    if (opts.required) refuse(`Missing ${key}.`, 'invalid_input')
    return null
  }
  const n = typeof raw === 'number' ? raw : Number(raw)
  if (!Number.isInteger(n)) refuse(`${key} must be a whole number.`, 'invalid_input')
  if (opts.min !== undefined && n < opts.min) refuse(`${key} must be at least ${opts.min}.`, 'invalid_input')
  if (opts.max !== undefined && n > opts.max) refuse(`${key} must be at most ${opts.max}.`, 'invalid_input')
  return n
}

export const bool = (params: Record<string, unknown>, key: string): boolean => params[key] === true

/** A calendar date "YYYY-MM-DD" → Unix seconds at UTC midnight (stored as the session's date). */
export function dateParam(params: Record<string, unknown>, key: string, opts: { required?: boolean } = {}): number | null {
  const raw = params[key]
  if (raw === undefined || raw === null || raw === '') {
    if (opts.required) refuse(`Missing ${key}.`, 'invalid_input')
    return null
  }
  if (typeof raw !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(raw)) refuse(`${key} must be a date (YYYY-MM-DD).`, 'invalid_input')
  const [y, m, d] = (raw as string).split('-').map(Number)
  const ms = Date.UTC(y, m - 1, d)
  const check = new Date(ms)
  if (check.getUTCFullYear() !== y || check.getUTCMonth() !== m - 1 || check.getUTCDate() !== d) {
    refuse(`${key} is not a real date.`, 'invalid_input')
  }
  return Math.floor(ms / 1000)
}

export const nowSeconds = (): number => Math.floor(Date.now() / 1000)

// ── Records ────────────────────────────────────────────────────────────────

type Row = Record<string, unknown>

/** Get a record's data, or null when it doesn't exist. */
export async function getData<T extends Row>(tools: ActionTools, collection: string, id: string): Promise<T | null> {
  if (!id) return null
  const r = await tools.get<T>(collection, id)
  return r.success ? r.data.record.data : null
}

/** Unwrap a write; a failed write stops the action. */
export async function must<T>(result: Promise<ActionResult<T>>, what: string): Promise<T> {
  const r = await result
  if (!r.success) throw new Error(`${what}: ${r.error}`)
  return r.data
}

// ── Who is calling ─────────────────────────────────────────────────────────

/** Staff = DeepSpace admin. Read from the users row, whose `role` column is system-managed. */
export async function isStaff(tools: ActionTools, userId: string, ownerUserId?: string): Promise<boolean> {
  if (ownerUserId && userId === ownerUserId) return true
  const user = await getData<{ role?: string }>(tools, 'users', userId)
  return user?.role === 'admin'
}

/** The nonprofit admin = the account that owns the app on DeepSpace (platform-proven). */
export const isNonprofitAdmin = (userId: string, ownerUserId?: string): boolean => !!ownerUserId && userId === ownerUserId

export function requireNonprofitAdmin(userId: string, ownerUserId?: string): void {
  if (!isNonprofitAdmin(userId, ownerUserId)) refuse('Only the nonprofit admin can do this.', 'forbidden')
}

/** Active vetting help for this user (R7), or null. Must still be staff to use it. */
export async function activeVettingHelp(tools: ActionTools, userId: string): Promise<{ endsAt: number } | null> {
  const row = await getData<{ startsAt?: number; endsAt?: number }>(tools, 'vetting_help', userId)
  const now = nowSeconds()
  return row && (row.startsAt ?? 0) <= now && (row.endsAt ?? 0) > now ? { endsAt: row.endsAt! } : null
}

/**
 * Who may vet (first key, R7): the nonprofit admin; or a staff member the admin has
 * asked for help, while that help is active.
 */
export async function requireCanVet(tools: ActionTools, userId: string, ownerUserId?: string): Promise<void> {
  if (isNonprofitAdmin(userId, ownerUserId)) return
  if ((await isStaff(tools, userId, ownerUserId)) && (await activeVettingHelp(tools, userId))) return
  refuse('Vetting is done by the nonprofit admin, or by staff the admin has asked for help.', 'forbidden')
}

export async function appRoleOf(tools: ActionTools, userId: string): Promise<AppRole | null> {
  const row = await getData<{ role?: string }>(tools, 'role_assignments', userId)
  return row && (APP_ROLES as readonly string[]).includes(row.role ?? '') ? (row.role as AppRole) : null
}

export async function requireStaff(tools: ActionTools, userId: string, ownerUserId?: string): Promise<void> {
  if (!(await isStaff(tools, userId, ownerUserId))) refuse('Only program staff can do this.', 'forbidden')
}

export async function requireAppRole(tools: ActionTools, userId: string, role: AppRole): Promise<void> {
  if ((await appRoleOf(tools, userId)) !== role) {
    refuse(role === 'teacher' ? 'Only teachers can do this.' : 'Only a member of the nonprofit’s board can do this.', 'forbidden')
  }
}

export interface VolunteerStatusRow extends Row {
  userId: string
  status: VolunteerStatus
  clearanceExpiresAt?: number | null
}

export async function statusOf(tools: ActionTools, userId: string): Promise<VolunteerStatusRow | null> {
  return getData<VolunteerStatusRow>(tools, 'volunteer_status', userId)
}

// ── Audit and notifications ────────────────────────────────────────────────

export async function audit(
  tools: ActionTools,
  entry: { actorId: string; action: string; targetType: string; targetId: string; fromState?: string; toState?: string; reason?: string },
): Promise<void> {
  await must(
    tools.create('audit_log', {
      actorId: entry.actorId,
      action: entry.action,
      targetType: entry.targetType,
      targetId: entry.targetId,
      fromState: entry.fromState ?? '',
      toState: entry.toState ?? '',
      reason: entry.reason ?? '',
    }),
    'audit',
  )
}

/** In-app notification. Never put emails, tokens or student details in content (standing test 9). */
export async function notify(
  tools: ActionTools,
  n: { recipientId: string; kind: NotificationKind; title: string; body?: string; link?: string },
): Promise<void> {
  await must(
    tools.create('notifications', {
      recipientId: n.recipientId,
      kind: n.kind,
      title: n.title,
      body: n.body ?? '',
      link: n.link ?? '',
      readAt: null,
    }),
    'notify',
  )
}

// ── Session time (San Diego) ───────────────────────────────────────────────
// Shared with the pages so both sides agree on start times (src/lib/time.ts).
export { sessionStartSeconds } from '../lib/time'

/** "Add to Google Calendar" link — a plain URL; no OAuth, no access to anyone's calendar (decision I3). */
export function calendarLink(opts: { title: string; startSeconds: number; durationMinutes?: number; location?: string; details?: string }): string {
  const fmt = (s: number) => new Date(s * 1000).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')
  const end = opts.startSeconds + (opts.durationMinutes ?? 60) * 60
  const q = new URLSearchParams({
    action: 'TEMPLATE',
    text: opts.title,
    dates: `${fmt(opts.startSeconds)}/${fmt(end)}`,
    ctz: 'America/Los_Angeles',
  })
  if (opts.location) q.set('location', opts.location)
  if (opts.details) q.set('details', opts.details)
  return `https://calendar.google.com/calendar/render?${q.toString()}`
}

export const formatDate = (sessionDate: number): string =>
  new Date(sessionDate * 1000).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' })

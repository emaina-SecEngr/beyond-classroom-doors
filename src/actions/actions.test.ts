/**
 * Server-action security tests (GUARDRAILS §5 standing tests, requirements §11).
 *
 * Runs the real actions against an in-memory stand-in for the platform's ActionTools.
 * The fake enforces each schema's `uniqueOn` exactly like the SDK's putRecord
 * (a duplicate returns `{ success: false, error: 'Duplicate: ...' }`), so the race and
 * re-claim tests exercise the real constraint logic. Permissions are NOT enforced by
 * the fake — actions run RBAC-off in production too — so every refusal here comes
 * from the action's own WHO / WHETHER checks.
 */
import { beforeEach, describe, expect, it } from 'vitest'
import type { ActionResult, ActionTools } from 'deepspace/worker'
import { actions } from './index'
import { schemas } from '../schemas'

type Row = Record<string, unknown>
const DAY = 86400

function makeTools(db: Map<string, Map<string, Row>>, callerId: string): ActionTools {
  let seq = 0
  const table = (c: string) => {
    if (!db.has(c)) db.set(c, new Map())
    return db.get(c)!
  }
  const uniqueOn = (c: string) => schemas.find((s) => s.name === c)?.uniqueOn ?? []
  const conflict = (c: string, data: Row, selfId?: string) => {
    const keys = uniqueOn(c)
    if (!keys.length) return null
    for (const [id, row] of table(c)) {
      if (id !== selfId && keys.every((k) => row[k] === data[k])) return `Duplicate: ${keys.map((k) => `${k}=${data[k]}`).join(', ')}`
    }
    return null
  }
  const okR = <T>(data: T): ActionResult<T> => ({ success: true, data })
  const bad = (error: string): ActionResult<never> => ({ success: false, error })
  return {
    async create(c, data, recordId) {
      const id = recordId ?? `${c}_${++seq}_${Math.random().toString(36).slice(2, 7)}`
      const existing = table(c).get(id)
      const merged = { ...(existing ?? {}), ...data }
      const dup = conflict(c, merged, id)
      if (dup) return bad(dup)
      table(c).set(id, merged)
      return okR({ recordId: id })
    },
    async update(c, id, data) {
      const existing = table(c).get(id)
      if (!existing) return bad(`records.update: no record "${id}" in ${c}`)
      const merged = { ...existing, ...data }
      const dup = conflict(c, merged, id)
      if (dup) return bad(dup)
      table(c).set(id, merged)
      return okR({ recordId: id })
    },
    async remove(c, id) {
      table(c).delete(id)
      return okR({ recordId: id })
    },
    async deleteWhere() {
      return okR({ deleted: 0 })
    },
    async get(c, id) {
      const row = table(c).get(id)
      return row ? okR({ record: { recordId: id, data: row, createdBy: callerId } as never }) : bad('not found')
    },
    async query(c, opts) {
      const where = opts?.where ?? {}
      const records = [...table(c)]
        .filter(([, r]) => Object.entries(where).every(([k, v]) => r[k] === v))
        .slice(0, opts?.limit ?? 100)
        .map(([recordId, data]) => ({ recordId, data, createdBy: callerId }) as never)
      return okR({ records, count: records.length })
    },
    async integration() {
      return bad('integrations disabled in tests')
    },
    async registerUser() {
      return bad('not used')
    },
  } as ActionTools
}

let db: Map<string, Map<string, Row>>
const OWNER = 'u_owner'
const call = (name: string, userId: string, params: Row = {}) =>
  actions[name]({ userId, params, tools: makeTools(db, userId), env: { OWNER_USER_ID: OWNER } as never, callerJwt: 'jwt' })
const row = (c: string, id: string) => db.get(c)?.get(id)
const rows = (c: string) => [...(db.get(c)?.values() ?? [])]
const futureDate = (days: number) => new Date(Date.now() + days * DAY * 1000).toISOString().slice(0, 10)

/** Seed: staff, board member, teacher, two approved volunteers, one applicant, one open session. */
async function seed() {
  db = new Map()
  const users = db.set('users', new Map()).get('users')!
  for (const [id, role] of [
    ['u_staff', 'admin'],
    ['u_sa', 'member'],
    ['u_teacher', 'member'],
    ['u_teacher2', 'member'],
    ['u_vol', 'member'],
    ['u_vol2', 'member'],
    ['u_applicant', 'member'],
    ['u_expired', 'member'],
  ] as const) {
    users.set(id, { email: `${id}@example.org`, name: id, role })
  }
  expect((await call('assignRole', 'u_staff', { userId: 'u_sa', role: 'board_member' })).success).toBe(true)
  expect((await call('assignRole', 'u_staff', { userId: 'u_teacher', role: 'teacher' })).success).toBe(true)
  expect((await call('assignRole', 'u_staff', { userId: 'u_teacher2', role: 'teacher' })).success).toBe(true)
  for (const v of ['u_vol', 'u_vol2', 'u_applicant', 'u_expired']) {
    expect((await call('saveProfile', v, { displayName: v, profession: 'Nurse', employer: 'Hospital' })).success).toBe(true)
  }
  for (const v of ['u_vol', 'u_vol2', 'u_expired']) {
    expect((await call('vetVolunteer', 'u_staff', { userId: v, outcome: 'vetted', identityConfirmed: true, clearanceExpiresAt: futureDate(365) })).success).toBe(true)
    expect((await call('approveVolunteer', 'u_sa', { userId: v, outcome: 'approved' })).success).toBe(true)
  }
  // Simulate a clearance that lapsed after approval (cron never ran).
  db.get('volunteer_status')!.get('u_expired')!.clearanceExpiresAt = Math.floor(Date.now() / 1000) - DAY
  const created = await call('createSessionRequest', 'u_teacher', {
    grade: '11', topic: 'healthcare', sessionDate: futureDate(10), timeBand: 'morning', startTime: '09:30', room: '214', arrivalNote: 'Sign in at the front office',
  })
  expect(created.success).toBe(true)
  return (created as { data: { sessionId: string } }).data.sessionId
}

let S: string
beforeEach(async () => {
  S = await seed()
})

describe('identity and roles', () => {
  it('a member cannot assign roles (only staff)', async () => {
    const r = await call('assignRole', 'u_vol', { userId: 'u_vol', role: 'board_member' })
    expect(r).toMatchObject({ success: false, code: 'forbidden' })
    expect(row('role_assignments', 'u_vol')).toBeUndefined()
  })
  it('the app owner counts as staff even without an admin users row', async () => {
    db.get('users')!.set(OWNER, { role: 'member' })
    expect((await call('assignRole', OWNER, { userId: 'u_vol2', role: 'teacher' })).success).toBe(true)
  })
  it('a role must be one of the app roles', async () => {
    expect(await call('assignRole', 'u_staff', { userId: 'u_vol', role: 'admin' })).toMatchObject({ success: false, code: 'invalid_input' })
  })
})

describe('two-key vetting (standing tests 7, 12)', () => {
  it('a non-staff user cannot vet', async () => {
    await call('saveProfile', 'u_new', { displayName: 'New', profession: 'Engineer' })
    const r = await call('vetVolunteer', 'u_sa', { userId: 'u_new', outcome: 'vetted', identityConfirmed: true, clearanceExpiresAt: futureDate(30) })
    expect(r).toMatchObject({ success: false, code: 'forbidden' })
  })
  it('staff cannot give the board approval', async () => {
    db.get('users')!.set('u_new', { role: 'member' })
    await call('saveProfile', 'u_new', { displayName: 'New', profession: 'Engineer' })
    await call('vetVolunteer', 'u_staff', { userId: 'u_new', outcome: 'vetted', identityConfirmed: true, clearanceExpiresAt: futureDate(30) })
    expect(await call('approveVolunteer', 'u_staff', { userId: 'u_new', outcome: 'approved' })).toMatchObject({ success: false, code: 'forbidden' })
  })
  it('staff who are also given the board role still cannot approve', async () => {
    await call('assignRole', 'u_staff', { userId: 'u_staff', role: 'board_member' })
    await call('saveProfile', 'u_new', { displayName: 'New', profession: 'Engineer' })
    await call('vetVolunteer', 'u_staff', { userId: 'u_new', outcome: 'vetted', identityConfirmed: true, clearanceExpiresAt: futureDate(30) })
    expect(await call('approveVolunteer', 'u_staff', { userId: 'u_new', outcome: 'approved' })).toMatchObject({ success: false, code: 'forbidden' })
  })
  it('a board member cannot approve someone who was never vetted (no skipping)', async () => {
    expect(await call('approveVolunteer', 'u_sa', { userId: 'u_applicant', outcome: 'approved' })).toMatchObject({ success: false, code: 'stale_state' })
  })
  it('a stale "vet" click after a rejection is refused', async () => {
    await call('vetVolunteer', 'u_staff', { userId: 'u_applicant', outcome: 'rejected', reason: 'Could not verify' })
    const r = await call('vetVolunteer', 'u_staff', { userId: 'u_applicant', outcome: 'vetted', identityConfirmed: true, clearanceExpiresAt: futureDate(30) })
    expect(r).toMatchObject({ success: false, code: 'stale_state' })
    expect(row('volunteer_status', 'u_applicant')?.status).toBe('rejected')
  })
  it('rejecting requires a reason', async () => {
    expect(await call('vetVolunteer', 'u_staff', { userId: 'u_applicant', outcome: 'rejected' })).toMatchObject({ success: false, code: 'invalid_input' })
  })
  it('changing profession after approval sends the volunteer back to review', async () => {
    const r = await call('saveProfile', 'u_vol', { displayName: 'u_vol', profession: 'Electrician', employer: 'Hospital' })
    expect(r).toMatchObject({ success: true, data: { status: 'applied', reset: true } })
    expect(row('volunteer_status', 'u_vol')?.status).toBe('applied')
  })
  it('every decision is audited with the actor', async () => {
    const vet = rows('audit_log').filter((a) => a.action === 'vet')
    expect(vet.length).toBeGreaterThan(0)
    expect(vet.every((a) => a.actorId === 'u_staff')).toBe(true)
    expect(rows('audit_log').filter((a) => a.action === 'approve').every((a) => a.actorId === 'u_sa')).toBe(true)
  })
})

describe('session requests (standing test 6)', () => {
  it('only teachers can post requests', async () => {
    const r = await call('createSessionRequest', 'u_vol', { grade: '9', topic: 'technology', sessionDate: futureDate(5), timeBand: 'midday' })
    expect(r).toMatchObject({ success: false, code: 'forbidden' })
  })
  it('a session in the past is refused', async () => {
    const r = await call('createSessionRequest', 'u_teacher', { grade: '9', topic: 'technology', sessionDate: futureDate(-2), timeBand: 'midday' })
    expect(r).toMatchObject({ success: false, code: 'invalid_input' })
  })
  it('teacher B cannot cancel teacher A’s session', async () => {
    expect(await call('cancelSession', 'u_teacher2', { sessionId: S })).toMatchObject({ success: false, code: 'forbidden' })
    expect(row('session_requests', S)?.status).toBe('open')
  })
  it('private details are stored apart from the public board record', async () => {
    expect(row('session_requests', S)).not.toHaveProperty('room')
    expect(row('session_details', S)?.room).toBe('214')
  })
})

describe('claiming (standing tests 2, 3, 4, 9, 11)', () => {
  it('an unvetted applicant cannot claim, even calling the action directly', async () => {
    expect(await call('claimSession', 'u_applicant', { sessionId: S })).toMatchObject({ success: false, code: 'not_approved' })
  })
  it('an expired clearance cannot claim even though the cron job never ran', async () => {
    expect(await call('claimSession', 'u_expired', { sessionId: S })).toMatchObject({ success: false, code: 'clearance_expired' })
  })
  it('two simultaneous claims produce exactly one winner', async () => {
    const [a, b] = await Promise.all([call('claimSession', 'u_vol', { sessionId: S }), call('claimSession', 'u_vol2', { sessionId: S })])
    expect([a.success, b.success].filter(Boolean)).toHaveLength(1)
    const loser = a.success ? b : a
    expect(loser).toMatchObject({ code: 'already_claimed' })
    expect(rows('claims').filter((c) => c.status === 'active')).toHaveLength(1)
  })
  it('a forged volunteerId in params is ignored; the claim records the real caller', async () => {
    await call('claimSession', 'u_vol', { sessionId: S, volunteerId: 'u_vol2', userId: 'u_vol2' })
    expect(rows('claims')[0].volunteerId).toBe('u_vol')
  })
  it('a successful claim shares the private details with the claimant only', async () => {
    await call('claimSession', 'u_vol', { sessionId: S })
    expect(row('session_details', S)?.collaborators).toEqual(['u_vol'])
    expect(row('session_requests', S)?.status).toBe('claimed')
  })
  it('notifications go to both sides and contain no email addresses or tokens', async () => {
    await call('claimSession', 'u_vol', { sessionId: S })
    const notes = rows('notifications').filter((n) => n.kind === 'claim_confirmed' || n.kind === 'session_claimed')
    expect(notes.map((n) => n.recipientId).sort()).toEqual(['u_teacher', 'u_vol'])
    const text = JSON.stringify(notes)
    expect(text).not.toMatch(/@example\.org|jwt|token/i)
    expect(notes.find((n) => n.recipientId === 'u_vol')?.link).toMatch(/^https:\/\/calendar\.google\.com\//)
  })
  it('action responses contain no emails or tokens', async () => {
    const r = await call('claimSession', 'u_vol', { sessionId: S })
    expect(JSON.stringify(r)).not.toMatch(/@|jwt|token/i)
    const list = await call('listVettedVolunteers', 'u_sa')
    expect(JSON.stringify(list)).not.toMatch(/@/)
  })
})

describe('confirm and withdraw (standing tests 15, 16)', () => {
  it('only the claimant can confirm', async () => {
    await call('claimSession', 'u_vol', { sessionId: S })
    expect(await call('confirmClaim', 'u_vol2', { sessionId: S })).toMatchObject({ success: false, code: 'forbidden' })
    expect((await call('confirmClaim', 'u_vol', { sessionId: S })).success).toBe(true)
    expect(row('session_requests', S)?.status).toBe('confirmed')
  })
  it('a withdrawn session can be claimed again — by exactly one new volunteer', async () => {
    await call('claimSession', 'u_vol', { sessionId: S })
    expect((await call('withdrawClaim', 'u_vol', { sessionId: S })).success).toBe(true)
    expect(row('session_requests', S)?.status).toBe('open')
    expect(row('session_details', S)?.collaborators).toEqual([])
    const [a, b] = await Promise.all([call('claimSession', 'u_vol2', { sessionId: S }), call('claimSession', 'u_vol', { sessionId: S })])
    expect([a.success, b.success].filter(Boolean)).toHaveLength(1)
    expect(rows('claims')).toHaveLength(2) // history kept: one withdrawn, one active
  })
  it('another volunteer cannot withdraw someone else’s claim', async () => {
    await call('claimSession', 'u_vol', { sessionId: S })
    expect(await call('withdrawClaim', 'u_vol2', { sessionId: S })).toMatchObject({ success: false, code: 'forbidden' })
  })
  it('self-withdrawal inside 48 hours is refused', async () => {
    const soon = await call('createSessionRequest', 'u_teacher', { grade: '10', topic: 'engineering', sessionDate: futureDate(1), timeBand: 'afternoon', startTime: '23:00' })
    const id = (soon as { data: { sessionId: string } }).data.sessionId
    await call('claimSession', 'u_vol', { sessionId: id })
    expect(await call('withdrawClaim', 'u_vol', { sessionId: id })).toMatchObject({ success: false, code: 'too_late' })
    expect((await call('requestChange', 'u_vol', { sessionId: id, kind: 'cancel', note: 'Sick' })).success).toBe(true)
  })
  it('cancelling a claimed session releases the claim and notifies the volunteer', async () => {
    await call('claimSession', 'u_vol', { sessionId: S })
    expect((await call('cancelSession', 'u_teacher', { sessionId: S, reason: 'Assembly' })).success).toBe(true)
    expect(rows('claims').every((c) => c.status === 'withdrawn')).toBe(true)
    expect(rows('notifications').some((n) => n.recipientId === 'u_vol' && n.kind === 'session_cancelled')).toBe(true)
  })
})

describe('input handling', () => {
  it('rejects non-text and oversized input', async () => {
    expect(await call('saveProfile', 'u_x', { displayName: { $ne: 1 }, profession: 'x' })).toMatchObject({ code: 'invalid_input' })
    expect(await call('saveProfile', 'u_x', { displayName: 'a'.repeat(81), profession: 'x' })).toMatchObject({ code: 'invalid_input' })
  })
  it('an unknown session id is a clean refusal, not a crash', async () => {
    expect(await call('claimSession', 'u_vol', { sessionId: 'nope' })).toMatchObject({ success: false, code: 'not_found' })
  })
})

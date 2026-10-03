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
import { beforeEach, describe, expect, it, vi } from 'vitest'

// The platform file fetch is faked: it records whose private file space was read.
const fetched: { ownerId: string; path: string }[] = []
vi.mock('../server/user-files', async (orig) => {
  const real = await orig<typeof import('../server/user-files')>()
  return {
    ...real,
    fetchUserFile: async (_env: unknown, ownerId: string, path: string) => {
      fetched.push({ ownerId, path })
      return real.isFilePath(path) ? { bytes: new Uint8Array([37, 80, 68, 70]), mime: 'application/pdf' } : null
    },
  }
})
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
let SCHOOL: string
const OWNER = 'u_owner'
const call = (name: string, userId: string, params: Row = {}) =>
  actions[name]({ userId, params, tools: makeTools(db, userId), env: { OWNER_USER_ID: OWNER } as never, callerJwt: 'jwt' })
const row = (c: string, id: string) => db.get(c)?.get(id)
const rows = (c: string) => [...(db.get(c)?.values() ?? [])]
const futureDate = (days: number) => new Date(Date.now() + days * DAY * 1000).toISOString().slice(0, 10)

/** Seed: nonprofit admin (owner), staff, a plain member (u_sa), teacher, two approved volunteers, one applicant, one open session. */
async function seed() {
  db = new Map()
  const users = db.set('users', new Map()).get('users')!
  for (const [id, role] of [
    [OWNER, 'admin'],
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
  const school = await call('createSchool', OWNER, { name: 'Lincoln High', district: 'San Diego Unified', city: 'San Diego', address: '4777 Imperial Ave' })
  expect(school.success).toBe(true)
  SCHOOL = (school as { data: { schoolId: string } }).data.schoolId
  expect((await call('assignRole', 'u_staff', { userId: 'u_teacher', role: 'teacher', schoolId: SCHOOL })).success).toBe(true)
  expect((await call('assignRole', 'u_staff', { userId: 'u_teacher2', role: 'teacher', schoolId: SCHOOL })).success).toBe(true)
  for (const v of ['u_vol', 'u_vol2', 'u_applicant', 'u_expired']) {
    expect((await call('saveProfile', v, { displayName: v, profession: 'Nurse', employer: 'Hospital' })).success).toBe(true)
  }
  for (const v of ['u_vol', 'u_vol2', 'u_expired']) {
    expect((await call('vetVolunteer', OWNER, { userId: v, outcome: 'approved', identityConfirmed: true, clearanceExpiresAt: futureDate(365) })).success).toBe(true)
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
    const r = await call('assignRole', 'u_vol', { userId: 'u_vol', role: 'teacher', schoolId: SCHOOL })
    expect(r).toMatchObject({ success: false, code: 'forbidden' })
    expect(row('role_assignments', 'u_vol')).toBeUndefined()
  })
  it('the app owner counts as staff even without an admin users row', async () => {
    db.get('users')!.set(OWNER, { role: 'member' })
    expect((await call('assignRole', OWNER, { userId: 'u_vol2', role: 'teacher', schoolId: SCHOOL })).success).toBe(true)
  })
  it('a role must be one of the app roles (the retired board seat is refused too)', async () => {
    expect(await call('assignRole', 'u_staff', { userId: 'u_vol', role: 'admin' })).toMatchObject({ success: false, code: 'invalid_input' })
    expect(await call('assignRole', OWNER, { userId: 'u_vol', role: 'board_member' })).toMatchObject({ success: false, code: 'invalid_input' })
  })
  it('a retired role left in the data can still be removed', async () => {
    db.get('role_assignments')!.set('u_sa', { userId: 'u_sa', role: 'board_member', assignedBy: OWNER })
    expect((await call('removeRole', 'u_staff', { userId: 'u_sa' })).success).toBe(true)
    expect(row('role_assignments', 'u_sa')).toBeUndefined()
  })
})

describe('one final decision by the nonprofit admin (D3b, standing tests 7, 12)', () => {
  const approve = (who: string, userId: string) =>
    call('vetVolunteer', who, { userId, outcome: 'approved', identityConfirmed: true, clearanceExpiresAt: futureDate(30) })
  it('a non-staff user cannot decide', async () => {
    await call('saveProfile', 'u_new', { displayName: 'New', profession: 'Engineer' })
    expect(await approve('u_sa', 'u_new')).toMatchObject({ success: false, code: 'forbidden' })
  })
  it('the admin’s approval is final: the volunteer can claim at once', async () => {
    db.get('users')!.set('u_new', { role: 'member' })
    await call('saveProfile', 'u_new', { displayName: 'New', profession: 'Engineer' })
    expect(await approve(OWNER, 'u_new')).toMatchObject({ success: true, data: { status: 'approved' } })
    expect((await call('claimSession', 'u_new', { sessionId: S })).success).toBe(true)
  })
  it('nobody can act on an approved volunteer again — not the admin, not staff helping', async () => {
    await call('grantVettingHelp', OWNER, { userId: 'u_staff', days: 7, reason: 'Covering' })
    expect(await call('vetVolunteer', OWNER, { userId: 'u_vol', outcome: 'rejected', reason: 'Changed mind' })).toMatchObject({ success: false, code: 'stale_state' })
    expect(await call('vetVolunteer', 'u_staff', { userId: 'u_vol', outcome: 'rejected', reason: 'x' })).toMatchObject({ success: false, code: 'stale_state' })
    expect(await approve(OWNER, 'u_vol')).toMatchObject({ success: false, code: 'stale_state' })
    expect(row('volunteer_status', 'u_vol')?.status).toBe('approved')
  })
  it('the retired board actions no longer exist', async () => {
    expect(actions.approveVolunteer).toBeUndefined()
    expect(actions.listVettedVolunteers).toBeUndefined()
  })
  it('a volunteer left "vetted" by the old two-key flow can still be decided', async () => {
    db.get('volunteer_status')!.get('u_applicant')!.status = 'vetted'
    expect((await approve(OWNER, 'u_applicant')).success).toBe(true)
  })
  it('a stale "vet" click after a rejection is refused', async () => {
    await call('vetVolunteer', OWNER, { userId: 'u_applicant', outcome: 'rejected', reason: 'Could not verify' })
    const r = await call('vetVolunteer', OWNER, { userId: 'u_applicant', outcome: 'approved', identityConfirmed: true, clearanceExpiresAt: futureDate(30) })
    expect(r).toMatchObject({ success: false, code: 'stale_state' })
    expect(row('volunteer_status', 'u_applicant')?.status).toBe('rejected')
  })
  it('rejecting requires a reason', async () => {
    expect(await call('vetVolunteer', OWNER, { userId: 'u_applicant', outcome: 'rejected' })).toMatchObject({ success: false, code: 'invalid_input' })
  })
  it('changing profession after approval sends the volunteer back to review', async () => {
    const r = await call('saveProfile', 'u_vol', { displayName: 'u_vol', profession: 'Electrician', employer: 'Hospital' })
    expect(r).toMatchObject({ success: true, data: { status: 'applied', reset: true } })
    expect(row('volunteer_status', 'u_vol')?.status).toBe('applied')
  })
  it('every decision is audited with the actor', async () => {
    const decisions = rows('audit_log').filter((a) => a.action === 'approve')
    expect(decisions.length).toBe(3)
    expect(decisions.every((a) => a.actorId === OWNER && a.toState === 'approved')).toBe(true)
    expect(rows('volunteer_status').filter((v) => v.status === 'approved').every((v) => v.approvedBy === OWNER)).toBe(true)
  })
})

describe('who vets, and vetting help (decision R7, standing test 18)', () => {
  const vet = (who: string, userId = 'u_applicant') =>
    call('vetVolunteer', who, { userId, outcome: 'approved', identityConfirmed: true, clearanceExpiresAt: futureDate(200) })

  it('staff cannot vet unless the nonprofit admin asked them to help', async () => {
    expect(await vet('u_staff')).toMatchObject({ success: false, code: 'forbidden' })
    expect(row('volunteer_status', 'u_applicant')?.status).toBe('applied')
  })
  it('the nonprofit admin can vet', async () => {
    expect((await vet(OWNER)).success).toBe(true)
  })
  it('staff can vet while the admin’s help request is active', async () => {
    expect((await call('grantVettingHelp', OWNER, { userId: 'u_staff', days: 7, reason: 'Admin travelling' })).success).toBe(true)
    expect((await vet('u_staff')).success).toBe(true)
    const entry = rows('audit_log').find((a) => a.action === 'grant_vetting_help')
    expect(entry).toMatchObject({ actorId: OWNER, targetId: 'u_staff', reason: 'Admin travelling' })
  })
  it('help that has ended (or expired) no longer lets staff vet', async () => {
    await call('grantVettingHelp', OWNER, { userId: 'u_staff', days: 7, reason: 'Admin travelling' })
    expect((await call('endVettingHelp', OWNER, { userId: 'u_staff' })).success).toBe(true)
    expect(await vet('u_staff')).toMatchObject({ success: false, code: 'forbidden' })
    await call('grantVettingHelp', OWNER, { userId: 'u_staff', days: 1, reason: 'One day' })
    db.get('vetting_help')!.get('u_staff')!.endsAt = Math.floor(Date.now() / 1000) - 1
    expect(await vet('u_staff')).toMatchObject({ success: false, code: 'forbidden' })
  })
  it('help stops working if the person is no longer staff', async () => {
    await call('grantVettingHelp', OWNER, { userId: 'u_staff', days: 7, reason: 'Admin travelling' })
    db.get('users')!.get('u_staff')!.role = 'member'
    expect(await vet('u_staff')).toMatchObject({ success: false, code: 'forbidden' })
  })
  it('only the nonprofit admin can ask for help — staff cannot grant it to themselves or others', async () => {
    db.get('users')!.set('u_staff2', { role: 'admin' })
    expect(await call('grantVettingHelp', 'u_staff', { userId: 'u_staff', days: 7, reason: 'x' })).toMatchObject({ success: false, code: 'forbidden' })
    expect(await call('grantVettingHelp', 'u_staff', { userId: 'u_staff2', days: 7, reason: 'x' })).toMatchObject({ success: false, code: 'forbidden' })
    expect(row('vetting_help', 'u_staff')).toBeUndefined()
  })
  it('help goes only to staff, needs a reason, and is capped at 30 days', async () => {
    expect(await call('grantVettingHelp', OWNER, { userId: 'u_vol', days: 7, reason: 'x' })).toMatchObject({ success: false, code: 'invalid_input' })
    expect(await call('grantVettingHelp', OWNER, { userId: 'u_staff', days: 7 })).toMatchObject({ success: false, code: 'invalid_input' })
    expect(await call('grantVettingHelp', OWNER, { userId: 'u_staff', days: 31, reason: 'x' })).toMatchObject({ success: false, code: 'invalid_input' })
  })
  it('staff can assign teachers', async () => {
    expect((await call('assignRole', 'u_staff', { userId: 'u_vol2', role: 'teacher', schoolId: SCHOOL })).success).toBe(true)
  })
})

describe('session readiness — editing room / time / arrival notes', () => {
  const edit = (who: string, extra: Row = {}) => call('updateSessionDetails', who, { sessionId: S, room: '118', startTime: '10:00', arrivalNote: 'Front office', ...extra })
  it('the owning teacher and staff at that school can edit; another teacher and volunteers cannot', async () => {
    expect((await edit('u_teacher')).success).toBe(true)
    expect(row('session_details', S)?.room).toBe('118')
    expect(await edit('u_staff', { room: '120' })).toMatchObject({ success: false, code: 'forbidden' }) // no school yet
    await call('assignStaffSchool', OWNER, { userId: 'u_staff', schoolId: SCHOOL })
    expect((await edit('u_staff', { room: '120' })).success).toBe(true)
    expect(await edit('u_teacher2')).toMatchObject({ success: false, code: 'forbidden' })
    expect(await edit('u_vol')).toMatchObject({ success: false, code: 'forbidden' })
    expect(row('session_details', S)?.room).toBe('120')
  })
  it('the booked volunteer is told about changes; nothing is sent when nothing changed', async () => {
    await call('claimSession', 'u_vol', { sessionId: S })
    const before = rows('notifications').filter((n) => n.recipientId === 'u_vol').length
    await edit('u_teacher')
    const after = rows('notifications').filter((n) => n.recipientId === 'u_vol')
    expect(after.length).toBe(before + 1)
    expect(after.at(-1)?.body).toContain('Room 118')
    await edit('u_teacher')
    expect(rows('notifications').filter((n) => n.recipientId === 'u_vol').length).toBe(before + 1)
  })
  it('cancelled sessions cannot be edited, and bad times are refused', async () => {
    expect(await edit('u_teacher', { startTime: '9am' })).toMatchObject({ success: false, code: 'invalid_input' })
    await call('cancelSession', 'u_teacher', { sessionId: S })
    expect(await edit('u_teacher')).toMatchObject({ success: false, code: 'stale_state' })
  })
})

describe('schools in the district (D9, standing test 19)', () => {
  it('only the program admin can add or edit schools', async () => {
    expect(await call('createSchool', 'u_staff', { name: 'Hoover High' })).toMatchObject({ success: false, code: 'forbidden' })
    expect(await call('createSchool', 'u_teacher', { name: 'Hoover High' })).toMatchObject({ success: false, code: 'forbidden' })
    expect(await call('updateSchool', 'u_staff', { schoolId: SCHOOL, name: 'Renamed' })).toMatchObject({ success: false, code: 'forbidden' })
    expect(row('schools', SCHOOL)?.name).toBe('Lincoln High')
    expect((await call('createSchool', OWNER, { name: 'Hoover High', city: 'San Diego' })).success).toBe(true)
  })
  it('school names are unique', async () => {
    expect(await call('createSchool', OWNER, { name: 'Lincoln High' })).toMatchObject({ success: false, code: 'duplicate' })
  })
  it('a teacher must be assigned to an existing, active school', async () => {
    expect(await call('assignRole', 'u_staff', { userId: 'u_vol2', role: 'teacher' })).toMatchObject({ success: false, code: 'invalid_input' })
    expect(await call('assignRole', 'u_staff', { userId: 'u_vol2', role: 'teacher', schoolId: 'nope' })).toMatchObject({ success: false, code: 'invalid_input' })
    await call('updateSchool', OWNER, { schoolId: SCHOOL, name: 'Lincoln High', active: false })
    expect(await call('assignRole', 'u_staff', { userId: 'u_vol2', role: 'teacher', schoolId: SCHOOL })).toMatchObject({ success: false, code: 'invalid_input' })
  })
  it('a session takes the teacher’s school from the server, never from the request', async () => {
    const other = await call('createSchool', OWNER, { name: 'Hoover High' })
    const otherId = (other as { data: { schoolId: string } }).data.schoolId
    const r = await call('createSessionRequest', 'u_teacher', {
      grade: '10', topic: 'technology', sessionDate: futureDate(12), timeBand: 'midday', schoolId: otherId,
    })
    const id = (r as { data: { sessionId: string } }).data.sessionId
    expect(row('session_requests', id)?.schoolId).toBe(SCHOOL)
  })
  it('a teacher without a school, or at an inactive school, cannot post', async () => {
    db.get('role_assignments')!.set('u_teacher2', { userId: 'u_teacher2', role: 'teacher', assignedBy: OWNER })
    const req = { grade: '10', topic: 'technology', sessionDate: futureDate(12), timeBand: 'midday' }
    expect(await call('createSessionRequest', 'u_teacher2', req)).toMatchObject({ success: false, code: 'no_school' })
    await call('updateSchool', OWNER, { schoolId: SCHOOL, name: 'Lincoln High', active: false })
    expect(await call('createSessionRequest', 'u_teacher', req)).toMatchObject({ success: false, code: 'school_inactive' })
  })
  it('the booking notification names the school and its address', async () => {
    await call('claimSession', 'u_vol', { sessionId: S })
    const n = rows('notifications').find((x) => x.recipientId === 'u_vol' && x.kind === 'claim_confirmed')
    expect(n?.title).toContain('Lincoln High')
    expect(n?.body).toContain('4777 Imperial Ave')
  })
  it('school changes are audited', async () => {
    await call('updateSchool', OWNER, { schoolId: SCHOOL, name: 'Lincoln High School' })
    expect(rows('audit_log').some((a) => a.action === 'update_school' && a.toState === 'Lincoln High School')).toBe(true)
  })
})

describe('teacher invites (D10, standing test 20)', () => {
  const invite = (who: string, extra: Row = {}) =>
    call('inviteTeacher', who, { name: 'Ms. Rivera', email: 'Rivera@Lincoln.edu', schoolId: SCHOOL, ...extra })
  it('staff can invite a teacher by name and email to a school; members cannot', async () => {
    expect(await invite('u_vol')).toMatchObject({ success: false, code: 'forbidden' })
    expect(await invite('u_staff')).toMatchObject({ success: true, data: { accepted: false } })
    expect(rows('teacher_invites')[0]).toMatchObject({ email: 'rivera@lincoln.edu', name: 'Ms. Rivera', schoolId: SCHOOL, status: 'pending' })
  })
  it('signing in with the invited email gives teacher access at that school', async () => {
    await invite(OWNER)
    db.get('users')!.set('u_rivera', { email: 'rivera@lincoln.edu', name: 'Rivera', role: 'member' })
    expect(await call('acceptTeacherInvite', 'u_rivera')).toMatchObject({ success: true, data: { accepted: true, schoolName: 'Lincoln High' } })
    expect(row('role_assignments', 'u_rivera')).toMatchObject({ role: 'teacher', schoolId: SCHOOL })
    expect(rows('teacher_invites')[0]).toMatchObject({ status: 'accepted', acceptedBy: 'u_rivera' })
    expect((await call('createSessionRequest', 'u_rivera', { grade: '9', topic: 'healthcare', sessionDate: futureDate(9), timeBand: 'morning' })).success).toBe(true)
  })
  it('someone else signing in gets nothing — the server compares their verified account email, not anything they send', async () => {
    await invite(OWNER)
    expect(await call('acceptTeacherInvite', 'u_vol', { email: 'rivera@lincoln.edu' })).toMatchObject({ success: true, data: { accepted: false } })
    expect(row('role_assignments', 'u_vol')).toBeUndefined()
  })
  it('a revoked invite is not accepted', async () => {
    const r = await invite(OWNER)
    await call('revokeTeacherInvite', 'u_staff', { inviteId: (r as { data: { inviteId: string } }).data.inviteId })
    db.get('users')!.set('u_rivera', { email: 'rivera@lincoln.edu', role: 'member' })
    expect(await call('acceptTeacherInvite', 'u_rivera')).toMatchObject({ data: { accepted: false } })
    expect(row('role_assignments', 'u_rivera')).toBeUndefined()
  })
  it('inviting someone who already signed in gives access straight away', async () => {
    db.get('users')!.set('u_rivera', { email: 'rivera@lincoln.edu', role: 'member' })
    expect(await invite(OWNER)).toMatchObject({ success: true, data: { accepted: true } })
    expect(row('role_assignments', 'u_rivera')).toMatchObject({ role: 'teacher', schoolId: SCHOOL })
  })
  it('re-inviting the same email updates the one invite (no duplicates), and bad input is refused', async () => {
    await invite(OWNER)
    const other = await call('createSchool', OWNER, { name: 'Hoover High' })
    await invite(OWNER, { schoolId: (other as { data: { schoolId: string } }).data.schoolId })
    expect(rows('teacher_invites').length).toBe(1)
    expect(await invite(OWNER, { email: 'not-an-email' })).toMatchObject({ success: false, code: 'invalid_input' })
    expect(await invite(OWNER, { schoolId: 'nope' })).toMatchObject({ success: false, code: 'invalid_input' })
  })
})

describe('school view and session prep (D11, standing test 21)', () => {
  it('only the program admin assigns staff to a school, and only staff can be assigned', async () => {
    expect(await call('assignStaffSchool', 'u_staff', { userId: 'u_staff', schoolId: SCHOOL })).toMatchObject({ success: false, code: 'forbidden' })
    expect(await call('assignStaffSchool', OWNER, { userId: 'u_vol', schoolId: SCHOOL })).toMatchObject({ success: false, code: 'invalid_input' })
    expect((await call('assignStaffSchool', OWNER, { userId: 'u_staff', schoolId: SCHOOL })).success).toBe(true)
    expect(row('staff_schools', 'u_staff')).toMatchObject({ schoolId: SCHOOL })
  })
  it('staff assigned to another school cannot change or cancel this school’s sessions', async () => {
    const other = await call('createSchool', OWNER, { name: 'Hoover High' })
    await call('assignStaffSchool', OWNER, { userId: 'u_staff', schoolId: (other as { data: { schoolId: string } }).data.schoolId })
    expect(await call('updateSessionDetails', 'u_staff', { sessionId: S, room: '1' })).toMatchObject({ success: false, code: 'forbidden' })
    expect(await call('cancelSession', 'u_staff', { sessionId: S })).toMatchObject({ success: false, code: 'forbidden' })
    expect((await call('cancelSession', OWNER, { sessionId: S })).success).toBe(true) // the program admin can, anywhere
  })
  it('claiming puts the volunteer’s name on the session for the teacher; withdrawing clears it', async () => {
    await call('claimSession', 'u_vol', { sessionId: S })
    expect(row('session_details', S)?.volunteerName).toBe('u_vol, Nurse')
    await call('withdrawClaim', 'u_vol', { sessionId: S })
    expect(row('session_details', S)?.volunteerName).toBe('')
  })
  it('the booked volunteer lists what they need; the teacher is told; only known items are accepted', async () => {
    expect(await call('requestEquipment', 'u_vol', { sessionId: S, items: ['projector'] })).toMatchObject({ success: false, code: 'forbidden' }) // not booked
    await call('claimSession', 'u_vol', { sessionId: S })
    expect(await call('requestEquipment', 'u_vol2', { sessionId: S, items: ['projector'] })).toMatchObject({ success: false, code: 'forbidden' })
    expect(await call('requestEquipment', 'u_vol', { sessionId: S, items: ['flamethrower'] })).toMatchObject({ success: false, code: 'invalid_input' })
    expect((await call('requestEquipment', 'u_vol', { sessionId: S, items: ['projector', 'sharpies', 'projector'], other: 'Extension cord' })).success).toBe(true)
    expect(row('session_details', S)).toMatchObject({ equipmentRequested: ['projector', 'sharpies'], equipmentOther: 'Extension cord' })
    expect(rows('notifications').some((n) => n.recipientId === 'u_teacher' && String(n.title).includes('what they need'))).toBe(true)
  })
  it('the teacher records class and student count and marks requested items ready (only requested ones)', async () => {
    await call('claimSession', 'u_vol', { sessionId: S })
    await call('requestEquipment', 'u_vol', { sessionId: S, items: ['projector', 'paper'] })
    const r = await call('updateSessionDetails', 'u_teacher', {
      sessionId: S, room: '214', classLabel: 'AP Biology, period 3', studentCount: 28, equipmentReady: ['projector', 'speakers'],
    })
    expect(r.success).toBe(true)
    expect(row('session_details', S)).toMatchObject({ classLabel: 'AP Biology, period 3', studentCount: 28, equipmentReady: ['projector'] })
    const note = rows('notifications').filter((n) => n.recipientId === 'u_vol').at(-1)
    expect(note?.body).toContain('28 students')
    expect(note?.body).toContain('Ready: 1 of 2 items')
    expect(await call('updateSessionDetails', 'u_teacher', { sessionId: S, studentCount: 500 })).toMatchObject({ success: false, code: 'invalid_input' })
  })
  it('dropping an item from the request also drops it from "ready"', async () => {
    await call('claimSession', 'u_vol', { sessionId: S })
    await call('requestEquipment', 'u_vol', { sessionId: S, items: ['projector', 'paper'] })
    await call('updateSessionDetails', 'u_teacher', { sessionId: S, equipmentReady: ['projector', 'paper'] })
    await call('requestEquipment', 'u_vol', { sessionId: S, items: ['paper'] })
    expect(row('session_details', S)?.equipmentReady).toEqual(['paper'])
  })
})

describe('richer profile and license documents (D12, standing test 22)', () => {
  const add = (who: string, extra: Row = {}) =>
    call('addLicenseFile', who, { path: `/api/files/self/${who}/rn-license.pdf`, name: 'RN license.pdf', mime: 'application/pdf', size: 120000, ...extra })
  const fileIdOf = (r: unknown) => (r as { data: { fileId: string } }).data.fileId

  it('saves skills, years of experience, hobbies and license details', async () => {
    const r = await call('saveProfile', 'u_applicant', {
      displayName: 'Ana', profession: 'Nurse', employer: 'Hospital', skills: 'ER triage, Spanish', yearsExperience: 12, hobbies: 'Surfing',
      licenseType: 'Registered Nurse', licenseNumber: 'RN95123', licenseState: 'ca',
    })
    expect(r.success).toBe(true)
    expect(row('profiles', 'u_applicant')).toMatchObject({ skills: 'ER triage, Spanish', yearsExperience: 12, hobbies: 'Surfing', licenseState: 'CA' })
    expect(await call('saveProfile', 'u_applicant', { displayName: 'Ana', profession: 'Nurse', licenseState: 'California' })).toMatchObject({ success: false, code: 'invalid_input' })
    expect(await call('saveProfile', 'u_applicant', { displayName: 'Ana', profession: 'Nurse', yearsExperience: 300 })).toMatchObject({ success: false, code: 'invalid_input' })
  })
  it('changing license details after approval sends the volunteer back for review; hobbies do not', async () => {
    await call('saveProfile', 'u_vol', { displayName: 'u_vol', profession: 'Nurse', employer: 'Hospital', hobbies: 'Chess' })
    expect(row('volunteer_status', 'u_vol')?.status).toBe('approved')
    await call('saveProfile', 'u_vol', { displayName: 'u_vol', profession: 'Nurse', employer: 'Hospital', licenseNumber: 'RN1' })
    expect(row('volunteer_status', 'u_vol')?.status).toBe('applied')
  })
  it('a volunteer registers their own upload; bad locations, types and sizes are refused', async () => {
    expect((await add('u_applicant')).success).toBe(true)
    expect(rows('license_files')[0]).toMatchObject({ volunteerId: 'u_applicant', removed: false })
    expect(await add('u_applicant', { path: 'https://evil.example/x.pdf' })).toMatchObject({ success: false, code: 'invalid_input' })
    expect(await add('u_applicant', { path: '/api/files/../secrets' })).toMatchObject({ success: false, code: 'invalid_input' })
    expect(await add('u_applicant', { mime: 'text/html' })).toMatchObject({ success: false, code: 'invalid_input' })
    expect(await add('u_applicant', { size: 6 * 1024 * 1024 })).toMatchObject({ success: false, code: 'invalid_input' })
  })
  it('the program admin can open it; it is fetched from the VOLUNTEER’s space; the view is logged', async () => {
    fetched.length = 0
    const id = fileIdOf(await add('u_applicant'))
    const r = await call('openLicenseFile', OWNER, { fileId: id })
    expect(r).toMatchObject({ success: true, data: { name: 'RN license.pdf', mime: 'application/pdf' } })
    expect(fetched).toEqual([{ ownerId: 'u_applicant', path: '/api/files/self/u_applicant/rn-license.pdf' }])
    expect(rows('audit_log').some((a) => a.action === 'view_license_file' && a.actorId === OWNER && a.targetId === 'u_applicant')).toBe(true)
  })
  it('other volunteers, teachers and staff without delegation cannot open it', async () => {
    const id = fileIdOf(await add('u_applicant'))
    for (const who of ['u_vol', 'u_teacher', 'u_staff']) {
      expect(await call('openLicenseFile', who, { fileId: id })).toMatchObject({ success: false, code: 'forbidden' })
    }
    await call('grantVettingHelp', OWNER, { userId: 'u_staff', days: 3, reason: 'Covering' })
    expect((await call('openLicenseFile', 'u_staff', { fileId: id })).success).toBe(true)
  })
  it('a volunteer can open and remove their own file; removed files cannot be opened; others cannot remove it', async () => {
    const id = fileIdOf(await add('u_applicant'))
    expect((await call('openLicenseFile', 'u_applicant', { fileId: id })).success).toBe(true)
    expect(await call('removeLicenseFile', 'u_vol', { fileId: id })).toMatchObject({ success: false, code: 'not_found' })
    expect((await call('removeLicenseFile', 'u_applicant', { fileId: id })).success).toBe(true)
    expect(await call('openLicenseFile', OWNER, { fileId: id })).toMatchObject({ success: false, code: 'not_found' })
  })
  it('at most 5 live files per volunteer', async () => {
    for (let i = 0; i < 5; i++) expect((await add('u_applicant', { path: `/api/files/self/u_applicant/f${i}.pdf` })).success).toBe(true)
    expect(await add('u_applicant', { path: '/api/files/self/u_applicant/f6.pdf' })).toMatchObject({ success: false, code: 'too_many' })
  })
})

describe('assigning, class ready, new dates and contact (D13, standing test 23)', () => {
  const details = () => row('session_details', S) as Row
  it('the program admin can book an approved volunteer onto a session; the same checks apply', async () => {
    expect(await call('assignVolunteer', 'u_staff', { sessionId: S, volunteerId: 'u_vol' })).toMatchObject({ success: false, code: 'forbidden' })
    expect(await call('assignVolunteer', OWNER, { sessionId: S, volunteerId: 'u_applicant' })).toMatchObject({ success: false, code: 'not_approved' })
    expect(await call('assignVolunteer', OWNER, { sessionId: S, volunteerId: 'u_expired' })).toMatchObject({ success: false, code: 'clearance_expired' })
    expect((await call('assignVolunteer', OWNER, { sessionId: S, volunteerId: 'u_vol' })).success).toBe(true)
    expect(rows('claims').find((c) => c.status === 'active')).toMatchObject({ volunteerId: 'u_vol', sessionId: S })
    expect(rows('notifications').some((n) => n.recipientId === 'u_vol' && String(n.title).startsWith('The program booked you'))).toBe(true)
    expect(await call('assignVolunteer', OWNER, { sessionId: S, volunteerId: 'u_vol2' })).toMatchObject({ success: false, code: 'already_claimed' })
  })
  it('booking shares contact details only on the private session row, never in notifications', async () => {
    await call('saveProfile', 'u_vol', { displayName: 'u_vol', profession: 'Nurse', employer: 'Hospital', phone: '+1 (619) 555-0100' })
    // (profile edit sent u_vol back to review only if work/license fields changed — phone doesn't)
    expect(row('volunteer_status', 'u_vol')?.status).toBe('approved')
    await call('claimSession', 'u_vol', { sessionId: S })
    expect(details()).toMatchObject({ volunteerEmail: 'u_vol@example.org', volunteerPhone: '+1 (619) 555-0100', teacherEmail: 'u_teacher@example.org' })
    expect(JSON.stringify(rows('notifications'))).not.toMatch(/@example\.org|555-0100/)
    await call('withdrawClaim', 'u_vol', { sessionId: S })
    expect(details()).toMatchObject({ volunteerEmail: '', volunteerPhone: '', collaborators: [] })
  })
  it('a bad phone number is refused', async () => {
    expect(await call('saveProfile', 'u_vol', { displayName: 'u_vol', profession: 'Nurse', employer: 'Hospital', phone: 'call me maybe' })).toMatchObject({ success: false, code: 'invalid_input' })
  })
  it('the teacher marks the class ready; the volunteer is told; nobody else can', async () => {
    expect(await call('markClassReady', 'u_teacher', { sessionId: S })).toMatchObject({ success: false, code: 'stale_state' }) // nobody booked
    await call('claimSession', 'u_vol', { sessionId: S })
    expect(await call('markClassReady', 'u_teacher2', { sessionId: S })).toMatchObject({ success: false, code: 'forbidden' })
    expect(await call('markClassReady', 'u_vol', { sessionId: S })).toMatchObject({ success: false, code: 'forbidden' })
    expect((await call('markClassReady', 'u_teacher', { sessionId: S, note: 'Projector set up' })).success).toBe(true)
    expect(details().readyAt).toBeGreaterThan(0)
    expect(rows('notifications').some((n) => n.recipientId === 'u_vol' && String(n.title).startsWith('Your class is ready'))).toBe(true)
  })
  it('the teacher proposes a later date; only the volunteer can accept; accepting moves the session', async () => {
    await call('claimSession', 'u_vol', { sessionId: S })
    expect((await call('proposeNewDate', 'u_teacher', { sessionId: S, date: futureDate(20), timeBand: 'afternoon', note: 'Projector out for repair' })).success).toBe(true)
    expect(await call('respondToProposal', 'u_teacher', { sessionId: S, answer: 'accept' })).toMatchObject({ success: false, code: 'forbidden' })
    expect(await call('respondToProposal', 'u_vol2', { sessionId: S, answer: 'accept' })).toMatchObject({ success: false, code: 'forbidden' })
    expect((await call('respondToProposal', 'u_vol', { sessionId: S, answer: 'accept' })).success).toBe(true)
    expect(row('session_requests', S)).toMatchObject({ timeBand: 'afternoon', status: 'confirmed' })
    expect(details()).toMatchObject({ proposedDate: null, proposedBy: '', readyAt: null })
  })
  it('the volunteer proposes a later date; the teacher side answers; declining keeps the date', async () => {
    await call('claimSession', 'u_vol', { sessionId: S })
    const before = row('session_requests', S)?.sessionDate
    expect((await call('proposeNewDate', 'u_vol', { sessionId: S, date: futureDate(25), timeBand: 'midday' })).success).toBe(true)
    expect(await call('respondToProposal', 'u_vol', { sessionId: S, answer: 'accept' })).toMatchObject({ success: false, code: 'forbidden' })
    expect((await call('respondToProposal', 'u_teacher', { sessionId: S, answer: 'decline' })).success).toBe(true)
    expect(row('session_requests', S)?.sessionDate).toBe(before)
    expect(rows('notifications').some((n) => n.recipientId === 'u_vol' && String(n.title).startsWith('Proposed date declined'))).toBe(true)
  })
  it('proposals must be in the future, differ from the current date, and come from a party to the booking', async () => {
    await call('claimSession', 'u_vol', { sessionId: S })
    expect(await call('proposeNewDate', 'u_vol', { sessionId: S, date: '2020-01-01', timeBand: 'morning' })).toMatchObject({ success: false, code: 'invalid_input' })
    expect(await call('proposeNewDate', 'u_vol2', { sessionId: S, date: futureDate(25), timeBand: 'morning' })).toMatchObject({ success: false, code: 'forbidden' })
    const cur = row('session_requests', S) as Row
    const iso = new Date((cur.sessionDate as number) * 1000).toISOString().slice(0, 10)
    expect(await call('proposeNewDate', 'u_vol', { sessionId: S, date: iso, timeBand: cur.timeBand })).toMatchObject({ success: false, code: 'invalid_input' })
  })
})

describe('access needs (D14, standing test 24)', () => {
  const needs = 'Step-free route and parking close to the entrance'
  it('saved on the profile without sending an approved volunteer back to review', async () => {
    await call('saveProfile', 'u_vol', { displayName: 'u_vol', profession: 'Nurse', employer: 'Hospital', accessNeeds: needs })
    expect(row('profiles', 'u_vol')?.accessNeeds).toBe(needs)
    expect(row('volunteer_status', 'u_vol')?.status).toBe('approved')
  })
  it('copied to the private session row on booking; the teacher is told THAT there are needs, not WHAT', async () => {
    await call('saveProfile', 'u_vol', { displayName: 'u_vol', profession: 'Nurse', employer: 'Hospital', accessNeeds: needs })
    await call('claimSession', 'u_vol', { sessionId: S })
    expect(row('session_details', S)?.accessNeeds).toBe(needs)
    const n = rows('notifications').find((x) => x.recipientId === 'u_teacher' && x.kind === 'session_claimed')
    expect(String(n?.body)).toContain('access needs')
    expect(JSON.stringify(rows('notifications'))).not.toContain('Step-free')
  })
  it('the volunteer can adjust them for one session; others cannot; withdrawing clears them', async () => {
    await call('claimSession', 'u_vol', { sessionId: S })
    expect((await call('requestEquipment', 'u_vol', { sessionId: S, items: [], accessNeeds: 'A chair at the front' })).success).toBe(true)
    expect(row('session_details', S)?.accessNeeds).toBe('A chair at the front')
    expect(await call('requestEquipment', 'u_vol2', { sessionId: S, items: [], accessNeeds: 'x' })).toMatchObject({ success: false, code: 'forbidden' })
    await call('withdrawClaim', 'u_vol', { sessionId: S })
    expect(row('session_details', S)?.accessNeeds).toBe('')
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
    const approved = await call('vetVolunteer', OWNER, { userId: 'u_applicant', outcome: 'approved', identityConfirmed: true, clearanceExpiresAt: futureDate(30) })
    expect(JSON.stringify(approved)).not.toMatch(/@|jwt|token/i)
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

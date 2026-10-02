/**
 * Permission matrix tests (requirements §3.1, GUARDRAILS §1).
 *
 * Runs our schemas through the SDK's OWN server-side permission functions
 * (canRead / canCreate / canUpdate / canDelete / checkFieldPermissions) — the same
 * code the Durable Object uses — so a schema change that weakens any rule fails CI.
 * Also runs the SDK's schema lint.
 *
 * Roles: 'member' = every signed-in user (volunteer, teacher, school admin);
 * 'admin' = nonprofit staff; 'anonymous' = signed out (no rule → deny).
 * Teacher / school-admin privileges are NOT here: they are enforced inside server
 * actions (decision R3), and are covered by the api.spec.ts action tests.
 */
import { describe, expect, it } from 'vitest'
import {
  canCreate,
  canDelete,
  canRead,
  canUpdate,
  checkFieldPermissions,
  lintSchemas,
  SYSTEM_ASSIGNED_COLUMNS,
} from 'deepspace/worker'
import type { CollectionSchema } from 'deepspace/schema'
import { schemas } from '../schemas'

const S = Object.fromEntries(schemas.map((s) => [s.name, s])) as Record<string, CollectionSchema>
const rec = (data: Record<string, unknown>) => ({ recordId: 'r1', data, createdBy: 'x' }) as never

const TEACHER = 'u_teacher'
const VOL = 'u_volunteer'
const OTHER = 'u_other'
const STAFF = 'u_staff'
const ANON = 'anon-1'

describe('schema set', () => {
  it('passes the SDK schema lint with no warnings', () => {
    expect(lintSchemas(schemas)).toEqual([])
  })

  it('no collection lets anyone create records directly except via server actions', () => {
    for (const s of schemas) {
      if (s.name === 'users' || s.name === 'settings') continue
      expect(canCreate(s, 'member'), `${s.name} member create`).toBe(false)
      expect(canCreate(s, 'anonymous'), `${s.name} anonymous create`).toBe(false)
    }
  })

  it('signed-out callers can read nothing in our collections', () => {
    for (const s of schemas) {
      if (s.name === 'users' || s.name === 'settings') continue
      expect(canRead(s, 'anonymous', rec({}), ANON), `${s.name}`).toBe(false)
    }
  })

  it("users.role is system-managed (members can't promote themselves)", () => {
    expect(SYSTEM_ASSIGNED_COLUMNS.has('role')).toBe(true)
  })
})

describe('session_details — private logistics (P2)', () => {
  const d = rec({ sessionId: 's1', teacherId: TEACHER, collaborators: [VOL] })
  it('owning teacher can read', () => expect(canRead(S.session_details, 'member', d, TEACHER)).toBe(true))
  it('claimant can read', () => expect(canRead(S.session_details, 'member', d, VOL)).toBe(true))
  it('other volunteers cannot read', () => expect(canRead(S.session_details, 'member', d, OTHER)).toBe(false))
  it('staff can read', () => expect(canRead(S.session_details, 'admin', d, STAFF)).toBe(true))
})

describe('claims', () => {
  const c = rec({ sessionId: 's1', volunteerId: VOL, collaborators: [TEACHER] })
  it('claimant can read own claim', () => expect(canRead(S.claims, 'member', c, VOL)).toBe(true))
  it('owning teacher can read', () => expect(canRead(S.claims, 'member', c, TEACHER)).toBe(true))
  it('other volunteers cannot read', () => expect(canRead(S.claims, 'member', c, OTHER)).toBe(false))
  it('claimant cannot edit directly', () => expect(canUpdate(S.claims, 'member', c, VOL)).toBe(false))
  it('one active claim per session is a database constraint', () =>
    expect(S.claims.uniqueOn).toEqual(['activeSlot']))
})

describe('session_requests — the board', () => {
  const r = rec({ teacherId: TEACHER, status: 'open' })
  it('signed-in members can read the board', () => expect(canRead(S.session_requests, 'member', r, OTHER)).toBe(true))
  it('owning teacher cannot edit directly (actions only)', () =>
    expect(canUpdate(S.session_requests, 'member', r, TEACHER)).toBe(false))
  it('has no private columns', () => {
    const cols = S.session_requests.columns.map((c) => c.name)
    for (const forbidden of ['room', 'startTime', 'arrivalNote', 'teacherNote', 'email']) {
      expect(cols).not.toContain(forbidden)
    }
  })
})

describe('volunteer_status and role_assignments — no self-service privilege', () => {
  const v = rec({ userId: VOL, status: 'applied' })
  it('volunteer reads own status', () => expect(canRead(S.volunteer_status, 'member', v, VOL)).toBe(true))
  it("volunteer cannot read others' status", () => expect(canRead(S.volunteer_status, 'member', v, OTHER)).toBe(false))
  it('volunteer cannot self-approve', () => expect(canUpdate(S.volunteer_status, 'member', v, VOL)).toBe(false))
  it('staff cannot write status directly (audited actions only)', () =>
    expect(canUpdate(S.volunteer_status, 'admin', v, STAFF)).toBe(false))
  it('member cannot create a role assignment', () => expect(canCreate(S.role_assignments, 'member')).toBe(false))
  it('staff cannot write roles directly (audited actions only)', () =>
    expect(canCreate(S.role_assignments, 'admin')).toBe(false))
})

describe('notifications — private, only readAt writable', () => {
  const n = rec({ recipientId: VOL, title: 'Claimed', readAt: null })
  it('recipient reads own', () => expect(canRead(S.notifications, 'member', n, VOL)).toBe(true))
  it('others cannot read', () => expect(canRead(S.notifications, 'member', n, OTHER)).toBe(false))
  it('others cannot update', () => expect(canUpdate(S.notifications, 'member', n, OTHER)).toBe(false))
  it('recipient can mark as read', () =>
    expect(checkFieldPermissions(S.notifications, 'member', { readAt: 1 }, { readAt: null })).toBeNull())
  it('recipient cannot rewrite the message', () =>
    expect(checkFieldPermissions(S.notifications, 'member', { title: 'Hacked' }, { title: 'Claimed' })).toBeTypeOf(
      'string',
    ))
})

describe('audit_log — append-only (M9, GUARDRAILS §1.10)', () => {
  const a = rec({ actorId: STAFF, action: 'vet' })
  it('staff can read', () => expect(canRead(S.audit_log, 'admin', a, STAFF)).toBe(true))
  it('members cannot read', () => expect(canRead(S.audit_log, 'member', a, VOL)).toBe(false))
  for (const role of ['admin', 'member', 'anonymous']) {
    it(`${role} cannot update or delete`, () => {
      expect(canUpdate(S.audit_log, role, a, STAFF)).toBe(false)
      expect(canDelete(S.audit_log, role, a, STAFF)).toBe(false)
    })
  }
})

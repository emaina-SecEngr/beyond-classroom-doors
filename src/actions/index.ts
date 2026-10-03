/**
 * Server actions — the only way anything is written (schemas grant no direct writes).
 *
 * Every action:
 *   1. takes identity ONLY from ctx.userId (never from params)        GUARDRAILS §1.1
 *   2. checks WHO (staff / app role / volunteer status)                §1.2
 *   3. checks WHETHER (the target record's CURRENT state)              §1.12
 *   4. writes, then records an audit entry with the actor             §1.10
 *   5. returns only fields the caller needs — no emails, no tokens    §1.5
 *
 * Requirement IDs refer to docs/requirements.md.
 */
import type { ActionHandler } from 'deepspace/worker'
import type { Env } from '../../worker'
import {
  APP_ROLES,
  GRADES,
  SELF_WITHDRAW_MIN_HOURS,
  EQUIPMENT,
  type Equipment,
  VETTING_HELP_DEFAULT_DAYS,
  VETTING_HELP_MAX_DAYS,
  TIME_BANDS,
  TOPICS,
  CHANGE_REQUEST_KINDS,
  type TimeBand,
  type SessionStatus,
} from '../schemas/shared'
import {
  activeVettingHelp,
  appRoleOf,
  audit,
  bool,
  calendarLink,
  dateParam,
  formatDate,
  getData,
  int,
  isNonprofitAdmin,
  isStaff,
  must,
  notify,
  nowSeconds,
  ok,
  oneOf,
  refuse,
  requireAppRole,
  requireCanVet,
  requireNonprofitAdmin,
  requireStaff,
  run,
  sessionStartSeconds,
  statusOf,
  str,
} from './lib'

interface Profile extends Record<string, unknown> {
  userId: string
  displayName: string
  profession: string
  employer: string
}
interface School extends Record<string, unknown> {
  name: string
  district: string
  city: string
  address: string
  active: boolean | number
}
interface SessionRequest extends Record<string, unknown> {
  teacherId: string
  grade: string
  topic: string
  topicOther: string
  sessionDate: number
  timeBand: TimeBand
  expectedHeadcount: number | null
  status: SessionStatus
  schoolId?: string
}
interface SessionDetails extends Record<string, unknown> {
  classLabel?: string
  studentCount?: number | null
  equipmentRequested?: string[]
  equipmentOther?: string
  equipmentReady?: string[]
  volunteerName?: string
  sessionId: string
  teacherId: string
  room: string
  startTime: string
  arrivalNote: string
  teacherNote: string
  collaborators: string[]
}
interface Claim extends Record<string, unknown> {
  sessionId: string
  volunteerId: string
  status: 'active' | 'withdrawn'
  activeSlot: string
  confirmedAt: number | null
  collaborators: string[]
}

const topicLabel = (r: Pick<SessionRequest, 'topic' | 'topicOther'>) =>
  r.topic === 'other' && r.topicOther ? r.topicOther : r.topic.replace('-', ' ')

async function activeClaimFor(tools: Parameters<ActionHandler>[0]['tools'], sessionId: string) {
  const r = await tools.query<Claim>('claims', { where: { activeSlot: sessionId }, limit: 1 })
  return r.success && r.data.records.length ? r.data.records[0] : null
}

/**
 * Who may change a session (D11): its own teacher, the program admin, or staff
 * assigned to the session's school. Other staff are refused.
 */
async function requireSessionEditor(tools: Parameters<ActionHandler>[0]['tools'], userId: string, ownerUserId: string | undefined, session: SessionRequest) {
  if (session.teacherId === userId && (await appRoleOf(tools, userId)) === 'teacher') return
  if (isNonprofitAdmin(userId, ownerUserId)) return
  if (await isStaff(tools, userId, ownerUserId)) {
    const mine = await getData<{ schoolId?: string }>(tools, 'staff_schools', userId)
    if (mine?.schoolId && mine.schoolId === session.schoolId) return
    refuse('You can only change sessions at the school you’re assigned to.', 'forbidden')
  }
  refuse('Only the session’s teacher or program staff can change it.', 'forbidden')
}

/** Equipment list from params: known items only, no duplicates. */
function equipmentParam(params: Record<string, unknown>, key: string): Equipment[] {
  const raw = params[key]
  if (raw === undefined || raw === null) return []
  if (!Array.isArray(raw)) refuse(`${key} must be a list.`, 'invalid_input')
  const out = new Set<Equipment>()
  for (const v of raw as unknown[]) {
    if (typeof v !== 'string' || !(EQUIPMENT as readonly string[]).includes(v)) refuse(`Unknown item: ${String(v).slice(0, 30)}.`, 'invalid_input')
    out.add(v as Equipment)
  }
  return [...out]
}

/** Turn a pending invite into teacher access at its school (D10). */
async function acceptInvite(
  tools: Parameters<ActionHandler>[0]['tools'],
  targetId: string,
  inviteId: string,
  invite: { name: string; schoolId: string; invitedBy: string },
  schoolName: string,
) {
  await must(tools.create('role_assignments', { userId: targetId, role: 'teacher', assignedBy: invite.invitedBy, schoolId: invite.schoolId }, targetId), 'assign from invite')
  await must(tools.update('teacher_invites', inviteId, { status: 'accepted', acceptedBy: targetId }), 'accept invite')
  await audit(tools, { actorId: targetId, action: 'accept_invite', targetType: 'invite', targetId: inviteId, fromState: 'pending', toState: `teacher@${invite.schoolId}` })
  await notify(tools, { recipientId: targetId, kind: 'status_changed', title: `Welcome. You have teacher access at ${schoolName}.` })
}

export const actions: Record<string, ActionHandler<Env>> = {
  // ── R6 · Is the caller the nonprofit admin? (display only — the worker enforces) ──
  myAccess: ({ userId, tools, env }) =>
    run('myAccess', async () => {
      const nonprofitAdmin = isNonprofitAdmin(userId, env.OWNER_USER_ID)
      const help = nonprofitAdmin ? null : await activeVettingHelp(tools, userId)
      const staff = nonprofitAdmin || (await isStaff(tools, userId, env.OWNER_USER_ID))
      return ok({ nonprofitAdmin, canVet: nonprofitAdmin || (staff && !!help), vettingHelpEndsAt: help?.endsAt ?? null })
    }),

  // ── R7 · The nonprofit admin asks a staff member for vetting help (time-boxed) ──
  grantVettingHelp: ({ userId, params, tools, env }) =>
    run('grantVettingHelp', async () => {
      requireNonprofitAdmin(userId, env.OWNER_USER_ID)
      const targetId = str(params, 'userId', { required: true, max: 100 })
      if (targetId === userId) refuse('You already vet as the nonprofit admin.', 'invalid_input')
      if (!(await isStaff(tools, targetId, env.OWNER_USER_ID))) refuse('Only program staff can be asked to help with vetting.', 'invalid_input')
      const days = int(params, 'days', { min: 1, max: VETTING_HELP_MAX_DAYS }) ?? VETTING_HELP_DEFAULT_DAYS
      const reason = str(params, 'reason', { required: true, max: 300 })
      const startsAt = nowSeconds()
      const endsAt = startsAt + days * 86400
      await must(tools.create('vetting_help', { userId: targetId, grantedBy: userId, reason, startsAt, endsAt }, targetId), 'grant help')
      await audit(tools, { actorId: userId, action: 'grant_vetting_help', targetType: 'user', targetId, toState: `until ${new Date(endsAt * 1000).toISOString().slice(0, 10)}`, reason })
      await notify(tools, { recipientId: targetId, kind: 'status_changed', title: 'The nonprofit admin asked you to help with vetting.', body: `For ${days} day${days === 1 ? '' : 's'}. ${reason}` })
      return ok({ userId: targetId, endsAt })
    }),

  endVettingHelp: ({ userId, params, tools, env }) =>
    run('endVettingHelp', async () => {
      requireNonprofitAdmin(userId, env.OWNER_USER_ID)
      const targetId = str(params, 'userId', { required: true, max: 100 })
      if (!(await activeVettingHelp(tools, targetId))) refuse('That person isn’t helping with vetting right now.', 'stale_state')
      await must(tools.update('vetting_help', targetId, { endsAt: nowSeconds() }), 'end help')
      await audit(tools, { actorId: userId, action: 'end_vetting_help', targetType: 'user', targetId, toState: 'ended' })
      await notify(tools, { recipientId: targetId, kind: 'status_changed', title: 'Your vetting help has ended. Thank you.' })
      return ok({ userId: targetId })
    }),

  // ── M1 · Volunteer profile / application ──────────────────────────────────
  saveProfile: ({ userId, params, tools }) =>
    run('saveProfile', async () => {
      const displayName = str(params, 'displayName', { required: true, max: 80 })
      const profession = str(params, 'profession', { required: true, max: 80 })
      const employer = str(params, 'employer', { max: 120 })

      const before = await getData<Profile>(tools, 'profiles', userId)
      await must(tools.create('profiles', { userId, displayName, profession, employer }, userId), 'save profile')

      const status = await statusOf(tools, userId)
      if (!status) {
        await must(tools.create('volunteer_status', { userId, status: 'applied' }, userId), 'create status')
        await audit(tools, { actorId: userId, action: 'apply', targetType: 'volunteer', targetId: userId, toState: 'applied' })
        return ok({ status: 'applied' })
      }

      // M1-AC4: changing what was vetted sends the volunteer back for review.
      const changed = before && (before.profession !== profession || before.employer !== employer)
      if (changed && status.status !== 'applied') {
        await must(tools.update('volunteer_status', userId, { status: 'applied', decisionReason: 'Profile changed after vetting' }), 'reset status')
        await audit(tools, {
          actorId: userId,
          action: 'status_reset',
          targetType: 'volunteer',
          targetId: userId,
          fromState: status.status,
          toState: 'applied',
          reason: 'Profession or employer changed after vetting',
        })
        return ok({ status: 'applied', reset: true })
      }
      return ok({ status: status.status })
    }),

  // ── D9 · Schools in the district — the program admin manages them ─────────
  createSchool: ({ userId, params, tools, env }) =>
    run('createSchool', async () => {
      requireNonprofitAdmin(userId, env.OWNER_USER_ID)
      const data = {
        name: str(params, 'name', { required: true, max: 80 }),
        district: str(params, 'district', { max: 80 }),
        city: str(params, 'city', { max: 60 }),
        address: str(params, 'address', { max: 160 }),
        active: true,
        createdByUser: userId,
      }
      const created = await tools.create('schools', data)
      if (!created.success) refuse(`A school called “${data.name}” already exists.`, 'duplicate')
      const schoolId = (created as { data: { recordId: string } }).data.recordId
      await audit(tools, { actorId: userId, action: 'create_school', targetType: 'school', targetId: schoolId, toState: data.name })
      return ok({ schoolId })
    }),

  updateSchool: ({ userId, params, tools, env }) =>
    run('updateSchool', async () => {
      requireNonprofitAdmin(userId, env.OWNER_USER_ID)
      const schoolId = str(params, 'schoolId', { required: true, max: 100 })
      const before = await getData<School>(tools, 'schools', schoolId)
      if (!before) refuse('School not found.', 'not_found')
      const next = {
        name: str(params, 'name', { required: true, max: 80 }),
        district: str(params, 'district', { max: 80 }),
        city: str(params, 'city', { max: 60 }),
        address: str(params, 'address', { max: 160 }),
        active: params.active === undefined ? !!before!.active : bool(params, 'active'),
      }
      const r = await tools.update('schools', schoolId, next)
      if (!r.success) refuse(`A school called “${next.name}” already exists.`, 'duplicate')
      await audit(tools, {
        actorId: userId,
        action: 'update_school',
        targetType: 'school',
        targetId: schoolId,
        fromState: `${before!.name}${before!.active ? '' : ' (inactive)'}`,
        toState: `${next.name}${next.active ? '' : ' (inactive)'}`,
      })
      return ok({ schoolId })
    }),

  // ── D10 · Teacher invites: list a school's teachers before they sign in ───
  inviteTeacher: ({ userId, params, tools, env }) =>
    run('inviteTeacher', async () => {
      await requireStaff(tools, userId, env.OWNER_USER_ID)
      const name = str(params, 'name', { required: true, max: 80 })
      const email = str(params, 'email', { required: true, max: 120 }).toLowerCase()
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) refuse('Enter a valid email address.', 'invalid_input')
      const schoolId = str(params, 'schoolId', { required: true, max: 100 })
      const school = await getData<School>(tools, 'schools', schoolId)
      if (!school) refuse('Choose a school.', 'invalid_input')
      if (!school!.active) refuse(`${school!.name} is inactive.`, 'invalid_input')

      // One invite per email: re-inviting updates the existing row (keeps history in the audit log).
      const existing = await tools.query<{ status: string }>('teacher_invites', { where: { email }, limit: 1 })
      const prior = existing.success ? existing.data.records[0] : undefined
      const data = { email, name, schoolId, invitedBy: userId, status: 'pending', acceptedBy: '' }
      const inviteId = prior
        ? (await must(tools.update('teacher_invites', prior.recordId, data), 'update invite')).recordId
        : (await must(tools.create('teacher_invites', data), 'create invite')).recordId
      await audit(tools, { actorId: userId, action: 'invite_teacher', targetType: 'invite', targetId: inviteId, toState: `pending@${schoolId}`, reason: name })

      // Already signed in with that email? Give access now instead of waiting.
      const users = await tools.query<{ email?: string }>('users', { where: { email }, limit: 1 })
      const match = users.success ? users.data.records[0] : undefined
      if (match) {
        await acceptInvite(tools, match.recordId, inviteId, { name, schoolId, invitedBy: userId }, school!.name)
        return ok({ inviteId, accepted: true })
      }
      return ok({ inviteId, accepted: false })
    }),

  revokeTeacherInvite: ({ userId, params, tools, env }) =>
    run('revokeTeacherInvite', async () => {
      await requireStaff(tools, userId, env.OWNER_USER_ID)
      const inviteId = str(params, 'inviteId', { required: true, max: 100 })
      const invite = await getData<{ status: string }>(tools, 'teacher_invites', inviteId)
      if (!invite) refuse('Invite not found.', 'not_found')
      if (invite!.status !== 'pending') refuse(`This invite was already ${invite!.status}.`, 'stale_state')
      await must(tools.update('teacher_invites', inviteId, { status: 'revoked' }), 'revoke invite')
      await audit(tools, { actorId: userId, action: 'revoke_invite', targetType: 'invite', targetId: inviteId, fromState: 'pending', toState: 'revoked' })
      return ok({ inviteId })
    }),

  /**
   * Called by the app once after sign-in. Matches the caller's VERIFIED account email
   * (their users row, written by the platform) against pending invites — the browser
   * sends nothing but its token.
   */
  acceptTeacherInvite: ({ userId, tools }) =>
    run('acceptTeacherInvite', async () => {
      if (await appRoleOf(tools, userId)) return ok({ accepted: false })
      const me = await getData<{ email?: string }>(tools, 'users', userId)
      const email = (me?.email ?? '').trim().toLowerCase()
      if (!email) return ok({ accepted: false })
      const found = await tools.query<{ email: string; name: string; schoolId: string; invitedBy: string; status: string }>('teacher_invites', {
        where: { email, status: 'pending' },
        limit: 1,
      })
      const invite = found.success ? found.data.records[0] : undefined
      if (!invite) return ok({ accepted: false })
      const school = await getData<School>(tools, 'schools', invite.data.schoolId)
      if (!school || !school.active) return ok({ accepted: false })
      await acceptInvite(tools, userId, invite.recordId, invite.data, school.name)
      return ok({ accepted: true, schoolName: school.name })
    }),

  // ── M4 · Staff assign app roles (teacher) ─────────────────────────────────
  assignRole: ({ userId, params, tools, env }) =>
    run('assignRole', async () => {
      await requireStaff(tools, userId, env.OWNER_USER_ID)
      const targetId = str(params, 'userId', { required: true, max: 100 })
      const role = oneOf(params, 'role', APP_ROLES)
      const target = await getData(tools, 'users', targetId)
      if (!target) refuse('That user has not signed in yet.', 'not_found')
      // D9: every teacher belongs to one active school.
      const schoolId = str(params, 'schoolId', { required: true, max: 100 })
      const school = await getData<School>(tools, 'schools', schoolId)
      if (!school) refuse('Choose a school for this teacher.', 'invalid_input')
      if (!school!.active) refuse(`${school!.name} is inactive. Reactivate it first.`, 'invalid_input')
      const previous = await getData<{ role?: string; schoolId?: string }>(tools, 'role_assignments', targetId)
      await must(tools.create('role_assignments', { userId: targetId, role, assignedBy: userId, schoolId }, targetId), 'assign role')
      await audit(tools, {
        actorId: userId,
        action: 'assign_role',
        targetType: 'user',
        targetId,
        fromState: previous ? `${previous.role ?? ''}${previous.schoolId ? `@${previous.schoolId}` : ''}` : 'none',
        toState: `${role}@${schoolId}`,
      })
      await notify(tools, { recipientId: targetId, kind: 'status_changed', title: `You now have teacher access at ${school!.name}.` })
      return ok({ userId: targetId, role, schoolId })
    }),

  removeRole: ({ userId, params, tools, env }) =>
    run('removeRole', async () => {
      await requireStaff(tools, userId, env.OWNER_USER_ID)
      const targetId = str(params, 'userId', { required: true, max: 100 })
      // Read the raw row: a retired role (e.g. the old board seat, D3b) can still be removed.
      const row = await getData<{ role?: string }>(tools, 'role_assignments', targetId)
      if (!row) refuse('That user has no app role.', 'not_found')
      await must(tools.remove('role_assignments', targetId), 'remove role')
      await audit(tools, { actorId: userId, action: 'remove_role', targetType: 'user', targetId, fromState: row!.role ?? '', toState: 'none' })
      return ok({ userId: targetId })
    }),

  // ── M2 · The nonprofit admin vets AND approves — one final decision (D3b) ──
  vetVolunteer: ({ userId, params, tools, env }) =>
    run('vetVolunteer', async () => {
      // R7: the nonprofit admin decides; staff only while the admin has asked them to help.
      await requireCanVet(tools, userId, env.OWNER_USER_ID)
      const targetId = str(params, 'userId', { required: true, max: 100 })
      const outcome = oneOf(params, 'outcome', ['approved', 'rejected'] as const)
      const reason = str(params, 'reason', { max: 500 })

      const current = await statusOf(tools, targetId)
      if (!current) refuse('No application found for that volunteer.', 'not_found')
      // D3b: the decision is final. Only an open application can be decided; an approved
      // or rejected volunteer can't be re-decided by anyone. ('vetted' = left over from
      // the retired two-key flow, still waiting for a decision.)
      if (!['applied', 'renewal_pending', 'vetted'].includes(current!.status)) {
        refuse(`This application was already decided (${current!.status}). That decision is final.`, 'stale_state')
      }

      if (outcome === 'rejected') {
        if (!reason) refuse('A reason is required to reject.', 'invalid_input')
        await must(tools.update('volunteer_status', targetId, { status: 'rejected', decisionReason: reason, vettedBy: userId, approvedBy: userId }), 'reject')
      } else {
        if (!bool(params, 'identityConfirmed')) refuse('Confirm identity before approving.', 'invalid_input')
        const clearanceExpiresAt = dateParam(params, 'clearanceExpiresAt', { required: true })!
        if (clearanceExpiresAt <= nowSeconds()) refuse('Clearance expiry must be in the future.', 'invalid_input')
        await must(
          tools.update('volunteer_status', targetId, {
            status: 'approved',
            identityConfirmed: true,
            qualificationType: str(params, 'qualificationType', { max: 80 }),
            licenseNumber: str(params, 'licenseNumber', { max: 40 }),
            licenseCheckedAt: dateParam(params, 'licenseCheckedAt'),
            clearanceCompletedAt: dateParam(params, 'clearanceCompletedAt'),
            clearanceExpiresAt,
            decisionReason: reason,
            vettedBy: userId,
            approvedBy: userId,
          }),
          'approve',
        )
      }
      await audit(tools, { actorId: userId, action: outcome === 'approved' ? 'approve' : 'reject', targetType: 'volunteer', targetId, fromState: current!.status, toState: outcome, reason })
      await notify(tools, {
        recipientId: targetId,
        kind: 'status_changed',
        title: outcome === 'approved' ? 'You’re approved. Pick a session on the board.' : 'Your application was not approved.',
        body: outcome === 'rejected' ? reason : '',
      })
      return ok({ userId: targetId, status: outcome })
    }),

  // ── M5 · Teachers post session requests ───────────────────────────────────
  createSessionRequest: ({ userId, params, tools }) =>
    run('createSessionRequest', async () => {
      await requireAppRole(tools, userId, 'teacher')
      // D9: the session is at the teacher's school — taken from their assignment, never from params.
      const assignment = await getData<{ schoolId?: string }>(tools, 'role_assignments', userId)
      const school = assignment?.schoolId ? await getData<School>(tools, 'schools', assignment.schoolId) : null
      if (!school) refuse('Your school isn’t set yet. Ask program staff to add it to your teacher access.', 'no_school')
      if (!school!.active) refuse(`${school!.name} isn’t taking new sessions right now.`, 'school_inactive')
      const grade = oneOf(params, 'grade', GRADES)
      const topic = oneOf(params, 'topic', TOPICS)
      const topicOther = topic === 'other' ? str(params, 'topicOther', { required: true, max: 60 }) : ''
      const sessionDate = dateParam(params, 'sessionDate', { required: true })!
      const timeBand = oneOf(params, 'timeBand', TIME_BANDS)
      const startTime = str(params, 'startTime', { max: 5 })
      if (startTime && !/^([01]\d|2[0-3]):[0-5]\d$/.test(startTime)) refuse('Start time must look like 10:15.', 'invalid_input')
      if (sessionStartSeconds(sessionDate, timeBand, startTime) <= nowSeconds()) refuse('The session must be in the future.', 'invalid_input')

      const created = await must(
        tools.create('session_requests', {
          teacherId: userId,
          grade,
          topic,
          topicOther,
          sessionDate,
          timeBand,
          expectedHeadcount: int(params, 'expectedHeadcount', { min: 1, max: 200 }),
          status: 'open',
          schoolId: assignment!.schoolId,
        }),
        'create request',
      )
      // Details are stored under the SESSION's id, so every action can find them with
      // tools.get('session_details', sessionId). (Caught by actions.test.ts.)
      await must(
        tools.create(
          'session_details',
          {
            sessionId: created.recordId,
            teacherId: userId,
            room: str(params, 'room', { max: 40 }),
            startTime,
            arrivalNote: str(params, 'arrivalNote', { max: 300 }),
            teacherNote: str(params, 'teacherNote', { max: 300 }),
            collaborators: [],
          },
          created.recordId,
        ),
        'create details',
      )
      await audit(tools, { actorId: userId, action: 'create_session', targetType: 'session', targetId: created.recordId, toState: 'open' })
      return ok({ sessionId: created.recordId })
    }),

  // ── Session readiness · teacher or staff fill in room, time, arrival notes ──
  updateSessionDetails: ({ userId, params, tools, env }) =>
    run('updateSessionDetails', async () => {
      const sessionId = str(params, 'sessionId', { required: true, max: 100 })
      const session = await getData<SessionRequest>(tools, 'session_requests', sessionId)
      if (!session) refuse('Session not found.', 'not_found')
      await requireSessionEditor(tools, userId, env.OWNER_USER_ID, session!)
      if (session!.status === 'cancelled' || session!.status === 'completed') refuse(`This session is ${session!.status}.`, 'stale_state')
      const startTime = str(params, 'startTime', { max: 5 })
      if (startTime && !/^([01]\d|2[0-3]):[0-5]\d$/.test(startTime)) refuse('Start time must look like 10:15.', 'invalid_input')
      if (sessionStartSeconds(session!.sessionDate, session!.timeBand, startTime) <= nowSeconds()) refuse('This session has already started.', 'in_past')
      const before = await getData<SessionDetails>(tools, 'session_details', sessionId)
      // Only items the volunteer actually asked for can be marked ready.
      const requested = new Set(before?.equipmentRequested ?? [])
      const ready = equipmentParam(params, 'equipmentReady').filter((e) => requested.has(e))
      const next = {
        room: str(params, 'room', { max: 40 }),
        startTime,
        arrivalNote: str(params, 'arrivalNote', { max: 300 }),
        teacherNote: str(params, 'teacherNote', { max: 300 }),
        classLabel: str(params, 'classLabel', { max: 80 }),
        studentCount: int(params, 'studentCount', { min: 1, max: 200 }),
      }
      const all = { ...next, equipmentReady: ready }
      if (before) await must(tools.update('session_details', sessionId, all), 'update details')
      else await must(tools.create('session_details', { sessionId, teacherId: session!.teacherId, collaborators: [], ...all }, sessionId), 'create details')
      const changed: string[] = (Object.keys(next) as (keyof typeof next)[]).filter((k) => (before?.[k] ?? (k === 'studentCount' ? null : '')) !== next[k])
      if (JSON.stringify([...(before?.equipmentReady ?? [])].sort()) !== JSON.stringify([...ready].sort())) changed.push('equipmentReady')
      if (changed.length) {
        await audit(tools, { actorId: userId, action: 'update_session_details', targetType: 'session', targetId: sessionId, toState: changed.join(',') })
        const claim = await activeClaimFor(tools, sessionId)
        if (claim) {
          await notify(tools, {
            recipientId: claim.data.volunteerId,
            kind: 'status_changed',
            title: `Session details updated: Grade ${session!.grade} · ${topicLabel(session!)}`,
            body: [
              next.startTime ? `Starts ${next.startTime}` : '',
              next.room ? `Room ${next.room}` : '',
              next.classLabel,
              next.studentCount ? `${next.studentCount} students` : '',
              ready.length ? `Ready: ${ready.length} of ${requested.size} items` : '',
              next.arrivalNote,
            ]
              .filter(Boolean)
              .join(' · '),
          })
        }
      }
      return ok({ sessionId, changed })
    }),

  // ── D11 · The volunteer tells the school what they need ───────────────────
  requestEquipment: ({ userId, params, tools }) =>
    run('requestEquipment', async () => {
      const sessionId = str(params, 'sessionId', { required: true, max: 100 })
      const claim = await activeClaimFor(tools, sessionId)
      if (!claim || claim.data.volunteerId !== userId) refuse('Only the booked volunteer can say what they need.', 'forbidden')
      const session = await getData<SessionRequest>(tools, 'session_requests', sessionId)
      if (!session || session.status === 'cancelled' || session.status === 'completed') refuse('This session can’t be changed.', 'stale_state')
      const items = equipmentParam(params, 'items')
      const other = str(params, 'other', { max: 200 })
      const details = await getData<SessionDetails>(tools, 'session_details', sessionId)
      // Items no longer requested drop out of "ready".
      const ready = (details?.equipmentReady ?? []).filter((e) => items.includes(e as Equipment))
      await must(tools.update('session_details', sessionId, { equipmentRequested: items, equipmentOther: other, equipmentReady: ready }), 'request equipment')
      await audit(tools, { actorId: userId, action: 'request_equipment', targetType: 'session', targetId: sessionId, toState: [...items, other ? 'other' : ''].filter(Boolean).join(',') })
      await notify(tools, {
        recipientId: session!.teacherId,
        kind: 'status_changed',
        title: `Your volunteer listed what they need: Grade ${session!.grade} · ${topicLabel(session!)}`,
        body: `${items.length} item${items.length === 1 ? '' : 's'}${other ? ` plus: ${other}` : ''}. Mark them ready in Session details.`,
      })
      return ok({ sessionId, items })
    }),

  // ── D11 · The program admin assigns each staff member to a school ─────────
  assignStaffSchool: ({ userId, params, tools, env }) =>
    run('assignStaffSchool', async () => {
      requireNonprofitAdmin(userId, env.OWNER_USER_ID)
      const targetId = str(params, 'userId', { required: true, max: 100 })
      if (!(await isStaff(tools, targetId, env.OWNER_USER_ID)) || isNonprofitAdmin(targetId, env.OWNER_USER_ID)) {
        refuse('Only program staff can be assigned to a school.', 'invalid_input')
      }
      const schoolId = str(params, 'schoolId', { required: true, max: 100 })
      const school = await getData<School>(tools, 'schools', schoolId)
      if (!school || !school.active) refuse('Choose an active school.', 'invalid_input')
      const before = await getData<{ schoolId?: string }>(tools, 'staff_schools', targetId)
      await must(tools.create('staff_schools', { userId: targetId, schoolId, assignedBy: userId }, targetId), 'assign staff school')
      await audit(tools, { actorId: userId, action: 'assign_staff_school', targetType: 'user', targetId, fromState: before?.schoolId ?? 'none', toState: schoolId })
      await notify(tools, { recipientId: targetId, kind: 'status_changed', title: `You’re now the staff contact for ${school!.name}.` })
      return ok({ userId: targetId, schoolId })
    }),

  // ── M7 + M8 · Claim a session, notify both sides ──────────────────────────
  claimSession: ({ userId, params, tools }) =>
    run('claimSession', async () => {
      // WHO: an approved volunteer with an unexpired clearance (M7-AC2). Identity from ctx only (AC4).
      const status = await statusOf(tools, userId)
      if (status?.status !== 'approved') refuse('Only approved volunteers can claim sessions.', 'not_approved')
      if (!((status!.clearanceExpiresAt ?? 0) > nowSeconds())) refuse('Your clearance has expired. Contact the program team.', 'clearance_expired')

      // WHETHER: the session exists, is open and still in the future.
      const sessionId = str(params, 'sessionId', { required: true, max: 100 })
      const session = await getData<SessionRequest>(tools, 'session_requests', sessionId)
      if (!session) refuse('Session not found.', 'not_found')
      if (session!.status !== 'open') refuse('Sorry, someone just claimed this one.', 'already_claimed')
      const details = await getData<SessionDetails>(tools, 'session_details', sessionId)
      const start = sessionStartSeconds(session!.sessionDate, session!.timeBand, details?.startTime)
      if (start <= nowSeconds()) refuse('This session has already started.', 'in_past')

      // The race gate: uniqueOn(activeSlot) lets exactly one active claim exist (M7-AC3).
      const claim = await tools.create('claims', {
        sessionId,
        volunteerId: userId,
        status: 'active',
        activeSlot: sessionId,
        confirmedAt: null,
        collaborators: [session!.teacherId],
      })
      if (!claim.success) refuse('Sorry, someone just claimed this one.', 'already_claimed')

      await must(tools.update('session_requests', sessionId, { status: 'claimed' }), 'mark claimed')
      const me = await getData<Profile>(tools, 'profiles', userId)
      const volunteerName = me ? `${me.displayName}${me.profession ? `, ${me.profession}` : ''}` : ''
      if (details) await must(tools.update('session_details', sessionId, { collaborators: [userId], volunteerName, equipmentRequested: [], equipmentReady: [], equipmentOther: '' }), 'share details')
      await audit(tools, { actorId: userId, action: 'claim', targetType: 'session', targetId: sessionId, fromState: 'open', toState: 'claimed' })

      const profile = await getData<Profile>(tools, 'profiles', userId)
      const label = `Grade ${session!.grade} · ${topicLabel(session!)}`
      const when = `${formatDate(session!.sessionDate)}, ${details?.startTime || session!.timeBand}`
      const school = session!.schoolId ? await getData<School>(tools, 'schools', session!.schoolId) : null
      const place = [school?.name, school?.address, details?.room ? `Room ${details.room}` : ''].filter(Boolean).join(', ')
      await notify(tools, {
        recipientId: userId,
        kind: 'claim_confirmed',
        title: `You’re booked: ${label}${school ? ` at ${school.name}` : ''}`,
        body: [when, place, details?.arrivalNote ?? ''].filter(Boolean).join(' · '),
        link: calendarLink({ title: `Career session: ${label}`, startSeconds: start, location: place || undefined }),
      })
      await notify(tools, {
        recipientId: session!.teacherId,
        kind: 'session_claimed',
        title: `Volunteer booked: ${label}`,
        body: `${profile?.displayName ?? 'A volunteer'}${profile?.profession ? `, ${profile.profession}` : ''} · ${when}`,
      })
      return ok({ claimId: (claim as { data: { recordId: string } }).data.recordId, sessionId })
    }),

  // ── SH5 · Volunteer confirms availability ─────────────────────────────────
  confirmClaim: ({ userId, params, tools }) =>
    run('confirmClaim', async () => {
      const sessionId = str(params, 'sessionId', { required: true, max: 100 })
      const claim = await activeClaimFor(tools, sessionId)
      if (!claim || claim.data.volunteerId !== userId) refuse('You don’t have an active claim on this session.', 'forbidden')
      const session = await getData<SessionRequest>(tools, 'session_requests', sessionId)
      if (session?.status !== 'claimed') refuse('This session is not awaiting confirmation.', 'stale_state')
      await must(tools.update('claims', claim!.recordId, { confirmedAt: nowSeconds() }), 'confirm')
      await must(tools.update('session_requests', sessionId, { status: 'confirmed' }), 'mark confirmed')
      await audit(tools, { actorId: userId, action: 'confirm', targetType: 'session', targetId: sessionId, fromState: 'claimed', toState: 'confirmed' })
      await notify(tools, { recipientId: session!.teacherId, kind: 'session_confirmed', title: `Volunteer confirmed: Grade ${session!.grade} · ${topicLabel(session!)}` })
      return ok({ sessionId })
    }),

  // ── SH6 · Withdraw (≥ 48 h) ───────────────────────────────────────────────
  withdrawClaim: ({ userId, params, tools }) =>
    run('withdrawClaim', async () => {
      const sessionId = str(params, 'sessionId', { required: true, max: 100 })
      const claim = await activeClaimFor(tools, sessionId)
      if (!claim || claim.data.volunteerId !== userId) refuse('You don’t have an active claim on this session.', 'forbidden')
      const session = await getData<SessionRequest>(tools, 'session_requests', sessionId)
      const details = await getData<SessionDetails>(tools, 'session_details', sessionId)
      if (!session || (session.status !== 'claimed' && session.status !== 'confirmed')) refuse('This session can’t be withdrawn from.', 'stale_state')
      const start = sessionStartSeconds(session!.sessionDate, session!.timeBand, details?.startTime)
      if (start - nowSeconds() < SELF_WITHDRAW_MIN_HOURS * 3600) {
        refuse(`Less than ${SELF_WITHDRAW_MIN_HOURS} hours to go. Contact the program team instead.`, 'too_late')
      }
      // Free the slot without deleting history (standing test 15).
      await must(
        tools.update('claims', claim!.recordId, { status: 'withdrawn', activeSlot: `withdrawn:${claim!.recordId}`, withdrawnAt: nowSeconds() }),
        'withdraw',
      )
      await must(tools.update('session_requests', sessionId, { status: 'open' }), 'reopen')
      if (details) await must(tools.update('session_details', sessionId, { collaborators: [], volunteerName: '', equipmentRequested: [], equipmentReady: [], equipmentOther: '' }), 'unshare details')
      await audit(tools, { actorId: userId, action: 'withdraw', targetType: 'session', targetId: sessionId, fromState: session!.status, toState: 'open' })
      await notify(tools, {
        recipientId: session!.teacherId,
        kind: 'session_withdrawn',
        title: `Volunteer withdrew: Grade ${session!.grade} · ${topicLabel(session!)}`,
        body: 'The session is back on the board for another volunteer.',
      })
      return ok({ sessionId })
    }),

  // ── SH6 · Late cancel / reschedule → staff ────────────────────────────────
  requestChange: ({ userId, params, tools }) =>
    run('requestChange', async () => {
      const sessionId = str(params, 'sessionId', { required: true, max: 100 })
      const kind = oneOf(params, 'kind', CHANGE_REQUEST_KINDS)
      const note = str(params, 'note', { max: 500 })
      const claim = await activeClaimFor(tools, sessionId)
      if (!claim || claim.data.volunteerId !== userId) refuse('You don’t have an active claim on this session.', 'forbidden')
      const session = await getData<SessionRequest>(tools, 'session_requests', sessionId)
      if (!session) refuse('Session not found.', 'not_found')
      const created = await must(
        tools.create('change_requests', {
          claimId: claim!.recordId,
          sessionId,
          volunteerId: userId,
          kind,
          note,
          status: 'open',
          collaborators: [session!.teacherId],
        }),
        'request change',
      )
      await audit(tools, { actorId: userId, action: 'request_change', targetType: 'session', targetId: sessionId, toState: kind, reason: note })
      await notify(tools, {
        recipientId: session!.teacherId,
        kind: 'change_requested',
        title: `Change requested: Grade ${session!.grade} · ${topicLabel(session!)}`,
        body: 'The program team is following up with you.',
      })
      return ok({ changeRequestId: created.recordId })
    }),

  // ── SH3 · Teacher or staff cancels a session ──────────────────────────────
  cancelSession: ({ userId, params, tools, env }) =>
    run('cancelSession', async () => {
      const sessionId = str(params, 'sessionId', { required: true, max: 100 })
      const reason = str(params, 'reason', { max: 300 })
      const session = await getData<SessionRequest>(tools, 'session_requests', sessionId)
      if (!session) refuse('Session not found.', 'not_found')
      await requireSessionEditor(tools, userId, env.OWNER_USER_ID, session!)
      if (session!.status === 'cancelled' || session!.status === 'completed') refuse(`This session is already ${session!.status}.`, 'stale_state')

      await must(tools.update('session_requests', sessionId, { status: 'cancelled' }), 'cancel')
      const claim = await activeClaimFor(tools, sessionId)
      if (claim) {
        await must(
          tools.update('claims', claim.recordId, { status: 'withdrawn', activeSlot: `withdrawn:${claim.recordId}`, withdrawnAt: nowSeconds() }),
          'release claim',
        )
        await notify(tools, {
          recipientId: claim.data.volunteerId,
          kind: 'session_cancelled',
          title: `Session cancelled: Grade ${session!.grade} · ${topicLabel(session!)}`,
          body: reason,
        })
      }
      await audit(tools, { actorId: userId, action: 'cancel', targetType: 'session', targetId: sessionId, fromState: session!.status, toState: 'cancelled', reason })
      return ok({ sessionId })
    }),
}

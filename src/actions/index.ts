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
import { TEST_DISTRICT, TEST_MARK, TEST_SCHOOLS, TEST_SESSIONS, testSessionDate, testTeacherName } from './test-data'
import { fetchUserFile, isFilePath, LICENSE_MAX_BYTES, LICENSE_MIMES, toBase64 } from '../server/user-files'

interface Profile extends Record<string, unknown> {
  userId: string
  displayName: string
  profession: string
  employer: string
  skills?: string
  yearsExperience?: number | null
  hobbies?: string
  phone?: string
  accessNeeds?: string
  licenseType?: string
  licenseNumber?: string
  licenseState?: string
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

/**
 * Book a volunteer onto a session — shared by claimSession (the volunteer) and
 * assignVolunteer (the program admin, D13). Same checks either way: the VOLUNTEER
 * must be approved with an unexpired clearance; the session open and in the future;
 * exactly one active claim (uniqueOn race gate). Copies the contact details the
 * teacher and volunteer need onto the private session_details row.
 */
async function bookSession(tools: Parameters<ActionHandler>[0]['tools'], volunteerId: string, sessionId: string, actorId: string): Promise<string> {
  const byAdmin = actorId !== volunteerId
  const status = await statusOf(tools, volunteerId)
  if (status?.status !== 'approved') refuse(byAdmin ? 'That volunteer isn’t approved.' : 'Only approved volunteers can claim sessions.', 'not_approved')
  if (!((status!.clearanceExpiresAt ?? 0) > nowSeconds())) {
    refuse(byAdmin ? 'That volunteer’s clearance has expired.' : 'Your clearance has expired. Contact the program team.', 'clearance_expired')
  }
  const session = await getData<SessionRequest>(tools, 'session_requests', sessionId)
  if (!session) refuse('Session not found.', 'not_found')
  if (session!.status !== 'open') refuse('Sorry, someone just claimed this one.', 'already_claimed')
  const details = await getData<SessionDetails>(tools, 'session_details', sessionId)
  const start = sessionStartSeconds(session!.sessionDate, session!.timeBand, details?.startTime)
  if (start <= nowSeconds()) refuse('This session has already started.', 'in_past')

  // The race gate: uniqueOn(activeSlot) lets exactly one active claim exist (M7-AC3).
  const claim = await tools.create('claims', {
    sessionId,
    volunteerId,
    status: 'active',
    activeSlot: sessionId,
    confirmedAt: null,
    collaborators: [session!.teacherId],
  })
  if (!claim.success) refuse('Sorry, someone just claimed this one.', 'already_claimed')
  await must(tools.update('session_requests', sessionId, { status: 'claimed' }), 'mark claimed')

  const profile = await getData<Profile>(tools, 'profiles', volunteerId)
  const volunteerUser = await getData<{ email?: string }>(tools, 'users', volunteerId)
  const teacherUser = await getData<{ email?: string; name?: string }>(tools, 'users', session!.teacherId)
  const volunteerName = profile ? `${profile.displayName}${profile.profession ? `, ${profile.profession}` : ''}` : ''
  if (details) {
    await must(
      tools.update('session_details', sessionId, {
        collaborators: [volunteerId],
        volunteerName,
        // D13: contact shared only with this booking's teacher (row is private to them, the volunteer and staff).
        volunteerEmail: volunteerUser?.email ?? '',
        volunteerPhone: profile?.phone ?? '',
        accessNeeds: profile?.accessNeeds ?? '',
        teacherEmail: teacherUser?.email ?? '',
        teacherName: teacherUser?.name ?? '',
        equipmentRequested: [],
        equipmentReady: [],
        equipmentOther: '',
        readyAt: null,
        proposedDate: null,
        proposedTimeBand: '',
        proposedBy: '',
        proposedNote: '',
      }),
      'share details',
    )
  }
  await audit(tools, { actorId, action: byAdmin ? 'assign_volunteer' : 'claim', targetType: 'session', targetId: sessionId, fromState: 'open', toState: `claimed by ${volunteerId}` })

  const label = `Grade ${session!.grade} · ${topicLabel(session!)}`
  const when = `${formatDate(session!.sessionDate)}, ${details?.startTime || session!.timeBand}`
  const school = session!.schoolId ? await getData<School>(tools, 'schools', session!.schoolId) : null
  const place = [school?.name, school?.address, details?.room ? `Room ${details.room}` : ''].filter(Boolean).join(', ')
  await notify(tools, {
    recipientId: volunteerId,
    kind: 'claim_confirmed',
    title: `${byAdmin ? 'The program booked you' : 'You’re booked'}: ${label}${school ? ` at ${school.name}` : ''}`,
    body: [when, place, teacherUser?.name ? `Teacher: ${teacherUser.name}` : '', byAdmin ? 'Please confirm you’re available in My sessions.' : details?.arrivalNote ?? '']
      .filter(Boolean)
      .join(' · '),
    link: calendarLink({ title: `Career session: ${label}`, startSeconds: start, location: place || undefined }),
  })
  await notify(tools, {
    recipientId: session!.teacherId,
    kind: 'session_claimed',
    title: `Volunteer booked: ${label}`,
    // D14: say there ARE access needs, never what they are, in a notification.
    body: `${profile?.displayName ?? 'A volunteer'}${profile?.profession ? `, ${profile.profession}` : ''} · ${when}.${profile?.accessNeeds ? ' They’ve noted access needs — see session details.' : ''} Contact them from your teacher desk.`,
  })
  return (claim as { data: { recordId: string } }).data.recordId
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

/**
 * Create or refresh a teacher invite (D10) and, if someone has already signed in with
 * that email, give them teacher access now. Shared by inviteTeacher and seedTestData.
 */
async function upsertInvite(
  tools: Parameters<ActionHandler>[0]['tools'],
  actorId: string,
  invite: { name: string; email: string; schoolId: string },
  schoolName: string,
): Promise<{ inviteId: string; accepted: boolean }> {
  const { name, email, schoolId } = invite
  // One invite per email: re-inviting updates the existing row (keeps history in the audit log).
  const existing = await tools.query<{ status: string }>('teacher_invites', { where: { email }, limit: 1 })
  const prior = existing.success ? existing.data.records[0] : undefined
  const data = { email, name, schoolId, invitedBy: actorId, status: 'pending', acceptedBy: '' }
  const inviteId = prior
    ? (await must(tools.update('teacher_invites', prior.recordId, data), 'update invite')).recordId
    : (await must(tools.create('teacher_invites', data), 'create invite')).recordId
  await audit(tools, { actorId, action: 'invite_teacher', targetType: 'invite', targetId: inviteId, toState: `pending@${schoolId}`, reason: name })

  // Already signed in with that email? Give access now instead of waiting.
  const users = await tools.query<{ email?: string }>('users', { where: { email }, limit: 1 })
  const match = users.success ? users.data.records[0] : undefined
  if (match) {
    await acceptInvite(tools, match.recordId, inviteId, { name, schoolId, invitedBy: actorId }, schoolName)
    return { inviteId, accepted: true }
  }
  return { inviteId, accepted: false }
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
      // D12: richer profile and self-reported license details.
      const extra = {
        skills: str(params, 'skills', { max: 300 }),
        yearsExperience: int(params, 'yearsExperience', { min: 0, max: 70 }),
        hobbies: str(params, 'hobbies', { max: 300 }),
        phone: str(params, 'phone', { max: 20 }),
        accessNeeds: str(params, 'accessNeeds', { max: 300 }),
        licenseType: str(params, 'licenseType', { max: 80 }),
        licenseNumber: str(params, 'licenseNumber', { max: 40 }),
        licenseState: str(params, 'licenseState', { max: 2 }).toUpperCase(),
      }
      if (extra.licenseState && !/^[A-Z]{2}$/.test(extra.licenseState)) refuse('License state must be a two-letter code, like CA.', 'invalid_input')
      if (extra.phone && !/^[0-9+()\-.\s]{7,20}$/.test(extra.phone)) refuse('Phone number can use digits, spaces and + ( ) - only.', 'invalid_input')

      const before = await getData<Profile>(tools, 'profiles', userId)
      await must(tools.create('profiles', { userId, displayName, profession, employer, ...extra }, userId), 'save profile')

      const status = await statusOf(tools, userId)
      if (!status) {
        await must(tools.create('volunteer_status', { userId, status: 'applied' }, userId), 'create status')
        await audit(tools, { actorId: userId, action: 'apply', targetType: 'volunteer', targetId: userId, toState: 'applied' })
        return ok({ status: 'applied' })
      }

      // M1-AC4: changing what was vetted sends the volunteer back for review.
      const changed =
        before &&
        (before.profession !== profession ||
          before.employer !== employer ||
          (before.licenseType ?? '') !== extra.licenseType ||
          (before.licenseNumber ?? '') !== extra.licenseNumber ||
          (before.licenseState ?? '') !== extra.licenseState)
      if (changed && status.status !== 'applied') {
        await must(tools.update('volunteer_status', userId, { status: 'applied', decisionReason: 'Profile changed after approval' }), 'reset status')
        await audit(tools, {
          actorId: userId,
          action: 'status_reset',
          targetType: 'volunteer',
          targetId: userId,
          fromState: status.status,
          toState: 'applied',
          reason: 'Profession, employer or license changed after approval',
        })
        return ok({ status: 'applied', reset: true })
      }
      return ok({ status: status.status })
    }),

  // ── D16 · Test data for manual testing: San Diego Unified schools ─────────
  /**
   * Nonprofit admin only. Safe to run more than once:
   *   1. adds the five TEST_SCHOOLS that don't exist yet (by name);
   *   2. invites each email in `teacherEmails` to one of those schools, in order;
   *   3. gives every test teacher who has signed in (invite accepted) and has no
   *      sessions yet two open sample sessions marked "[Test data]".
   * Run it once with the emails, sign in as each test teacher, then run it again.
   */
  seedTestData: ({ userId, params, tools, env }) =>
    run('seedTestData', async () => {
      requireNonprofitAdmin(userId, env.OWNER_USER_ID)
      const raw = Array.isArray(params.teacherEmails) ? params.teacherEmails : []
      if (raw.length > TEST_SCHOOLS.length) refuse(`Up to ${TEST_SCHOOLS.length} test teachers, one per school.`, 'invalid_input')
      const emails = raw.map((e) => (typeof e === 'string' ? e.trim().toLowerCase() : '')).filter(Boolean)
      for (const e of emails) if (e.length > 120 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) refuse(`“${e}” isn’t a valid email address.`, 'invalid_input')
      if (new Set(emails).size !== emails.length) refuse('Use a different email for each test teacher.', 'invalid_input')

      // 1. Schools
      const schools: { id: string; name: string; active: boolean }[] = []
      let schoolsAdded = 0
      for (const s of TEST_SCHOOLS) {
        const found = await tools.query<School>('schools', { where: { name: s.name }, limit: 1 })
        const row = found.success ? found.data.records[0] : undefined
        if (row) {
          schools.push({ id: row.recordId, name: s.name, active: !!row.data.active })
          continue
        }
        const created = await must(tools.create('schools', { name: s.name, district: TEST_DISTRICT, city: 'San Diego', address: s.address, active: true, createdByUser: userId }), 'create school')
        await audit(tools, { actorId: userId, action: 'create_school', targetType: 'school', targetId: created.recordId, toState: s.name, reason: TEST_MARK })
        schools.push({ id: created.recordId, name: s.name, active: true })
        schoolsAdded++
      }

      // 2. Teacher invites, one school each
      let invited = 0
      for (const [i, email] of emails.entries()) {
        const school = schools[i]
        if (!school.active) refuse(`${school.name} is inactive. Reactivate it under Schools first.`, 'invalid_input')
        const prior = await tools.query<{ status: string; schoolId: string }>('teacher_invites', { where: { email }, limit: 1 })
        const p = prior.success ? prior.data.records[0] : undefined
        if (p && p.data.status === 'accepted') continue // already a teacher; leave them where they are
        await upsertInvite(tools, userId, { name: testTeacherName(school.name, i + 1), email, schoolId: school.id }, school.name)
        invited++
      }

      // 3. Sample sessions for test teachers who have signed in
      let sessionsAdded = 0
      const nowMs = Date.now()
      for (const school of schools) {
        if (!school.active) continue
        const inv = await tools.query<{ status: string; acceptedBy?: string; schoolId: string }>('teacher_invites', { where: { schoolId: school.id, status: 'accepted' }, limit: 20 })
        for (const r of inv.success ? inv.data.records : []) {
          const teacherId = r.data.acceptedBy
          if (!teacherId || (await appRoleOf(tools, teacherId)) !== 'teacher') continue
          const mine = await tools.query('session_requests', { where: { teacherId }, limit: 1 })
          if (mine.success && mine.data.records.length > 0) continue
          for (const t of TEST_SESSIONS) {
            const sessionDate = dateParam({ d: testSessionDate(nowMs, t.daysOut) }, 'd', { required: true })!
            const created = await must(
              tools.create('session_requests', { teacherId, grade: t.grade, topic: t.topic, topicOther: '', sessionDate, timeBand: t.timeBand, expectedHeadcount: t.studentCount, status: 'open', schoolId: school.id }),
              'create test session',
            )
            await must(
              tools.create(
                'session_details',
                {
                  sessionId: created.recordId,
                  teacherId,
                  room: t.room,
                  startTime: t.startTime,
                  arrivalNote: 'Check in at the front office with photo ID.',
                  teacherNote: `${TEST_MARK} Sample session for manual testing.`,
                  classLabel: t.classLabel,
                  studentCount: t.studentCount,
                  collaborators: [],
                },
                created.recordId,
              ),
              'create test details',
            )
            await audit(tools, { actorId: userId, action: 'create_session', targetType: 'session', targetId: created.recordId, toState: 'open', reason: TEST_MARK })
            sessionsAdded++
          }
        }
      }

      await audit(tools, { actorId: userId, action: 'seed_test_data', targetType: 'app', targetId: 'test-data', toState: `schools+${schoolsAdded} invites+${invited} sessions+${sessionsAdded}` })
      return ok({ schoolsAdded, invited, sessionsAdded, schools: schools.map((s) => s.name) })
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

      return ok(await upsertInvite(tools, userId, { name, email, schoolId }, school!.name))
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

  // ── D12 · License documents: volunteer uploads, approvers open ────────────
  addLicenseFile: ({ userId, params, tools }) =>
    run('addLicenseFile', async () => {
      const path = str(params, 'path', { required: true, max: 400 })
      if (!isFilePath(path)) refuse('That file location isn’t valid.', 'invalid_input')
      const name = str(params, 'name', { required: true, max: 120 })
      const mime = oneOf(params, 'mime', LICENSE_MIMES)
      const size = int(params, 'size', { required: true, min: 1, max: LICENSE_MAX_BYTES })!
      const mine = await tools.query<{ removed?: boolean }>('license_files', { where: { volunteerId: userId }, limit: 50 })
      const live = mine.success ? mine.data.records.filter((r) => !r.data.removed).length : 0
      if (live >= 5) refuse('You can keep up to 5 license files. Remove one first.', 'too_many')
      // volunteerId is the caller (from the token). The file is fetched later as this
      // volunteer, so a row can only ever point at their own private files.
      const created = await must(tools.create('license_files', { volunteerId: userId, path, name, mime, size, removed: false }), 'add license file')
      await audit(tools, { actorId: userId, action: 'add_license_file', targetType: 'volunteer', targetId: userId, toState: name })
      return ok({ fileId: created.recordId })
    }),

  removeLicenseFile: ({ userId, params, tools }) =>
    run('removeLicenseFile', async () => {
      const fileId = str(params, 'fileId', { required: true, max: 100 })
      const row = await getData<{ volunteerId: string; removed?: boolean; name: string }>(tools, 'license_files', fileId)
      if (!row || row.volunteerId !== userId) refuse('File not found.', 'not_found')
      if (row!.removed) return ok({ fileId })
      await must(tools.update('license_files', fileId, { removed: true }), 'remove license file')
      await audit(tools, { actorId: userId, action: 'remove_license_file', targetType: 'volunteer', targetId: userId, fromState: row!.name })
      return ok({ fileId })
    }),

  /** Return a license file's bytes to the volunteer themselves or to someone who may decide on volunteers. */
  openLicenseFile: ({ userId, params, tools, env }) =>
    run('openLicenseFile', async () => {
      const fileId = str(params, 'fileId', { required: true, max: 100 })
      const row = await getData<{ volunteerId: string; path: string; name: string; mime: string; removed?: boolean }>(tools, 'license_files', fileId)
      if (!row || row.removed) refuse('File not found.', 'not_found')
      if (row!.volunteerId !== userId) await requireCanVet(tools, userId, env.OWNER_USER_ID)
      const file = await fetchUserFile(env as never, row!.volunteerId, row!.path)
      if (!file) refuse('Couldn’t open that file. Ask the volunteer to upload it again.', 'fetch_failed')
      if (row!.volunteerId !== userId) {
        await audit(tools, { actorId: userId, action: 'view_license_file', targetType: 'volunteer', targetId: row!.volunteerId, toState: row!.name })
      }
      return ok({ name: row!.name, mime: row!.mime, base64: toBase64(file!.bytes) })
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
      // D14: access needs for this visit (sent with the checklist; omit to leave unchanged).
      const access = params.accessNeeds === undefined ? undefined : str(params, 'accessNeeds', { max: 300 })
      const details = await getData<SessionDetails>(tools, 'session_details', sessionId)
      // Items no longer requested drop out of "ready".
      const ready = (details?.equipmentReady ?? []).filter((e) => items.includes(e as Equipment))
      await must(
        tools.update('session_details', sessionId, { equipmentRequested: items, equipmentOther: other, equipmentReady: ready, ...(access === undefined ? {} : { accessNeeds: access }) }),
        'request equipment',
      )
      await audit(tools, { actorId: userId, action: 'request_equipment', targetType: 'session', targetId: sessionId, toState: [...items, other ? 'other' : ''].filter(Boolean).join(',') })
      await notify(tools, {
        recipientId: session!.teacherId,
        kind: 'status_changed',
        title: `Your volunteer listed what they need: Grade ${session!.grade} · ${topicLabel(session!)}`,
        body: `${items.length} item${items.length === 1 ? '' : 's'}${other ? ` plus: ${other}` : ''}.${access ? ' Access needs noted.' : ''} Mark them ready in Session details.`,
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
      const sessionId = str(params, 'sessionId', { required: true, max: 100 })
      const claimId = await bookSession(tools, userId, sessionId, userId)
      return ok({ claimId, sessionId })
    }),

  // ── D13 · The teacher confirms the class is ready for the session date ───
  markClassReady: ({ userId, params, tools, env }) =>
    run('markClassReady', async () => {
      const sessionId = str(params, 'sessionId', { required: true, max: 100 })
      const session = await getData<SessionRequest>(tools, 'session_requests', sessionId)
      if (!session) refuse('Session not found.', 'not_found')
      await requireSessionEditor(tools, userId, env.OWNER_USER_ID, session!)
      if (session!.status !== 'claimed' && session!.status !== 'confirmed') refuse('Book a volunteer before marking the class ready.', 'stale_state')
      const claim = await activeClaimFor(tools, sessionId)
      if (!claim) refuse('No volunteer is booked.', 'stale_state')
      const details = await getData<SessionDetails>(tools, 'session_details', sessionId)
      await must(tools.update('session_details', sessionId, { readyAt: nowSeconds() }), 'mark ready')
      await audit(tools, { actorId: userId, action: 'class_ready', targetType: 'session', targetId: sessionId, toState: 'ready' })
      const note = str(params, 'note', { max: 300 })
      await notify(tools, {
        recipientId: claim!.data.volunteerId,
        kind: 'status_changed',
        title: `Your class is ready: ${formatDate(session!.sessionDate)}, ${details?.startTime || session!.timeBand}`,
        body: [
          `Grade ${session!.grade} · ${topicLabel(session!)}`,
          details?.room ? `Room ${details.room}` : '',
          details?.studentCount ? `${details.studentCount} students` : '',
          note,
        ]
          .filter(Boolean)
          .join(' · '),
      })
      return ok({ sessionId })
    }),

  // ── D13 · Either side proposes a different date ───────────────────────────
  proposeNewDate: ({ userId, params, tools, env }) =>
    run('proposeNewDate', async () => {
      const sessionId = str(params, 'sessionId', { required: true, max: 100 })
      const session = await getData<SessionRequest>(tools, 'session_requests', sessionId)
      if (!session) refuse('Session not found.', 'not_found')
      if (session!.status !== 'claimed' && session!.status !== 'confirmed') refuse('Only a booked session can be moved.', 'stale_state')
      const claim = await activeClaimFor(tools, sessionId)
      if (!claim) refuse('No volunteer is booked.', 'stale_state')
      const isVolunteer = claim!.data.volunteerId === userId
      if (!isVolunteer) await requireSessionEditor(tools, userId, env.OWNER_USER_ID, session!)
      const date = dateParam(params, 'date', { required: true })!
      const timeBand = oneOf(params, 'timeBand', TIME_BANDS)
      if (sessionStartSeconds(date, timeBand) <= nowSeconds()) refuse('Pick a date in the future.', 'invalid_input')
      if (date === session!.sessionDate && timeBand === session!.timeBand) refuse('That’s the current date.', 'invalid_input')
      const note = str(params, 'note', { max: 300 })
      await must(tools.update('session_details', sessionId, { proposedDate: date, proposedTimeBand: timeBand, proposedBy: userId, proposedNote: note }), 'propose')
      await audit(tools, { actorId: userId, action: 'propose_date', targetType: 'session', targetId: sessionId, fromState: formatDate(session!.sessionDate), toState: `${formatDate(date)} ${timeBand}`, reason: note })
      await notify(tools, {
        recipientId: isVolunteer ? session!.teacherId : claim!.data.volunteerId,
        kind: 'change_requested',
        title: `New date proposed: ${formatDate(date)} (${timeBand}) for Grade ${session!.grade} · ${topicLabel(session!)}`,
        body: `${isVolunteer ? 'Your volunteer' : 'The teacher'} proposed moving it from ${formatDate(session!.sessionDate)}. ${note} Accept or decline in the app.`.trim(),
      })
      return ok({ sessionId })
    }),

  respondToProposal: ({ userId, params, tools, env }) =>
    run('respondToProposal', async () => {
      const sessionId = str(params, 'sessionId', { required: true, max: 100 })
      const accept = oneOf(params, 'answer', ['accept', 'decline'] as const) === 'accept'
      const session = await getData<SessionRequest>(tools, 'session_requests', sessionId)
      if (!session) refuse('Session not found.', 'not_found')
      const details = await getData<SessionDetails & { proposedDate?: number | null; proposedTimeBand?: string; proposedBy?: string }>(tools, 'session_details', sessionId)
      if (!details?.proposedDate || !details.proposedBy) refuse('There’s no proposed date to answer.', 'stale_state')
      const claim = await activeClaimFor(tools, sessionId)
      if (!claim) refuse('No volunteer is booked.', 'stale_state')
      // The OTHER side answers: a volunteer's proposal is answered by the teacher side, and vice versa.
      const proposedByVolunteer = details!.proposedBy === claim!.data.volunteerId
      if (proposedByVolunteer) await requireSessionEditor(tools, userId, env.OWNER_USER_ID, session!)
      else if (claim!.data.volunteerId !== userId) refuse('Only the booked volunteer can answer the teacher’s proposal.', 'forbidden')
      if (details!.proposedBy === userId) refuse('You can’t answer your own proposal.', 'forbidden')

      const clear = { proposedDate: null, proposedTimeBand: '', proposedBy: '', proposedNote: '' }
      if (accept) {
        const date = details!.proposedDate!
        const band = (details!.proposedTimeBand || session!.timeBand) as TimeBand
        if (sessionStartSeconds(date, band) <= nowSeconds()) refuse('That proposed date has passed. Propose a new one.', 'in_past')
        await must(tools.update('session_requests', sessionId, { sessionDate: date, timeBand: band, status: 'confirmed' }), 'move session')
        // Both sides agreed to the new date: the volunteer is available; the class needs re-confirming.
        await must(tools.update('claims', claim!.recordId, { confirmedAt: nowSeconds() }), 'confirm')
        await must(tools.update('session_details', sessionId, { ...clear, readyAt: null, startTime: '' }), 'apply proposal')
      } else {
        await must(tools.update('session_details', sessionId, clear), 'decline proposal')
      }
      await audit(tools, { actorId: userId, action: accept ? 'accept_date' : 'decline_date', targetType: 'session', targetId: sessionId, toState: formatDate(details!.proposedDate!) })
      await notify(tools, {
        recipientId: details!.proposedBy!,
        kind: 'status_changed',
        title: accept ? `New date agreed: ${formatDate(details!.proposedDate!)}` : `Proposed date declined: ${formatDate(details!.proposedDate!)}`,
        body: `Grade ${session!.grade} · ${topicLabel(session!)}${accept ? '' : ` stays on ${formatDate(session!.sessionDate)}.`}`,
      })
      return ok({ sessionId, accepted: accept })
    }),

  // ── D13 · The program admin books an approved volunteer onto a session ───
  assignVolunteer: ({ userId, params, tools, env }) =>
    run('assignVolunteer', async () => {
      requireNonprofitAdmin(userId, env.OWNER_USER_ID)
      const sessionId = str(params, 'sessionId', { required: true, max: 100 })
      const volunteerId = str(params, 'volunteerId', { required: true, max: 100 })
      const claimId = await bookSession(tools, volunteerId, sessionId, userId)
      return ok({ claimId, sessionId })
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
      if (details) await must(tools.update('session_details', sessionId, { collaborators: [], volunteerName: '', volunteerEmail: '', volunteerPhone: '', accessNeeds: '', equipmentRequested: [], equipmentReady: [], equipmentOther: '', readyAt: null, proposedDate: null, proposedTimeBand: '', proposedBy: '', proposedNote: '' }), 'unshare details')
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
        // Stop sharing the private details (room, contacts) with the released volunteer.
        if (await getData(tools, 'session_details', sessionId)) {
          await must(tools.update('session_details', sessionId, { collaborators: [], volunteerEmail: '', volunteerPhone: '', accessNeeds: '', proposedDate: null, proposedBy: '' }), 'unshare details')
        }
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

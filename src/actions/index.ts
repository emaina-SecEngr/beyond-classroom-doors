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
interface SessionRequest extends Record<string, unknown> {
  teacherId: string
  grade: string
  topic: string
  topicOther: string
  sessionDate: number
  timeBand: TimeBand
  expectedHeadcount: number | null
  status: SessionStatus
}
interface SessionDetails extends Record<string, unknown> {
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

  // ── M4 · Staff assign app roles ───────────────────────────────────────────
  assignRole: ({ userId, params, tools, env }) =>
    run('assignRole', async () => {
      await requireStaff(tools, userId, env.OWNER_USER_ID)
      const targetId = str(params, 'userId', { required: true, max: 100 })
      const role = oneOf(params, 'role', APP_ROLES)
      // R7: the board seat (second key) is the nonprofit admin's call; staff assign teachers.
      if (role === 'board_member') requireNonprofitAdmin(userId, env.OWNER_USER_ID)
      const target = await getData(tools, 'users', targetId)
      if (!target) refuse('That user has not signed in yet.', 'not_found')
      const previous = await appRoleOf(tools, targetId)
      await must(tools.create('role_assignments', { userId: targetId, role, assignedBy: userId }, targetId), 'assign role')
      await audit(tools, { actorId: userId, action: 'assign_role', targetType: 'user', targetId, fromState: previous ?? 'none', toState: role })
      await notify(tools, { recipientId: targetId, kind: 'status_changed', title: `You now have ${role === 'teacher' ? 'teacher' : 'board approver'} access.` })
      return ok({ userId: targetId, role })
    }),

  removeRole: ({ userId, params, tools, env }) =>
    run('removeRole', async () => {
      await requireStaff(tools, userId, env.OWNER_USER_ID)
      const targetId = str(params, 'userId', { required: true, max: 100 })
      const previous = await appRoleOf(tools, targetId)
      if (!previous) refuse('That user has no app role.', 'not_found')
      if (previous === 'board_member') requireNonprofitAdmin(userId, env.OWNER_USER_ID)
      await must(tools.remove('role_assignments', targetId), 'remove role')
      await audit(tools, { actorId: userId, action: 'remove_role', targetType: 'user', targetId, fromState: previous ?? '', toState: 'none' })
      return ok({ userId: targetId })
    }),

  // ── M2 · The nonprofit admin vets volunteers (first key, R7) ──────────────
  vetVolunteer: ({ userId, params, tools, env }) =>
    run('vetVolunteer', async () => {
      // R7: the nonprofit admin vets; staff only while the admin has asked them to help.
      await requireCanVet(tools, userId, env.OWNER_USER_ID)
      const targetId = str(params, 'userId', { required: true, max: 100 })
      const outcome = oneOf(params, 'outcome', ['vetted', 'rejected'] as const)
      const reason = str(params, 'reason', { max: 500 })

      const current = await statusOf(tools, targetId)
      if (!current) refuse('No application found for that volunteer.', 'not_found')
      // M2-AC4: stale-click protection — only an open application can be decided.
      if (current!.status !== 'applied' && current!.status !== 'renewal_pending') {
        refuse(`This application is already ${current!.status}. Refresh and try again.`, 'stale_state')
      }

      if (outcome === 'rejected') {
        if (!reason) refuse('A reason is required to reject.', 'invalid_input')
        await must(tools.update('volunteer_status', targetId, { status: 'rejected', decisionReason: reason, vettedBy: userId }), 'reject')
      } else {
        if (!bool(params, 'identityConfirmed')) refuse('Confirm identity before vetting.', 'invalid_input')
        const clearanceExpiresAt = dateParam(params, 'clearanceExpiresAt', { required: true })!
        if (clearanceExpiresAt <= nowSeconds()) refuse('Clearance expiry must be in the future.', 'invalid_input')
        await must(
          tools.update('volunteer_status', targetId, {
            status: 'vetted',
            identityConfirmed: true,
            qualificationType: str(params, 'qualificationType', { max: 80 }),
            licenseNumber: str(params, 'licenseNumber', { max: 40 }),
            licenseCheckedAt: dateParam(params, 'licenseCheckedAt'),
            clearanceCompletedAt: dateParam(params, 'clearanceCompletedAt'),
            clearanceExpiresAt,
            decisionReason: reason,
            vettedBy: userId,
          }),
          'vet',
        )
      }
      await audit(tools, { actorId: userId, action: 'vet', targetType: 'volunteer', targetId, fromState: current!.status, toState: outcome, reason })
      await notify(tools, {
        recipientId: targetId,
        kind: 'status_changed',
        title: outcome === 'vetted' ? 'Your vetting is complete. The board reviews next.' : 'Your application was not approved.',
        body: outcome === 'rejected' ? reason : '',
      })
      return ok({ userId: targetId, status: outcome })
    }),

  // ── M3 · A board member approves (second key, decision D3a) ───────────────
  listVettedVolunteers: ({ userId, tools }) =>
    run('listVettedVolunteers', async () => {
      await requireAppRole(tools, userId, 'board_member')
      const r = await tools.query<Record<string, unknown>>('volunteer_status', { where: { status: 'vetted' }, limit: 100 })
      if (!r.success) refuse('Could not load volunteers.', 'internal_error')
      const out = []
      for (const rec of r.success ? r.data.records : []) {
        const s = rec.data
        const p = await getData<Profile>(tools, 'profiles', String(s.userId))
        // Vetting SUMMARY only — no raw records, no emails (M3-AC1).
        out.push({
          userId: s.userId,
          displayName: p?.displayName ?? 'Unknown',
          profession: p?.profession ?? '',
          employer: p?.employer ?? '',
          qualificationType: s.qualificationType ?? '',
          clearanceExpiresAt: s.clearanceExpiresAt ?? null,
        })
      }
      return ok({ volunteers: out })
    }),

  approveVolunteer: ({ userId, params, tools, env }) =>
    run('approveVolunteer', async () => {
      await requireAppRole(tools, userId, 'board_member')
      // Separation of duties (M3-AC3): the staff key and the board key must be different people.
      if (await isStaff(tools, userId, env.OWNER_USER_ID)) refuse('Staff cannot give the board approval.', 'forbidden')
      const targetId = str(params, 'userId', { required: true, max: 100 })
      const outcome = oneOf(params, 'outcome', ['approved', 'declined'] as const)
      const reason = str(params, 'reason', { max: 500 })

      const current = await statusOf(tools, targetId)
      if (!current) refuse('No application found for that volunteer.', 'not_found')
      if (current!.status !== 'vetted') refuse(`This volunteer is ${current!.status}, not awaiting board approval.`, 'stale_state')
      if (outcome === 'declined' && !reason) refuse('A reason is required to decline.', 'invalid_input')
      if (outcome === 'approved' && !((current!.clearanceExpiresAt ?? 0) > nowSeconds())) {
        refuse('This volunteer’s clearance has expired.', 'clearance_expired')
      }
      await must(tools.update('volunteer_status', targetId, { status: outcome, decisionReason: reason, approvedBy: userId }), 'approve')
      await audit(tools, { actorId: userId, action: 'approve', targetType: 'volunteer', targetId, fromState: 'vetted', toState: outcome, reason })
      await notify(tools, {
        recipientId: targetId,
        kind: 'status_changed',
        title: outcome === 'approved' ? 'You’re approved. Pick a session on the board.' : 'The board did not approve your application.',
        body: outcome === 'declined' ? reason : '',
      })
      return ok({ userId: targetId, status: outcome })
    }),

  // ── M5 · Teachers post session requests ───────────────────────────────────
  createSessionRequest: ({ userId, params, tools }) =>
    run('createSessionRequest', async () => {
      await requireAppRole(tools, userId, 'teacher')
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
      const owner = session!.teacherId === userId && (await appRoleOf(tools, userId)) === 'teacher'
      if (!owner && !(await isStaff(tools, userId, env.OWNER_USER_ID))) refuse('Only the session’s teacher or program staff can edit it.', 'forbidden')
      if (session!.status === 'cancelled' || session!.status === 'completed') refuse(`This session is ${session!.status}.`, 'stale_state')
      const startTime = str(params, 'startTime', { max: 5 })
      if (startTime && !/^([01]\d|2[0-3]):[0-5]\d$/.test(startTime)) refuse('Start time must look like 10:15.', 'invalid_input')
      if (sessionStartSeconds(session!.sessionDate, session!.timeBand, startTime) <= nowSeconds()) refuse('This session has already started.', 'in_past')
      const before = await getData<SessionDetails>(tools, 'session_details', sessionId)
      const next = {
        room: str(params, 'room', { max: 40 }),
        startTime,
        arrivalNote: str(params, 'arrivalNote', { max: 300 }),
        teacherNote: str(params, 'teacherNote', { max: 300 }),
      }
      if (before) await must(tools.update('session_details', sessionId, next), 'update details')
      else await must(tools.create('session_details', { sessionId, teacherId: session!.teacherId, collaborators: [], ...next }, sessionId), 'create details')
      const changed = (Object.keys(next) as (keyof typeof next)[]).filter((k) => (before?.[k] ?? '') !== next[k])
      if (changed.length) {
        await audit(tools, { actorId: userId, action: 'update_session_details', targetType: 'session', targetId: sessionId, toState: changed.join(',') })
        const claim = await activeClaimFor(tools, sessionId)
        if (claim) {
          await notify(tools, {
            recipientId: claim.data.volunteerId,
            kind: 'status_changed',
            title: `Session details updated: Grade ${session!.grade} · ${topicLabel(session!)}`,
            body: [next.startTime ? `Starts ${next.startTime}` : '', next.room ? `Room ${next.room}` : '', next.arrivalNote].filter(Boolean).join(' · '),
          })
        }
      }
      return ok({ sessionId, changed })
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
      if (details) await must(tools.update('session_details', sessionId, { collaborators: [userId] }), 'share details')
      await audit(tools, { actorId: userId, action: 'claim', targetType: 'session', targetId: sessionId, fromState: 'open', toState: 'claimed' })

      const profile = await getData<Profile>(tools, 'profiles', userId)
      const label = `Grade ${session!.grade} · ${topicLabel(session!)}`
      const when = `${formatDate(session!.sessionDate)}, ${details?.startTime || session!.timeBand}`
      await notify(tools, {
        recipientId: userId,
        kind: 'claim_confirmed',
        title: `You’re booked: ${label}`,
        body: [when, details?.room ? `Room ${details.room}` : '', details?.arrivalNote ?? ''].filter(Boolean).join(' · '),
        link: calendarLink({ title: `Career session: ${label}`, startSeconds: start, location: details?.room ? `Room ${details.room}` : undefined }),
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
      if (details) await must(tools.update('session_details', sessionId, { collaborators: [] }), 'unshare details')
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
      const owner = session!.teacherId === userId && (await appRoleOf(tools, userId)) === 'teacher'
      if (!owner && !(await isStaff(tools, userId, env.OWNER_USER_ID))) refuse('Only the session’s teacher or program staff can cancel it.', 'forbidden')
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

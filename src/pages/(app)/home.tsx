/* home pattern: product-preview-first — the live session board is the home; signed-out visitors see a labeled example of it. */
/**
 * The session board (M6, M7).
 *
 * Signed out: a clearly labeled example board, with sign-in.
 * Signed in: the live board of open, upcoming sessions. Approved volunteers can
 * claim; everyone else sees why they can't yet. Teachers and staff
 * get a link to their desk.
 *
 * The board shows only what a request contains — grade, topic, date, time band,
 * class size. Room, exact time and arrival notes are shared after a claim.
 */
import { useEffect, useMemo, useState } from 'react'
import { Link, Navigate, useSearchParams } from 'react-router-dom'
import { AuthOverlay, useQuery } from 'deepspace'
import { Badge, Button } from '@/components/ui'
import { Loading, Page } from '../../components/Page'
import { BoardList, OpenSessions, type BoardItem } from '../../components/OpenSessions'
import { callAction } from '../../lib/actions'
import { formatSessionDate, todaySeconds, topicText, VOLUNTEER_STATUS_LABELS } from '../../lib/labels'
import { useMe, type Me } from '../../lib/me'
import { ADMIN_LANDED_KEY, useAccess } from '../../components/admin/shared'
import { useSchools } from '../../lib/schools'
import type { TimeBand } from '../../schemas/shared'

interface SessionRow {
  teacherId: string
  grade: string
  topic: string
  topicOther: string
  sessionDate: number
  timeBand: TimeBand
  expectedHeadcount: number | null
  status: string
  schoolId?: string
}

type Door = 'volunteer' | 'teacher' | 'staff'
const DOORS: Door[] = ['volunteer', 'teacher', 'staff']
const DOOR_HINT: Record<Door, string> = {
  volunteer: 'Volunteers: sign in, then fill in your profile to apply. New here? It takes two minutes.',
  teacher: 'Teachers: sign in with the school email the program invited.',
  staff: 'Program staff: sign in with the account the program admin gave access to.',
}

export default function HomePage() {
  const me = useMe()
  const [params] = useSearchParams()
  const asParam = params.get('as')
  const door = DOORS.includes(asParam as Door) ? (asParam as Door) : null
  if (!me.ready) return <Loading />
  if (!me.signedIn) return <SignedOutBoard door={door} />
  // D19: the link someone used is only a hint. Where they go — and what they can do —
  // comes from their real role. A "wrong door" gets a note, never extra access.
  const actual: Door = me.isStaff ? 'staff' : me.appRole === 'teacher' ? 'teacher' : 'volunteer'
  if (door && door !== actual) return <WrongDoor door={door} actual={actual} />
  if (door === 'teacher') return <Navigate to="/my-volunteers" replace />
  // Volunteers don't use the Program board: their home is My sessions (D15).
  if (actual === 'volunteer') return <Navigate to="/my-sessions" replace />
  return me.isStaff ? <StaffHome me={me} /> : <LiveBoard me={me} />
}

const ACTUAL_HOME: Record<Door, { to: string; label: string; who: string }> = {
  volunteer: { to: '/my-sessions', label: 'Go to My sessions', who: 'a volunteer' },
  teacher: { to: '/my-volunteers', label: 'Go to My volunteers', who: 'a teacher' },
  staff: { to: '/home', label: 'Go to the Program board', who: 'program staff' },
}

function WrongDoor({ door, actual }: { door: Door; actual: Door }) {
  const why: Record<Door, string> = {
    teacher: 'You don’t have teacher access yet. The program admin invites teachers by their school email; ask them to add you, then sign in with that email.',
    staff: 'This account isn’t program staff. Only the program admin can give staff access.',
    volunteer: 'This account has a teacher or staff role, so it isn’t set up for volunteering. Use a separate account to volunteer.',
  }
  const home = ACTUAL_HOME[actual]
  return (
    <Page title="You’re signed in" intro={`You’re signed in as ${home.who}.`}>
      <div role="status" className="rounded-md border border-warning/50 bg-warning/10 p-4 text-sm">
        {why[door]}
      </div>
      <Link to={home.to} className="mt-6 inline-flex h-10 items-center rounded-md bg-primary px-4 text-sm font-semibold text-primary-foreground hover:bg-primary/90">
        {home.label}
      </Link>
    </Page>
  )
}

/**
 * The program admin starts at Approvals: the first time they reach the board in a
 * browser session they're taken there. After that, Board shows the board, so the
 * whole app stays one click away. (Per-tab convenience only; nothing security-related.)
 */
function StaffHome({ me }: { me: Me }) {
  const access = useAccess()
  if (access === null) return <Loading />
  if (access.nonprofitAdmin && !alreadyLanded()) return <Navigate to="/approvals" replace />
  return <LiveBoard me={me} />
}
function alreadyLanded(): boolean {
  try {
    return !!sessionStorage.getItem(ADMIN_LANDED_KEY)
  } catch {
    return true // storage blocked: never trap the admin in a redirect
  }
}

// ── Signed out ───────────────────────────────────────────────────────────────

const SAMPLE_DAY = 86400
function sampleBoard(): BoardItem[] {
  const base = todaySeconds() + 7 * SAMPLE_DAY
  return [
    { id: 's1', grade: '11', topic: 'healthcare', sessionDate: base, timeBand: 'morning', expectedHeadcount: 32, schoolName: 'Example High' },
    { id: 's2', grade: '9', topic: 'skilled-trades', sessionDate: base + SAMPLE_DAY, timeBand: 'midday', expectedHeadcount: 28, schoolName: 'Example High' },
    { id: 's3', grade: '12', topic: 'technology', sessionDate: base + 3 * SAMPLE_DAY, timeBand: 'afternoon', expectedHeadcount: 35, schoolName: 'Sample Academy' },
  ]
}

function SignedOutBoard({ door }: { door: Door | null }) {
  // Arriving from a "Sign in as …" link opens sign-in straight away.
  const [signIn, setSignIn] = useState(!!door)
  const items = useMemo(sampleBoard, [])
  return (
    <Page
      title="Session board"
      intro="Teachers post one-hour career sessions. Volunteers approved by the nonprofit claim them. Sign in to see the live board."
      actions={<Button onClick={() => setSignIn(true)}>Sign in</Button>}
    >
      {door && (
        <p role="note" className="mb-6 rounded-md border border-border bg-card p-3 text-sm">
          {DOOR_HINT[door]}
        </p>
      )}
      <p className="mb-3 text-xs font-medium uppercase tracking-wide text-muted-foreground">Example — not real sessions</p>
      <div aria-label="Example sessions" className="opacity-80">
        <BoardList items={items} renderAction={() => <Button size="sm" variant="outline" disabled>Claim</Button>} />
      </div>
      {signIn && <AuthOverlay onClose={() => setSignIn(false)} />}
    </Page>
  )
}

// ── Signed in ────────────────────────────────────────────────────────────────

function LiveBoard({ me }: { me: Me }) {
  return (
    <Page
      title="Program board"
      intro="Open one-hour career sessions at the district’s schools. Claim one and the teacher is told right away."
      actions={<DeskLinks me={me} />}
      wide
    >
      {me.isStaff && <StaffWaiting />}
      <StatusBanner me={me} />
      {me.volunteer?.status === 'approved' && <MyBookings userId={me.userId} />}
      <OpenSessions
        canClaim={me.canClaim}
        emptyDescription={me.appRole === 'teacher' ? 'Post a request and it appears here for volunteers.' : 'New requests appear here as teachers post them.'}
      />
    </Page>
  )
}

function DeskLinks({ me }: { me: Me }) {
  const links: { to: string; label: string }[] = []
  if (me.appRole === 'teacher') links.push({ to: '/teach', label: 'Teacher desk' })
  if (me.isStaff) links.push({ to: '/approvals', label: 'Approvals' }, { to: '/staff', label: 'School view' })
  if (!me.appRole && !me.isStaff) links.push({ to: '/my-sessions', label: 'My sessions' })
  return (
    <>
      {links.map((l) => (
        <Link key={l.to} to={l.to} className="inline-flex h-9 items-center rounded-md border border-input px-3 text-sm hover:bg-accent">
          {l.label}
        </Link>
      ))}
    </>
  )
}

// ── Work waiting for you (shown on sign-in) ──────────────────────────────────
// Display only: counts come from what the server lets this person read, and every
// decision is re-checked by its server action.

function WaitingBanner({ count, text, to, label }: { count: number; text: string; to: string; label: string }) {
  if (count === 0) return null
  return (
    <div role="status" className="mb-6 flex flex-wrap items-center justify-between gap-3 rounded-md border border-primary/30 bg-accent p-4">
      <p className="text-sm">
        <span className="mr-2 inline-flex min-w-7 justify-center rounded-sm bg-primary px-1.5 py-0.5 text-sm font-semibold tabular-nums text-primary-foreground">{count}</span>
        {text}
      </p>
      <Link to={to} className="inline-flex h-9 items-center rounded-md bg-primary px-4 text-sm font-semibold text-primary-foreground hover:bg-primary/90">
        {label}
      </Link>
    </div>
  )
}

/** The nonprofit admin (or staff helping them) sees applications waiting for vetting. */
function StaffWaiting() {
  const statuses = useQuery<{ status: string }>('volunteer_status', { limit: 500 })
  const [canVet, setCanVet] = useState(false)
  useEffect(() => {
    let live = true
    void callAction<{ canVet: boolean }>('myAccess').then((r) => {
      if (live) setCanVet(r.success && r.data.canVet)
    })
    return () => {
      live = false
    }
  }, [])
  if (!canVet || statuses.status !== 'ready') return null
  const n = statuses.records.filter((r) => r.data.status === 'applied' || r.data.status === 'renewal_pending').length
  return (
    <WaitingBanner
      count={n}
      text={n === 1 ? 'volunteer application is waiting for your decision.' : 'volunteer applications are waiting for your decision.'}
      to="/approvals"
      label="Review applications"
    />
  )
}

/** An approved volunteer's own upcoming sessions, at the top of the board (D13). */
function MyBookings({ userId }: { userId: string | null }) {
  const claims = useQuery<{ sessionId: string; volunteerId: string; status: string; confirmedAt: number | null }>('claims', {
    where: { volunteerId: userId ?? '__none__', status: 'active' },
    limit: 50,
  })
  const sessions = useQuery<SessionRow>('session_requests', { limit: 500 })
  // Private details of the volunteer's own bookings (readable because they're the collaborator).
  const details = useQuery<{ sessionId: string; teacherName?: string; teacherEmail?: string; studentCount?: number | null; classLabel?: string; room?: string }>(
    'session_details',
    { limit: 100 },
  )
  const { byId: schoolById } = useSchools()
  const byId = new Map(sessions.records.map((r) => [r.recordId, r.data]))
  const detailsById = new Map(details.records.map((r) => [r.data.sessionId, r.data]))
  const today = todaySeconds()
  const mine = claims.records
    .map((c) => ({ c: c.data, s: byId.get(c.data.sessionId) }))
    .filter((x): x is { c: (typeof x)['c']; s: SessionRow } => !!x.s && x.s.sessionDate >= today && x.s.status !== 'cancelled')
    .sort((a, b) => a.s.sessionDate - b.s.sessionDate)
  if (mine.length === 0) return null
  return (
    <section aria-label="Your sessions" className="mb-6 rounded-md border border-primary/30 bg-accent p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-semibold">Your sessions</h2>
        <Link to="/my-sessions" className="text-sm font-medium text-primary underline-offset-4 hover:underline">
          Open My sessions
        </Link>
      </div>
      <ul className="mt-2 space-y-1 text-sm">
        {mine.map(({ c, s }) => {
          const d = detailsById.get(c.sessionId)
          const label = `${topicText(s.topic, s.topicOther)}, grade ${s.grade}`
          return (
          <li key={c.sessionId} className="rounded-sm">
            <Link
              to={`/my-sessions?session=${encodeURIComponent(c.sessionId)}`}
              className="-mx-2 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-sm px-2 py-1 hover:bg-card focus-visible:bg-card"
              aria-label={`Open your session on ${formatSessionDate(s.sessionDate)}: ${topicText(s.topic, s.topicOther)}, grade ${s.grade}`}
            >
              <span className="font-medium tabular-nums">{formatSessionDate(s.sessionDate)}</span>
              <span>
                {topicText(s.topic, s.topicOther)} · Grade {s.grade}
                {schoolById.get(s.schoolId ?? '') ? ` · ${schoolById.get(s.schoolId ?? '')!.name}` : ''}
              </span>
              {c.confirmedAt ? <Badge variant="success" size="sm">Confirmed</Badge> : <Badge variant="warning" size="sm">Please confirm</Badge>}
              <span className="ml-auto text-xs font-medium text-primary">Open</span>
            </Link>
            <p className="px-2 pb-1 text-xs text-muted-foreground">
              {[
                d?.teacherName ? `Teacher: ${d.teacherName}` : '',
                d?.classLabel ?? '',
                d?.studentCount ? `${d.studentCount} students attending` : s.expectedHeadcount ? `about ${s.expectedHeadcount} students` : '',
                d?.room ? `Room ${d.room}` : '',
              ]
                .filter(Boolean)
                .join(' · ')}
              {d?.teacherEmail && (
                <>
                  {' · '}
                  <a className="font-medium text-primary underline-offset-4 hover:underline" href={`mailto:${d.teacherEmail}?subject=${encodeURIComponent(`Career session: ${label}`)}`}>
                    Email the teacher
                  </a>
                </>
              )}
            </p>
          </li>
          )
        })}
      </ul>
    </section>
  )
}

function StatusBanner({ me }: { me: Me }) {
  // Teachers and staff use the board to look, not to claim.
  if (me.appRole || me.isStaff) return null

  let text: string
  let action: { to: string; label: string } | null = null
  const v = me.volunteer
  if (!v) {
    text = 'Want to speak to a class? Tell us about your work. The nonprofit checks and approves every volunteer.'
    action = { to: '/apply', label: 'Volunteer' }
  } else if (v.status === 'approved' && !me.canClaim) {
    text = 'Your clearance has expired, so you can’t claim new sessions. Contact the program team to renew.'
  } else if (v.status === 'approved') {
    return null
  } else {
    text = `Your application: ${VOLUNTEER_STATUS_LABELS[v.status] ?? v.status}. You can browse the board meanwhile.`
    action = { to: '/apply', label: 'View application' }
  }

  return (
    <div className="mb-6 flex flex-wrap items-center justify-between gap-3 rounded-md border border-border bg-card p-4 text-sm">
      <p className="min-w-0 max-w-prose">{text}</p>
      {action && (
        <Link to={action.to} className="font-medium text-primary underline-offset-4 hover:underline">
          {action.label}
        </Link>
      )}
    </div>
  )
}

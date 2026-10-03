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
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { Link, Navigate } from 'react-router-dom'
import { AuthOverlay, useQuery } from 'deepspace'
import { Badge, Button, ConfirmModal, EmptyState, Select, SelectContent, SelectItem, SelectTrigger, SelectValue, useToast } from '@/components/ui'
import { ErrorNote, Loading, Page } from '../../components/Page'
import { callAction } from '../../lib/actions'
import { formatSessionDate, TIME_BAND_SHORT, todaySeconds, topicText, VOLUNTEER_STATUS_LABELS } from '../../lib/labels'
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

interface BoardItem {
  id: string
  grade: string
  topic: string
  topicOther?: string
  sessionDate: number
  timeBand: TimeBand
  expectedHeadcount: number | null
  schoolName?: string
}

export default function HomePage() {
  const me = useMe()
  if (!me.ready) return <Loading />
  if (!me.signedIn) return <SignedOutBoard />
  return me.isStaff ? <StaffHome me={me} /> : <LiveBoard me={me} />
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

function SignedOutBoard() {
  const [signIn, setSignIn] = useState(false)
  const items = useMemo(sampleBoard, [])
  return (
    <Page
      title="Session board"
      intro="Teachers post one-hour career sessions. Volunteers approved by the nonprofit claim them. Sign in to see the live board."
      actions={<Button onClick={() => setSignIn(true)}>Sign in</Button>}
    >
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
  const toast = useToast()
  const { records, status, error } = useQuery<SessionRow>('session_requests', {
    where: { status: 'open' },
    orderBy: 'sessionDate',
    orderDir: 'asc',
    limit: 200,
  })
  const [pending, setPending] = useState<BoardItem | null>(null)
  const [busy, setBusy] = useState(false)
  const { schools, byId: schoolById } = useSchools()
  const [schoolFilter, setSchoolFilter] = useState('__all__')

  const today = todaySeconds()
  const upcoming = records.filter((r) => r.data.sessionDate >= today)
  const schoolsOnBoard = schools.filter((sc) => upcoming.some((r) => r.data.schoolId === sc.id))
  const items: BoardItem[] = upcoming
    .filter((r) => schoolFilter === '__all__' || r.data.schoolId === schoolFilter)
    .map((r) => ({ id: r.recordId, ...r.data, schoolName: schoolById.get(r.data.schoolId ?? '')?.name }))

  async function claim() {
    if (!pending) return
    setBusy(true)
    const res = await callAction<{ claimId: string }>('claimSession', { sessionId: pending.id })
    setBusy(false)
    setPending(null)
    if (res.success) toast.success('Session booked', 'Details are in My sessions and your inbox.')
    else toast.error('Could not claim', res.error)
  }

  return (
    <Page
      title="Session board"
      intro="Open one-hour career sessions at the district’s schools. Claim one and the teacher is told right away."
      actions={<DeskLinks me={me} />}
      wide
    >
      {me.isStaff && <StaffWaiting />}
      <StatusBanner me={me} />

      {schoolsOnBoard.length > 1 && (
        <div className="mb-4 flex items-center gap-3">
          <label htmlFor="school-filter" className="text-sm text-muted-foreground">
            School
          </label>
          <Select value={schoolFilter} onValueChange={(v) => setSchoolFilter(v || '__all__')}>
            <SelectTrigger id="school-filter" className="w-60">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__">All schools</SelectItem>
              {schoolsOnBoard.map((sc) => (
                <SelectItem key={sc.id} value={sc.id}>
                  {sc.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}
      {status === 'loading' && <Loading label="Loading sessions…" />}
      {status === 'error' && <ErrorNote message={error || 'Could not load the board. Refresh to try again.'} />}
      {status === 'ready' && items.length === 0 && (
        <EmptyState
          title="No open sessions right now"
          description={me.appRole === 'teacher' ? 'Post a request and it appears here for volunteers.' : 'New requests appear here as teachers post them.'}
        />
      )}
      {status === 'ready' && items.length > 0 && (
        <BoardList
          items={items}
          renderAction={(item) =>
            me.canClaim ? (
              <Button size="sm" onClick={() => setPending(item)}>
                Claim
              </Button>
            ) : null
          }
        />
      )}

      <ConfirmModal
        open={!!pending}
        onClose={() => (busy ? undefined : setPending(null))}
        onConfirm={claim}
        title={pending ? `Claim Grade ${pending.grade} · ${topicText(pending.topic, pending.topicOther)}?` : 'Claim session?'}
        description={
          pending
            ? `${pending.schoolName ? `${pending.schoolName}, ` : ''}${formatSessionDate(pending.sessionDate)}, ${TIME_BAND_SHORT[pending.timeBand]}. You can withdraw yourself up to 48 hours before.`
            : undefined
        }
        confirmText="Claim session"
        variant="default"
        loading={busy}
      />
    </Page>
  )
}

function DeskLinks({ me }: { me: Me }) {
  const links: { to: string; label: string }[] = []
  if (me.appRole === 'teacher') links.push({ to: '/teach', label: 'Teacher desk' })
  if (me.isStaff) links.push({ to: '/approvals', label: 'Approvals' }, { to: '/staff', label: 'Staff desk' })
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

function BoardList({ items, renderAction }: { items: BoardItem[]; renderAction: (item: BoardItem) => ReactNode }) {
  return (
    <ul className="divide-y divide-border rounded-md border border-border bg-card">
      {items.map((item) => (
        <li key={item.id} className="flex flex-wrap items-center gap-x-6 gap-y-2 px-4 py-4 sm:flex-nowrap">
          <div className="w-32 shrink-0">
            <p className="text-sm font-semibold tabular-nums">{formatSessionDate(item.sessionDate)}</p>
            <p className="text-xs text-muted-foreground">{TIME_BAND_SHORT[item.timeBand]}</p>
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate font-medium">{topicText(item.topic, item.topicOther)}</p>
            <p className="text-xs text-muted-foreground">
              {item.schoolName ? `${item.schoolName} · ` : ''}Grade {item.grade}
              {item.expectedHeadcount ? ` · about ${item.expectedHeadcount} students` : ''}
            </p>
          </div>
          <Badge variant="info">Open</Badge>
          <div className="shrink-0">{renderAction(item)}</div>
        </li>
      ))}
    </ul>
  )
}

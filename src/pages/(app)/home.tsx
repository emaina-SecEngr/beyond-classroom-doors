/* home pattern: product-preview-first — the live session board is the home; signed-out visitors see a labeled example of it. */
/**
 * The session board (M6, M7).
 *
 * Signed out: a clearly labeled example board, with sign-in.
 * Signed in: the live board of open, upcoming sessions. Approved volunteers can
 * claim; everyone else sees why they can't yet. Teachers, board members and staff
 * get a link to their desk.
 *
 * The board shows only what a request contains — grade, topic, date, time band,
 * class size. Room, exact time and arrival notes are shared after a claim.
 */
import { useMemo, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { AuthOverlay, useQuery } from 'deepspace'
import { Badge, Button, ConfirmModal, EmptyState, useToast } from '@/components/ui'
import { ErrorNote, Loading, Page } from '../../components/Page'
import { callAction } from '../../lib/actions'
import { formatSessionDate, TIME_BAND_SHORT, todaySeconds, topicText, VOLUNTEER_STATUS_LABELS } from '../../lib/labels'
import { useMe, type Me } from '../../lib/me'
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
}

interface BoardItem {
  id: string
  grade: string
  topic: string
  topicOther?: string
  sessionDate: number
  timeBand: TimeBand
  expectedHeadcount: number | null
}

export default function HomePage() {
  const me = useMe()
  if (!me.ready) return <Loading />
  return me.signedIn ? <LiveBoard me={me} /> : <SignedOutBoard />
}

// ── Signed out ───────────────────────────────────────────────────────────────

const SAMPLE_DAY = 86400
function sampleBoard(): BoardItem[] {
  const base = todaySeconds() + 7 * SAMPLE_DAY
  return [
    { id: 's1', grade: '11', topic: 'healthcare', sessionDate: base, timeBand: 'morning', expectedHeadcount: 32 },
    { id: 's2', grade: '9', topic: 'skilled-trades', sessionDate: base + SAMPLE_DAY, timeBand: 'midday', expectedHeadcount: 28 },
    { id: 's3', grade: '12', topic: 'technology', sessionDate: base + 3 * SAMPLE_DAY, timeBand: 'afternoon', expectedHeadcount: 35 },
  ]
}

function SignedOutBoard() {
  const [signIn, setSignIn] = useState(false)
  const items = useMemo(sampleBoard, [])
  return (
    <Page
      title="Session board"
      intro="Teachers post one-hour career sessions. Vetted, board-approved volunteers claim them. Sign in to see the live board."
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

  const today = todaySeconds()
  const items: BoardItem[] = records
    .filter((r) => r.data.sessionDate >= today)
    .map((r) => ({ id: r.recordId, ...r.data }))

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
      intro="Open one-hour career sessions at the school. Claim one and the teacher is told right away."
      actions={<DeskLinks me={me} />}
      wide
    >
      <StatusBanner me={me} />

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
        description={pending ? `${formatSessionDate(pending.sessionDate)}, ${TIME_BAND_SHORT[pending.timeBand]}. You can withdraw yourself up to 48 hours before.` : undefined}
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
  if (me.appRole === 'board_member') links.push({ to: '/approvals', label: 'Board approvals' })
  if (me.isStaff) links.push({ to: '/staff', label: 'Staff desk' })
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

function StatusBanner({ me }: { me: Me }) {
  // Teachers, board members and staff use the board to look, not to claim.
  if (me.appRole || me.isStaff) return null

  let text: string
  let action: { to: string; label: string } | null = null
  const v = me.volunteer
  if (!v) {
    text = 'Want to speak to a class? Tell us about your work. Program staff vet every volunteer, then the nonprofit’s board approves.'
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
              Grade {item.grade}
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

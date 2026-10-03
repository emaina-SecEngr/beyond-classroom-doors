/**
 * A volunteer's booked sessions (M8, SH5, SH6).
 *
 * Confirm availability; withdraw yourself up to 48 hours before; inside 48 hours,
 * send the program team a change request (and email them). Room, start time and
 * arrival notes are visible here only because the claim made you a collaborator
 * on that session's details.
 */
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from 'deepspace'
import {
  Badge,
  Button,
  ConfirmModal,
  EmptyState,
  Modal,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Textarea,
  useToast,
} from '@/components/ui'
import { ErrorNote, Fact, Field, Loading, Page, Section } from '../../../components/Page'
import { callAction } from '../../../lib/actions'
import {
  formatInstant,
  formatSessionDate,
  PROGRAM_EMAIL,
  SESSION_STATUS_BADGE,
  SESSION_STATUS_LABELS,
  sessionTimeText,
  todaySeconds,
  topicText,
} from '../../../lib/labels'
import { useMe } from '../../../lib/me'
import { sessionStartSeconds } from '../../../lib/time'
import { SELF_WITHDRAW_MIN_HOURS, type SessionStatus, type TimeBand } from '../../../schemas/shared'

interface ClaimRow {
  sessionId: string
  volunteerId: string
  status: 'active' | 'withdrawn'
  confirmedAt: number | null
  withdrawnAt?: number | null
}
interface SessionRow {
  grade: string
  topic: string
  topicOther: string
  sessionDate: number
  timeBand: TimeBand
  expectedHeadcount: number | null
  status: SessionStatus
}
interface DetailsRow {
  sessionId: string
  room: string
  startTime: string
  arrivalNote: string
  teacherNote: string
}

interface Booking {
  claimId: string
  sessionId: string
  claim: ClaimRow
  session: SessionRow | null
  details: DetailsRow | null
  start: number | null
}

type Pending = { kind: 'confirm' | 'withdraw' | 'change'; booking: Booking } | null

export default function MySessionsPage() {
  const me = useMe()
  const toast = useToast()
  const claims = useQuery<ClaimRow>('claims', { where: { volunteerId: me.userId ?? '__none__' }, limit: 200 })
  const sessions = useQuery<SessionRow>('session_requests', { limit: 500 })
  const details = useQuery<DetailsRow>('session_details', { limit: 200 })
  const [pending, setPending] = useState<Pending>(null)
  const [busy, setBusy] = useState(false)
  const [changeKind, setChangeKind] = useState<'cancel' | 'reschedule'>('reschedule')
  const [changeNote, setChangeNote] = useState('')

  if (!me.ready || claims.status === 'loading' || sessions.status === 'loading' || details.status === 'loading') return <Loading />

  const loadError = claims.error || sessions.error || details.error
  const sessionById = new Map(sessions.records.map((r) => [r.recordId, r.data]))
  const detailsById = new Map(details.records.map((r) => [r.data.sessionId, r.data]))
  const bookings: Booking[] = claims.records
    .filter((r) => r.data.volunteerId === me.userId)
    .map((r) => {
      const session = sessionById.get(r.data.sessionId) ?? null
      const d = detailsById.get(r.data.sessionId) ?? null
      return {
        claimId: r.recordId,
        sessionId: r.data.sessionId,
        claim: r.data,
        session,
        details: d,
        start: session ? sessionStartSeconds(session.sessionDate, session.timeBand, d?.startTime) : null,
      }
    })
    .sort((a, b) => (a.start ?? 0) - (b.start ?? 0))

  const today = todaySeconds()
  const upcoming = bookings.filter((b) => b.claim.status === 'active' && b.session && b.session.sessionDate >= today && b.session.status !== 'cancelled')
  const past = bookings.filter((b) => !upcoming.includes(b))

  async function run() {
    if (!pending) return
    const { kind, booking } = pending
    setBusy(true)
    const res =
      kind === 'confirm'
        ? await callAction('confirmClaim', { sessionId: booking.sessionId })
        : kind === 'withdraw'
          ? await callAction('withdrawClaim', { sessionId: booking.sessionId })
          : await callAction('requestChange', { sessionId: booking.sessionId, kind: changeKind, note: changeNote })
    setBusy(false)
    if (!res.success) {
      toast.error('That didn’t go through', res.error)
      return
    }
    setPending(null)
    setChangeNote('')
    if (kind === 'confirm') toast.success('Availability confirmed', 'The teacher has been told.')
    else if (kind === 'withdraw') toast.success('You’ve withdrawn', 'The session is back on the board.')
    else toast.success('Request sent', 'The program team will follow up. You can also email them.')
  }

  const label = (b: Booking) => (b.session ? `Grade ${b.session.grade} · ${topicText(b.session.topic, b.session.topicOther)}` : 'Session')

  return (
    <Page title="My sessions" intro="Sessions you’ve claimed. Confirm you’re coming, and let the school know early if plans change.">
      {loadError && <ErrorNote message={loadError} />}

      {!me.canClaim && bookings.length === 0 && (
        <EmptyState
          title="No sessions yet"
          description={me.volunteer ? 'Once you’re approved, claim a session from the board.' : 'Apply to volunteer first. The nonprofit vets and its board approves every volunteer.'}
        />
      )}

      {(me.canClaim || bookings.length > 0) && (
        <Section title="Upcoming">
          {upcoming.length === 0 ? (
            <EmptyState title="Nothing booked" description="Open sessions are on the board." />
          ) : (
            <ul className="space-y-4">
              {upcoming.map((b) => {
                const hoursLeft = b.start ? (b.start - Date.now() / 1000) / 3600 : 0
                const canWithdraw = hoursLeft >= SELF_WITHDRAW_MIN_HOURS
                const status = b.session!.status
                return (
                  <li key={b.claimId} className="rounded-md border border-border bg-card p-5">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0">
                        <h3 className="font-semibold">{label(b)}</h3>
                        <p className="text-sm text-muted-foreground">
                          {formatSessionDate(b.session!.sessionDate)}, {sessionTimeText(b.session!.timeBand, b.details?.startTime)}
                        </p>
                      </div>
                      <Badge variant={SESSION_STATUS_BADGE[status]}>{status === 'claimed' ? 'Awaiting your confirmation' : SESSION_STATUS_LABELS[status]}</Badge>
                    </div>

                    <dl className="mt-4 space-y-1.5">
                      <Fact label="Room">{b.details?.room || 'Not set yet — the teacher or program staff will add it'}</Fact>
                      {b.details?.arrivalNote && <Fact label="On arrival">{b.details.arrivalNote}</Fact>}
                      {b.details?.teacherNote && <Fact label="From the teacher">{b.details.teacherNote}</Fact>}
                      {b.session!.expectedHeadcount ? <Fact label="Class size">About {b.session!.expectedHeadcount} students</Fact> : null}
                    </dl>

                    <div className="mt-5 flex flex-wrap gap-2">
                      {status === 'claimed' && (
                        <Button size="sm" onClick={() => setPending({ kind: 'confirm', booking: b })}>
                          Confirm I’m coming
                        </Button>
                      )}
                      {canWithdraw ? (
                        <Button size="sm" variant="outline" onClick={() => setPending({ kind: 'withdraw', booking: b })}>
                          Withdraw
                        </Button>
                      ) : (
                        <Button size="sm" variant="outline" onClick={() => setPending({ kind: 'change', booking: b })}>
                          Request a change
                        </Button>
                      )}
                    </div>
                  </li>
                )
              })}
            </ul>
          )}
          <p className="mt-4 text-sm text-muted-foreground">
            Looking for more? <Link to="/home" className="text-primary underline-offset-4 hover:underline">Open the session board</Link>.
          </p>
        </Section>
      )}

      {past.length > 0 && (
        <Section title="History">
          <ul className="divide-y divide-border rounded-md border border-border bg-card">
            {past.map((b) => (
              <li key={b.claimId} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-sm">
                <span className="min-w-0">
                  {label(b)} · {b.session ? formatSessionDate(b.session.sessionDate) : ''}
                </span>
                <span className="text-muted-foreground">
                  {b.claim.status === 'withdrawn'
                    ? `Released ${formatInstant(b.claim.withdrawnAt ?? null)}`
                    : b.session
                      ? SESSION_STATUS_LABELS[b.session.status]
                      : ''}
                </span>
              </li>
            ))}
          </ul>
        </Section>
      )}

      <ConfirmModal
        open={pending?.kind === 'confirm'}
        onClose={() => !busy && setPending(null)}
        onConfirm={run}
        title={pending ? `Confirm ${label(pending.booking)}?` : 'Confirm?'}
        description="The teacher will see that you’re coming."
        confirmText="Confirm"
        variant="default"
        loading={busy}
      />
      <ConfirmModal
        open={pending?.kind === 'withdraw'}
        onClose={() => !busy && setPending(null)}
        onConfirm={run}
        title={pending ? `Withdraw from ${label(pending.booking)}?` : 'Withdraw?'}
        description="The session goes back on the board and the teacher is told."
        confirmText="Withdraw"
        loading={busy}
      />
      <Modal open={pending?.kind === 'change'} onClose={() => !busy && setPending(null)}>
        <Modal.Header>
          <Modal.Title>Request a change</Modal.Title>
          <Modal.Description>
            It’s less than {SELF_WITHDRAW_MIN_HOURS} hours to the session, so the program team handles changes. They’ll contact the teacher.
          </Modal.Description>
        </Modal.Header>
        <Modal.Body>
          <div className="space-y-4">
            <Field label="What do you need?" htmlFor="change-kind">
              <Select value={changeKind} onValueChange={(v) => setChangeKind(v === 'cancel' ? 'cancel' : 'reschedule')}>
                <SelectTrigger id="change-kind">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="reschedule">Reschedule</SelectItem>
                  <SelectItem value="cancel">Cancel</SelectItem>
                </SelectContent>
              </Select>
            </Field>
            <Field label="Note for the program team (optional)" htmlFor="change-note">
              <Textarea id="change-note" value={changeNote} onChange={(e) => setChangeNote(e.target.value)} maxLength={500} rows={3} />
            </Field>
            <p className="text-sm text-muted-foreground">
              Urgent? Also email{' '}
              <a
                className="underline"
                href={`mailto:${PROGRAM_EMAIL}?subject=${encodeURIComponent(`Change request: ${pending ? label(pending.booking) : 'session'}`)}`}
              >
                {PROGRAM_EMAIL}
              </a>
              .
            </p>
          </div>
        </Modal.Body>
        <Modal.Footer>
          <Button variant="ghost" onClick={() => setPending(null)} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={run} loading={busy}>
            Send request
          </Button>
        </Modal.Footer>
      </Modal>
    </Page>
  )
}

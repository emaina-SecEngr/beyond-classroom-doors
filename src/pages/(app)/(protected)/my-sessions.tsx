/**
 * A volunteer's booked sessions (M8, SH5, SH6).
 *
 * Confirm availability; withdraw yourself up to 48 hours before; inside 48 hours,
 * send the program team a change request (and email them). Room, start time and
 * arrival notes are visible here only because the claim made you a collaborator
 * on that session's details.
 */
import { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
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
  Checkbox,
  cn,
  Input,
  useToast,
} from '@/components/ui'
import { ErrorNote, Fact, Field, Loading, Page, Section } from '../../../components/Page'
import { callAction } from '../../../lib/actions'
import {
  EQUIPMENT_LABELS,
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
import { useSchools, fullAddress } from '../../../lib/schools'
import { ProposalBanner, ProposeDateButton } from '../../../components/DateProposal'
import { OpenSessions } from '../../../components/OpenSessions'
import { MyInvitations } from '../../../components/MyInvitations'
import { Directions } from '../../../components/Directions'
import { PrepChecklistView, prepItems } from '../../../components/PrepChecklist'
import { sessionStartSeconds } from '../../../lib/time'
import { EQUIPMENT, SELF_WITHDRAW_MIN_HOURS, type SessionStatus, type TimeBand } from '../../../schemas/shared'

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
  schoolId?: string
}
interface DetailsRow {
  sessionId: string
  prepChecklist?: unknown
  room: string
  startTime: string
  arrivalNote: string
  teacherNote: string
  classLabel?: string
  studentCount?: number | null
  equipmentRequested?: string[]
  equipmentOther?: string
  equipmentReady?: string[]
  teacherName?: string
  teacherEmail?: string
  teacherPhone?: string
  accessNeeds?: string
  readyAt?: number | null
  proposedDate?: number | null
  proposedTimeBand?: string
  proposedBy?: string
  proposedNote?: string
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
  // Opened from the board (/my-sessions?session=<id>): scroll to that session and highlight it.
  const [params] = useSearchParams()
  const focusId = params.get('session')
  const sessions = useQuery<SessionRow>('session_requests', { limit: 500 })
  const details = useQuery<DetailsRow>('session_details', { limit: 200 })
  const { byId: schoolById } = useSchools()
  const [pending, setPending] = useState<Pending>(null)
  const [busy, setBusy] = useState(false)
  const [changeKind, setChangeKind] = useState<'cancel' | 'reschedule'>('reschedule')
  const [changeNote, setChangeNote] = useState('')

  useEffect(() => {
    if (!focusId || claims.status !== 'ready') return
    const el = document.getElementById(`session-${focusId}`)
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' })
      el.focus({ preventScroll: true })
    }
  }, [focusId, claims.status])

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
    <Page title="My sessions" intro="Your career sessions. Confirm you’re coming, tell the teacher what you need, and let the school know early if plans change.">
      {loadError && <ErrorNote message={loadError} />}
      <ApplicationStatus volunteer={me.volunteer} canClaim={me.canClaim} />
      {me.userId && <MyInvitations volunteerId={me.userId} canClaim={me.canClaim} />}

      {!me.canClaim && bookings.length === 0 && (
        <EmptyState
          title="No sessions yet"
          description={me.volunteer ? 'Once you’re approved, open sessions and teachers’ invitations appear here.' : 'Apply to volunteer first. The program admin reviews and approves every volunteer.'}
        />
      )}

      {(me.canClaim || bookings.length > 0) && (
        <Section title="Upcoming">
          {upcoming.length === 0 ? (
            <EmptyState title="Nothing booked yet" description="Claim one of the open sessions below, or the program may assign you one." />
          ) : (
            <ul className="space-y-4">
              {upcoming.map((b) => {
                const hoursLeft = b.start ? (b.start - Date.now() / 1000) / 3600 : 0
                const canWithdraw = hoursLeft >= SELF_WITHDRAW_MIN_HOURS
                const status = b.session!.status
                return (
                  <li
                    key={b.claimId}
                    id={`session-${b.sessionId}`}
                    tabIndex={-1}
                    className={cn(
                      'scroll-mt-20 rounded-md border bg-card p-5 outline-none',
                      focusId === b.sessionId ? 'border-primary ring-2 ring-primary/30' : 'border-border',
                    )}
                  >
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0">
                        <h3 className="font-semibold">{label(b)}</h3>
                        <p className="text-sm text-muted-foreground">
                          {formatSessionDate(b.session!.sessionDate)}, {sessionTimeText(b.session!.timeBand, b.details?.startTime)}
                        </p>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <Badge variant={SESSION_STATUS_BADGE[status]}>{status === 'claimed' ? 'Awaiting your confirmation' : SESSION_STATUS_LABELS[status]}</Badge>
                        {b.details?.readyAt ? <Badge variant="success">Class ready</Badge> : <Badge variant="outline">Class not ready yet</Badge>}
                      </div>
                    </div>

                    <dl className="mt-4 space-y-1.5">
                      {(() => {
                        const sc = schoolById.get(b.session!.schoolId ?? '')
                        return sc ? (
                          <Fact label="School">
                            {[sc.name, fullAddress(sc)].filter(Boolean).join(', ')} · <Directions school={sc} label="Directions & distance" />
                          </Fact>
                        ) : null
                      })()}
                      {b.details?.teacherName || b.details?.teacherEmail ? (
                        <Fact label="Teacher">
                          {b.details?.teacherName || 'Your teacher'}
                          {b.details?.teacherEmail && (
                            <>
                              {' · '}
                              <a
                                className="text-primary underline-offset-4 hover:underline"
                                href={`mailto:${b.details.teacherEmail}?subject=${encodeURIComponent(`Career session: ${label(b)}`)}`}
                              >
                                Email
                              </a>
                            </>
                          )}
                          {b.details?.teacherPhone && (
                            <>
                              {' · '}
                              <a className="text-primary underline-offset-4 hover:underline" href={`tel:${b.details.teacherPhone.replace(/[^0-9+]/g, '')}`}>
                                Call {b.details.teacherPhone}
                              </a>
                            </>
                          )}
                        </Fact>
                      ) : null}
                      <Fact label="Room">{b.details?.room || 'Not set yet — the teacher or program staff will add it'}</Fact>
                      {b.details?.arrivalNote && <Fact label="On arrival">{b.details.arrivalNote}</Fact>}
                      {b.details?.teacherNote && <Fact label="From the teacher">{b.details.teacherNote}</Fact>}
                      {b.details?.classLabel && <Fact label="Class">{b.details.classLabel}</Fact>}
                      {b.details?.studentCount ? (
                        <Fact label="Students">{b.details.studentCount} taking part</Fact>
                      ) : b.session!.expectedHeadcount ? (
                        <Fact label="Class size">About {b.session!.expectedHeadcount} students</Fact>
                      ) : null}
                    </dl>
                    <div className="mt-4">
                      <PrepChecklistView items={prepItems(b.details?.prepChecklist)} />
                    </div>

                    {b.details?.proposedDate ? (
                      <ProposalBanner
                        sessionId={b.sessionId}
                        proposedDate={b.details.proposedDate}
                        proposedTimeBand={b.details.proposedTimeBand}
                        proposedNote={b.details.proposedNote}
                        mine={b.details.proposedBy === me.userId}
                        who="The teacher"
                      />
                    ) : null}

                    <NeedsEditor sessionId={b.sessionId} details={b.details} />

                    <div className="mt-5 flex flex-wrap gap-2">
                      {status === 'claimed' && (
                        <Button size="sm" onClick={() => setPending({ kind: 'confirm', booking: b })}>
                          Confirm I’m coming
                        </Button>
                      )}
                      {!b.details?.proposedDate && <ProposeDateButton sessionId={b.sessionId} label={label(b)} />}
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
        </Section>
      )}

      {me.canClaim && (
        <Section title="Open sessions" description="Sessions teachers have asked for that still need a volunteer. Claim one and the teacher is told right away.">
          <OpenSessions canClaim preferredSchools={Array.isArray(me.profile?.preferredSchools) ? me.profile!.preferredSchools : []} emptyDescription="New requests appear here as teachers post them." />
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

/**
 * What the volunteer needs for their talk (D11). They tick items and save; the
 * teacher is told and marks each one ready, which shows here as "Ready".
 */
function NeedsEditor({ sessionId, details }: { sessionId: string; details: DetailsRow | null }) {
  const toast = useToast()
  const saved = details?.equipmentRequested ?? []
  const ready = new Set(details?.equipmentReady ?? [])
  const [editing, setEditing] = useState(false)
  const [items, setItems] = useState<string[]>(saved)
  const [other, setOther] = useState(details?.equipmentOther ?? '')
  const [access, setAccess] = useState(details?.accessNeeds ?? '')
  const [busy, setBusy] = useState(false)

  async function save() {
    setBusy(true)
    const res = await callAction('requestEquipment', { sessionId, items, other, accessNeeds: access })
    setBusy(false)
    if (!res.success) {
      toast.error('Could not save', res.error)
      return
    }
    toast.success('Sent to the teacher', 'They’ll mark each item as ready.')
    setEditing(false)
  }

  return (
    <div className="mt-5 rounded-md border border-border p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h4 className="text-sm font-semibold">What you’ll need on the day</h4>
        {!editing && (
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              setItems(saved)
              setOther(details?.equipmentOther ?? '')
              setAccess(details?.accessNeeds ?? '')
              setEditing(true)
            }}
          >
            {saved.length || details?.equipmentOther || details?.accessNeeds ? 'Change' : 'Add'}
          </Button>
        )}
      </div>
      {editing ? (
        <div className="mt-3 space-y-3">
          <div className="grid gap-2 sm:grid-cols-2">
            {EQUIPMENT.map((e) => (
              <label key={e} className="flex items-center gap-3 text-sm">
                <Checkbox checked={items.includes(e)} onCheckedChange={(c) => setItems((v) => (c ? [...v, e] : v.filter((x) => x !== e)))} />
                <span>{EQUIPMENT_LABELS[e]}</span>
              </label>
            ))}
          </div>
          <Field label="Anything else?" htmlFor={`other-${sessionId}`}>
            <Input id={`other-${sessionId}`} value={other} onChange={(e) => setOther(e.target.value)} maxLength={200} placeholder="For example: a table near an outlet" />
          </Field>
          <Field
            label="Anything that would help you on the day?"
            htmlFor={`access-${sessionId}`}
            hint="For example: a step-free route or parking near the entrance. Shared only with this teacher and school staff."
          >
            <Textarea id={`access-${sessionId}`} rows={2} value={access} onChange={(e) => setAccess(e.target.value)} maxLength={300} />
          </Field>
          <div className="flex gap-2">
            <Button size="sm" onClick={() => void save()} loading={busy}>
              Send to the teacher
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setEditing(false)} disabled={busy}>
              Cancel
            </Button>
          </div>
        </div>
      ) : saved.length === 0 && !details?.equipmentOther && !details?.accessNeeds ? (
        <p className="mt-1 text-sm text-muted-foreground">Projector, markers, paper, a step-free route? Tell the teacher what to have ready.</p>
      ) : (
        <ul className="mt-2 space-y-1 text-sm">
          {saved.map((e) => (
            <li key={e} className="flex items-center gap-2">
              <span>{EQUIPMENT_LABELS[e as keyof typeof EQUIPMENT_LABELS] ?? e}</span>
              {ready.has(e) ? (
                <Badge variant="success" size="sm">
                  Ready
                </Badge>
              ) : (
                <Badge variant="outline" size="sm">
                  Waiting
                </Badge>
              )}
            </li>
          ))}
          {details?.equipmentOther && <li className="text-muted-foreground">Also: {details.equipmentOther}</li>}
          {details?.accessNeeds && <li className="text-muted-foreground">On the day: {details.accessNeeds}</li>}
        </ul>
      )}
    </div>
  )
}

/** Where the volunteer's application stands, with the next step (shown until they can claim). */
function ApplicationStatus({ volunteer, canClaim }: { volunteer: { status: string } | null; canClaim: boolean }) {
  if (canClaim) return null
  let text: string
  let link: { to: string; label: string } | null = { to: '/apply', label: 'Open your profile' }
  if (!volunteer) {
    text = 'Tell us about your work to apply. The nonprofit checks and approves every volunteer.'
    link = { to: '/apply', label: 'Apply to volunteer' }
  } else if (volunteer.status === 'approved') {
    text = 'Your clearance has expired, so you can’t take new sessions. Contact the program team to renew.'
    link = null
  } else if (volunteer.status === 'rejected' || volunteer.status === 'declined') {
    text = 'Your application wasn’t approved. Your profile shows the reason.'
  } else {
    text = 'Your application is waiting for the program admin. Once you’re approved, open sessions appear here.'
  }
  return (
    <div className="mb-6 flex flex-wrap items-center justify-between gap-3 rounded-md border border-border bg-card p-4 text-sm">
      <p className="min-w-0 max-w-prose">{text}</p>
      {link && (
        <Link to={link.to} className="font-medium text-primary underline-offset-4 hover:underline">
          {link.label}
        </Link>
      )}
    </div>
  )
}

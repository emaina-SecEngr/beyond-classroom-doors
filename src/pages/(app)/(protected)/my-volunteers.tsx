/**
 * My volunteers — the teacher's view of the people coming to her class (D18).
 *
 *   Booked with you   every volunteer booked on her sessions: contact, access needs,
 *                     "class is ready", propose another date, and her prep checklist.
 *   Approved          all approved volunteers (work profile only — no contact details
 *                     until they're booked with her), with "Invite to a session".
 *
 * Every action re-checks on the server that she's a teacher and owns the session.
 */
import { useCallback, useEffect, useState } from 'react'
import { Navigate } from 'react-router-dom'
import { useQuery } from 'deepspace'
import { Badge, Button, Checkbox, EmptyState, Modal, SearchInput, Tabs, TabsContent, TabsList, TabsTrigger, Textarea, useToast } from '@/components/ui'
import { BookedSessionTools, type BookedDetails } from '../../../components/BookedSessionTools'
import { ErrorNote, Field, Loading, Page } from '../../../components/Page'
import { PickList } from '../../../components/Pickers'
import { PrepChecklistEditor, PrepProgress, prepItems } from '../../../components/PrepChecklist'
import { callAction } from '../../../lib/actions'
import { formatSessionDate, sessionTimeText, todaySeconds, topicText } from '../../../lib/labels'
import { useMe } from '../../../lib/me'
import type { SessionStatus, TimeBand } from '../../../schemas/shared'

interface SessionRow {
  teacherId: string
  grade: string
  topic: string
  topicOther: string
  sessionDate: number
  timeBand: TimeBand
  status: SessionStatus
}
interface DetailsRow extends BookedDetails {
  sessionId: string
  startTime?: string
  classLabel?: string
  studentCount?: number | null
  prepChecklist?: unknown
}
interface InviteRow {
  sessionId: string
  volunteerId: string
  status: 'pending' | 'accepted' | 'declined' | 'closed'
}
interface DirectoryVolunteer {
  volunteerId: string
  displayName: string
  profession: string
  employer: string
  yearsExperience: number | null
  skills: string
  hobbies: string
  prefersMySchool: boolean
}

const label = (s: SessionRow) => `Grade ${s.grade} · ${topicText(s.topic, s.topicOther)}`

export default function MyVolunteersPage() {
  const me = useMe()
  const mine = useQuery<SessionRow>('session_requests', { where: { teacherId: me.userId ?? '__none__' }, limit: 300 })
  const details = useQuery<DetailsRow>('session_details', { where: { teacherId: me.userId ?? '__none__' }, limit: 300 })
  const invites = useQuery<InviteRow>('session_invites', { where: { teacherId: me.userId ?? '__none__' }, limit: 500 })

  if (!me.ready || mine.status === 'loading' || details.status === 'loading') return <Loading />
  if (me.appRole !== 'teacher') return <Navigate to="/home" replace />

  const today = todaySeconds()
  const detailsById = new Map(details.records.map((r) => [r.data.sessionId, r.data]))
  const upcoming = mine.records.filter((r) => r.data.sessionDate >= today).sort((a, b) => a.data.sessionDate - b.data.sessionDate)
  const booked = upcoming.filter((r) => r.data.status === 'claimed' || r.data.status === 'confirmed')
  const open = upcoming.filter((r) => r.data.status === 'open')

  return (
    <Page title="My volunteers" intro="The volunteers coming to your class, what you’re preparing for them, and approved volunteers you can invite." wide>
      {(mine.error || details.error) && <ErrorNote message={mine.error || details.error || ''} />}
      <Tabs defaultValue="booked">
        <TabsList>
          <TabsTrigger value="booked">Booked with you{booked.length ? ` (${booked.length})` : ''}</TabsTrigger>
          <TabsTrigger value="approved">Approved volunteers</TabsTrigger>
        </TabsList>
        <TabsContent value="booked" className="pt-6">
          {booked.length === 0 ? (
            <EmptyState title="No volunteers booked yet" description="When a volunteer claims one of your sessions, or you invite one and they accept, they appear here." />
          ) : (
            <ul className="space-y-4">
              {booked.map((r) => {
                const d = detailsById.get(r.recordId)
                const items = prepItems(d?.prepChecklist)
                return (
                  <li key={r.recordId} className="rounded-md border border-border bg-card p-5">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0">
                        <h2 className="font-display text-xl font-semibold">{d?.volunteerName || 'Booked volunteer'}</h2>
                        <p className="text-sm text-muted-foreground">
                          {formatSessionDate(r.data.sessionDate)} · {sessionTimeText(r.data.timeBand, d?.startTime)} · {label(r.data)}
                          {d?.classLabel ? ` · ${d.classLabel}` : ''}
                          {d?.studentCount ? ` · ${d.studentCount} students` : ''}
                        </p>
                      </div>
                      <div className="flex gap-2">
                        {r.data.status === 'confirmed' ? <Badge variant="success">Confirmed</Badge> : <Badge variant="warning">Awaiting their confirmation</Badge>}
                        <PrepProgress items={items} />
                      </div>
                    </div>
                    <div className="mt-4">
                      <BookedSessionTools sessionId={r.recordId} label={label(r.data)} status={r.data.status} details={d} viewerId={me.userId} />
                    </div>
                    <section className="mt-4 rounded-md border border-border p-4" aria-label={`Prep checklist for ${d?.volunteerName || 'the volunteer'}`}>
                      <h3 className="mb-2 text-sm font-semibold">Prep checklist for this visit</h3>
                      <p className="mb-3 text-xs text-muted-foreground">The volunteer sees this list and what’s ticked off.</p>
                      <PrepChecklistEditor sessionId={r.recordId} items={items} />
                    </section>
                  </li>
                )
              })}
            </ul>
          )}
        </TabsContent>
        <TabsContent value="approved" className="pt-6">
          <ApprovedDirectory
            openSessions={open.map((r) => ({ id: r.recordId, text: `${formatSessionDate(r.data.sessionDate)} · ${sessionTimeText(r.data.timeBand, detailsById.get(r.recordId)?.startTime)} · ${label(r.data)}` }))}
            invites={invites.records.map((r) => r.data)}
          />
        </TabsContent>
      </Tabs>
    </Page>
  )
}

function ApprovedDirectory({ openSessions, invites }: { openSessions: { id: string; text: string }[]; invites: InviteRow[] }) {
  const [list, setList] = useState<DirectoryVolunteer[] | null>(null)
  const [error, setError] = useState('')
  const [q, setQ] = useState('')
  const [inviting, setInviting] = useState<DirectoryVolunteer | null>(null)

  const load = useCallback(async () => {
    const res = await callAction<{ volunteers: DirectoryVolunteer[] }>('teacherVolunteerDirectory', {})
    if (res.success) setList(res.data.volunteers)
    else setError(res.error)
  }, [])
  useEffect(() => {
    void load()
  }, [load])

  if (error) return <ErrorNote message={error} />
  if (!list) return <Loading />
  if (list.length === 0) return <EmptyState title="No approved volunteers yet" description="Volunteers appear here once the program admin approves them." />

  const needle = q.trim().toLowerCase()
  const shown = list.filter((v) => !needle || `${v.displayName} ${v.profession} ${v.employer} ${v.skills}`.toLowerCase().includes(needle))
  const statusFor = (volunteerId: string) => {
    const mineFor = invites.filter((i) => i.volunteerId === volunteerId)
    if (mineFor.some((i) => i.status === 'pending')) return 'Invited'
    if (mineFor.some((i) => i.status === 'accepted')) return 'Accepted an invite'
    if (mineFor.some((i) => i.status === 'declined')) return 'Declined an invite'
    return ''
  }

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          {list.length} approved volunteer{list.length === 1 ? '' : 's'}. Contact details are shared once they’re booked with you.
        </p>
        <SearchInput aria-label="Search volunteers" placeholder="Search name, profession, skill" value={q} onChange={(e) => setQ(e.target.value)} onClear={() => setQ('')} className="w-72" />
      </div>
      <ul className="divide-y divide-border rounded-md border border-border bg-card">
        {shown.map((v) => {
          const st = statusFor(v.volunteerId)
          return (
            <li key={v.volunteerId} className="flex flex-wrap items-start gap-x-6 gap-y-2 px-4 py-4">
              <div className="min-w-0 flex-1">
                <p className="font-medium">
                  {v.displayName}{' '}
                  {v.prefersMySchool ? (
                    <Badge variant="success" size="sm">
                      Picked your school
                    </Badge>
                  ) : null}
                </p>
                <p className="text-sm text-muted-foreground">
                  {v.profession}
                  {v.employer ? ` · ${v.employer}` : ''}
                  {v.yearsExperience != null ? ` · ${v.yearsExperience} yrs` : ''}
                </p>
                {v.skills ? <p className="text-xs text-muted-foreground">Skills: {v.skills}</p> : null}
                {v.hobbies ? <p className="text-xs text-muted-foreground">Hobbies: {v.hobbies}</p> : null}
              </div>
              <div className="flex shrink-0 items-center gap-3">
                {st ? <span className="text-xs text-muted-foreground">{st}</span> : null}
                <Button size="sm" onClick={() => setInviting(v)}>
                  Invite to a session
                </Button>
              </div>
            </li>
          )
        })}
      </ul>
      <InviteModal volunteer={inviting} openSessions={openSessions} onClose={() => setInviting(null)} />
    </>
  )
}

function InviteModal({ volunteer, openSessions, onClose }: { volunteer: DirectoryVolunteer | null; openSessions: { id: string; text: string }[]; onClose: () => void }) {
  const toast = useToast()
  const [sessionId, setSessionId] = useState('')
  const [note, setNote] = useState('')
  const [shareEmail, setShareEmail] = useState(true)
  const [busy, setBusy] = useState(false)

  async function send() {
    if (!volunteer) return
    setBusy(true)
    const res = await callAction('inviteVolunteer', { sessionId, volunteerId: volunteer.volunteerId, note, shareEmail })
    setBusy(false)
    if (!res.success) {
      toast.error('Could not send the invitation', res.error)
      return
    }
    toast.success('Invitation sent', `${volunteer.displayName} will see it in their inbox and My sessions.`)
    setSessionId('')
    setNote('')
    onClose()
  }

  return (
    <Modal open={!!volunteer} onClose={() => !busy && onClose()} size="md">
      <Modal.Header>
        <Modal.Title>Invite {volunteer?.displayName}</Modal.Title>
        <Modal.Description>Pick one of your open sessions. They can claim it or decline. If someone else claims it first, the invitation closes.</Modal.Description>
      </Modal.Header>
      <Modal.Body>
        {openSessions.length === 0 ? (
          <p className="text-sm">
            You have no open sessions. Post one on your{' '}
            <a className="text-primary underline" href="/teach">
              Teacher desk
            </a>{' '}
            with the date you have in mind, then invite them to it.
          </p>
        ) : (
          <div className="space-y-4">
            <Field label="Session (date you’re proposing)" htmlFor="invite-session">
              <PickList id="invite-session" options={openSessions.map((s) => ({ value: s.id, label: s.text }))} value={sessionId} onChange={setSessionId} placeholder="Choose a session" />
            </Field>
            <Field label="Message (optional)" htmlFor="invite-note">
              <Textarea id="invite-note" rows={3} maxLength={300} value={note} onChange={(e) => setNote(e.target.value)} placeholder="My Health Science class would love to hear about nursing." />
            </Field>
            <label className="flex items-center gap-3 text-sm">
              <Checkbox checked={shareEmail} onCheckedChange={setShareEmail} />
              <span>Include my email so they can reply</span>
            </label>
          </div>
        )}
      </Modal.Body>
      <Modal.Footer>
        <Button variant="ghost" onClick={onClose} disabled={busy}>
          Cancel
        </Button>
        <Button onClick={() => void send()} loading={busy} disabled={!sessionId || openSessions.length === 0}>
          Send invitation
        </Button>
      </Modal.Footer>
    </Modal>
  )
}

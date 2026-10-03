/**
 * Teacher desk (M5, SH3): post a session request and manage your own requests.
 *
 * The request carries only class-level facts (grade, topic, date, time band, an
 * approximate headcount). No student names or data, ever (C1). Room, exact start
 * time and notes are private details shared only with the volunteer who claims.
 */
import { useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from 'deepspace'
import {
  Badge,
  Button,
  EmptyState,
  Input,
  Modal,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Textarea,
  useToast,
} from '@/components/ui'
import { ErrorNote, Field, Loading, Page, Panel, Section } from '../../../components/Page'
import { callAction } from '../../../lib/actions'
import {
  formatSessionDate,
  SESSION_STATUS_BADGE,
  SESSION_STATUS_LABELS,
  sessionTimeText,
  TIME_BAND_LABELS,
  todayInSanDiego,
  todaySeconds,
  topicText,
  TOPIC_LABELS,
} from '../../../lib/labels'
import { useMe } from '../../../lib/me'
import { GRADES, TIME_BANDS, TOPICS, type SessionStatus, type TimeBand, type Topic } from '../../../schemas/shared'

interface SessionRow {
  teacherId: string
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
}

const EMPTY_FORM = {
  grade: '11',
  topic: 'healthcare' as Topic,
  topicOther: '',
  sessionDate: '',
  timeBand: 'morning' as TimeBand,
  startTime: '',
  expectedHeadcount: '',
  room: '',
  arrivalNote: '',
  teacherNote: '',
}

export default function TeachPage() {
  const me = useMe()
  const toast = useToast()
  const mine = useQuery<SessionRow>('session_requests', { where: { teacherId: me.userId ?? '__none__' }, limit: 300 })
  const details = useQuery<DetailsRow>('session_details', { where: { teacherId: me.userId ?? '__none__' }, limit: 300 })
  const [form, setForm] = useState(EMPTY_FORM)
  const [saving, setSaving] = useState(false)
  const [cancelling, setCancelling] = useState<{ id: string; label: string } | null>(null)
  const [cancelReason, setCancelReason] = useState('')
  const [busy, setBusy] = useState(false)

  if (!me.ready) return <Loading />
  if (me.appRole !== 'teacher') {
    return (
      <Page title="Teacher desk">
        <EmptyState title="For teachers" description="Program staff give teacher access. If you teach at the school, ask them to add you." />
      </Page>
    )
  }

  const set = <K extends keyof typeof form>(key: K, value: (typeof form)[K]) => setForm((f) => ({ ...f, [key]: value }))

  async function submit(e: FormEvent) {
    e.preventDefault()
    setSaving(true)
    const res = await callAction<{ sessionId: string }>('createSessionRequest', {
      ...form,
      expectedHeadcount: form.expectedHeadcount ? Number(form.expectedHeadcount) : null,
    })
    setSaving(false)
    if (!res.success) {
      toast.error('Could not post the request', res.error)
      return
    }
    toast.success('Request posted', 'It’s on the board for approved volunteers.')
    setForm(EMPTY_FORM)
  }

  async function cancel() {
    if (!cancelling) return
    setBusy(true)
    const res = await callAction('cancelSession', { sessionId: cancelling.id, reason: cancelReason })
    setBusy(false)
    if (!res.success) {
      toast.error('Could not cancel', res.error)
      return
    }
    toast.success('Session cancelled', 'If a volunteer had booked it, they’ve been told.')
    setCancelling(null)
    setCancelReason('')
  }

  const detailsById = new Map(details.records.map((r) => [r.data.sessionId, r.data]))
  const today = todaySeconds()
  const rows = mine.records
    .filter((r) => r.data.teacherId === me.userId)
    .sort((a, b) => a.data.sessionDate - b.data.sessionDate)
  const upcoming = rows.filter((r) => r.data.sessionDate >= today && r.data.status !== 'cancelled' && r.data.status !== 'completed')
  const earlier = rows.filter((r) => !upcoming.includes(r))

  return (
    <Page title="Teacher desk" intro="Ask for a one-hour career session. Approved volunteers see it on the board and one of them claims it.">
      <Section title="Your requests">
        {mine.status === 'loading' && <Loading />}
        {mine.status === 'error' && <ErrorNote message={mine.error || 'Could not load your requests.'} />}
        {mine.status === 'ready' && upcoming.length === 0 && <EmptyState title="No upcoming requests" description="Post one below." />}
        {upcoming.length > 0 && (
          <ul className="divide-y divide-border rounded-md border border-border bg-card">
            {upcoming.map((r) => {
              const d = detailsById.get(r.recordId)
              const label = `Grade ${r.data.grade} · ${topicText(r.data.topic, r.data.topicOther)}`
              return (
                <li key={r.recordId} className="flex flex-wrap items-center gap-x-6 gap-y-2 px-4 py-4">
                  <div className="w-36 shrink-0">
                    <p className="text-sm font-semibold">{formatSessionDate(r.data.sessionDate)}</p>
                    <p className="text-xs text-muted-foreground">{sessionTimeText(r.data.timeBand, d?.startTime)}</p>
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="font-medium">{label}</p>
                    <p className="text-xs text-muted-foreground">{d?.room ? `Room ${d.room}` : 'No room set'}</p>
                  </div>
                  <Badge variant={SESSION_STATUS_BADGE[r.data.status]}>{SESSION_STATUS_LABELS[r.data.status]}</Badge>
                  <Button size="sm" variant="ghost" onClick={() => setCancelling({ id: r.recordId, label: `${label}, ${formatSessionDate(r.data.sessionDate)}` })}>
                    Cancel
                  </Button>
                </li>
              )
            })}
          </ul>
        )}
        <p className="mt-3 text-xs text-muted-foreground">
          When a volunteer books or confirms, you get a note in your <Link to="/inbox" className="underline">inbox</Link>.
        </p>
      </Section>

      <Section title="Request a session" description="No student names or details. Class-level facts only.">
        <Panel>
          <form onSubmit={submit} className="grid gap-5 sm:grid-cols-2">
            <Field label="Grade" htmlFor="grade">
              <Select value={form.grade} onValueChange={(v) => set('grade', v)}>
                <SelectTrigger id="grade">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {GRADES.map((g) => (
                    <SelectItem key={g} value={g}>
                      Grade {g}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field label="Career area" htmlFor="topic">
              <Select value={form.topic} onValueChange={(v) => set('topic', v as Topic)}>
                <SelectTrigger id="topic">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TOPICS.map((t) => (
                    <SelectItem key={t} value={t}>
                      {TOPIC_LABELS[t]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            {form.topic === 'other' && (
              <div className="sm:col-span-2">
                <Field label="Which career area?" htmlFor="topicOther">
                  <Input id="topicOther" value={form.topicOther} onChange={(e) => set('topicOther', e.target.value)} maxLength={60} required />
                </Field>
              </div>
            )}
            <Field label="Date" htmlFor="sessionDate">
              <Input id="sessionDate" type="date" min={todayInSanDiego()} value={form.sessionDate} onChange={(e) => set('sessionDate', e.target.value)} required />
            </Field>
            <Field label="Time of day" htmlFor="timeBand">
              <Select value={form.timeBand} onValueChange={(v) => set('timeBand', v as TimeBand)}>
                <SelectTrigger id="timeBand">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TIME_BANDS.map((b) => (
                    <SelectItem key={b} value={b}>
                      {TIME_BAND_LABELS[b]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field label="Exact start (optional)" htmlFor="startTime" hint="Shared only with the volunteer who books.">
              <Input id="startTime" type="time" value={form.startTime} onChange={(e) => set('startTime', e.target.value)} />
            </Field>
            <Field label="About how many students? (optional)" htmlFor="expectedHeadcount">
              <Input
                id="expectedHeadcount"
                type="number"
                inputMode="numeric"
                min={1}
                max={200}
                value={form.expectedHeadcount}
                onChange={(e) => set('expectedHeadcount', e.target.value)}
              />
            </Field>
            <Field label="Room (optional)" htmlFor="room" hint="Shared only with the volunteer who books.">
              <Input id="room" value={form.room} onChange={(e) => set('room', e.target.value)} maxLength={40} />
            </Field>
            <div className="sm:col-span-2">
              <Field label="Arrival instructions (optional)" htmlFor="arrivalNote" hint="For example: Sign in at the front office, ask for Room 214.">
                <Textarea id="arrivalNote" rows={2} value={form.arrivalNote} onChange={(e) => set('arrivalNote', e.target.value)} maxLength={300} />
              </Field>
            </div>
            <div className="sm:col-span-2">
              <Field label="Note for the volunteer (optional)" htmlFor="teacherNote" hint="What the class is studying, questions they have. No student names.">
                <Textarea id="teacherNote" rows={3} value={form.teacherNote} onChange={(e) => set('teacherNote', e.target.value)} maxLength={300} />
              </Field>
            </div>
            <div className="sm:col-span-2">
              <Button type="submit" loading={saving} disabled={!form.sessionDate || (form.topic === 'other' && !form.topicOther.trim())}>
                Post request
              </Button>
            </div>
          </form>
        </Panel>
      </Section>

      {earlier.length > 0 && (
        <Section title="Earlier and cancelled">
          <ul className="divide-y divide-border rounded-md border border-border bg-card">
            {earlier.map((r) => (
              <li key={r.recordId} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-sm">
                <span>
                  {formatSessionDate(r.data.sessionDate)} · Grade {r.data.grade} · {topicText(r.data.topic, r.data.topicOther)}
                </span>
                <span className="text-muted-foreground">{SESSION_STATUS_LABELS[r.data.status]}</span>
              </li>
            ))}
          </ul>
        </Section>
      )}

      <Modal open={!!cancelling} onClose={() => !busy && setCancelling(null)} size="sm">
        <Modal.Header>
          <Modal.Title>Cancel {cancelling?.label}?</Modal.Title>
          <Modal.Description>If a volunteer booked it, they’re told right away. This can’t be undone.</Modal.Description>
        </Modal.Header>
        <Modal.Body>
          <Field label="Reason (shared with the volunteer, optional)" htmlFor="cancelReason">
            <Textarea id="cancelReason" rows={2} value={cancelReason} onChange={(e) => setCancelReason(e.target.value)} maxLength={300} />
          </Field>
        </Modal.Body>
        <Modal.Footer>
          <Button variant="ghost" onClick={() => setCancelling(null)} disabled={busy}>
            Keep session
          </Button>
          <Button variant="destructive" onClick={cancel} loading={busy}>
            Cancel session
          </Button>
        </Modal.Footer>
      </Modal>
    </Page>
  )
}

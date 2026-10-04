/**
 * My teachers — where a volunteer works with the schools they're booked at (D15).
 *
 * One card per teacher the volunteer currently has a booking with: school and
 * address, an Email button (opens their own mail app), and the upcoming sessions
 * with that teacher, each opening the full session in My sessions. Everything
 * comes from the private session rows the volunteer can read as the booked
 * collaborator — no other teachers' contacts are visible.
 */
import { Link } from 'react-router-dom'
import { useQuery } from 'deepspace'
import { Badge, EmptyState } from '@/components/ui'
import { ErrorNote, Loading, Page } from '../../../components/Page'
import { formatSessionDate, sessionTimeText, todaySeconds, topicText } from '../../../lib/labels'
import { useMe } from '../../../lib/me'
import { useSchools, fullAddress } from '../../../lib/schools'
import { Directions } from '../../../components/Directions'
import type { TimeBand } from '../../../schemas/shared'

interface ClaimRow {
  sessionId: string
  volunteerId: string
  status: string
  confirmedAt: number | null
}
interface SessionRow {
  teacherId: string
  grade: string
  topic: string
  topicOther: string
  sessionDate: number
  timeBand: TimeBand
  status: string
  schoolId?: string
}
interface DetailsRow {
  sessionId: string
  teacherName?: string
  teacherEmail?: string
  teacherPhone?: string
  startTime?: string
  classLabel?: string
  studentCount?: number | null
  readyAt?: number | null
}

export default function MyTeachersPage() {
  const me = useMe()
  const claims = useQuery<ClaimRow>('claims', { where: { volunteerId: me.userId ?? '__none__', status: 'active' }, limit: 100 })
  const sessions = useQuery<SessionRow>('session_requests', { limit: 500 })
  const details = useQuery<DetailsRow>('session_details', { limit: 100 })
  const { byId: schoolById } = useSchools()

  if (!me.ready || claims.status === 'loading' || sessions.status === 'loading' || details.status === 'loading') return <Loading />
  const error = claims.error || sessions.error || details.error

  const sessionById = new Map(sessions.records.map((r) => [r.recordId, r.data]))
  const detailsById = new Map(details.records.map((r) => [r.data.sessionId, r.data]))
  const today = todaySeconds()

  // Group upcoming bookings by teacher.
  const byTeacher = new Map<string, { teacherId: string; name: string; email: string; phone: string; schoolId: string; items: { id: string; s: SessionRow; d?: DetailsRow; confirmed: boolean }[] }>()
  for (const c of claims.records) {
    const s = sessionById.get(c.data.sessionId)
    if (!s || s.sessionDate < today || s.status === 'cancelled') continue
    const d = detailsById.get(c.data.sessionId)
    const entry = byTeacher.get(s.teacherId) ?? { teacherId: s.teacherId, name: d?.teacherName || 'Teacher', email: d?.teacherEmail || '', phone: d?.teacherPhone || '', schoolId: s.schoolId ?? '', items: [] }
    if (!entry.email && d?.teacherEmail) entry.email = d.teacherEmail
    if (!entry.phone && d?.teacherPhone) entry.phone = d.teacherPhone
    entry.items.push({ id: c.data.sessionId, s, d, confirmed: !!c.data.confirmedAt })
    byTeacher.set(s.teacherId, entry)
  }
  const teachers = [...byTeacher.values()].sort((a, b) => a.name.localeCompare(b.name))

  return (
    <Page title="My teachers" intro="The teachers you’re visiting. Email them about the class, the room or what to bring.">
      {error && <ErrorNote message={error} />}
      {teachers.length === 0 ? (
        <EmptyState title="No teachers yet" description="Once you’re booked for a session, its teacher appears here with their school and email." />
      ) : (
        <ul className="space-y-4">
          {teachers.map((t) => {
            const school = schoolById.get(t.schoolId)
            const subject = encodeURIComponent('Career session')
            return (
              <li key={t.teacherId} className="rounded-md border border-border bg-card p-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h2 className="font-display text-xl font-semibold">{t.name}</h2>
                    <p className="text-sm text-muted-foreground">
                      {school ? [school.name, fullAddress(school)].filter(Boolean).join(', ') : 'School not set'}
                      {school ? (
                        <>
                          {' · '}
                          <Directions school={school} />
                        </>
                      ) : null}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                  {t.phone ? (
                    <a
                      href={`tel:${t.phone.replace(/[^0-9+]/g, '')}`}
                      className="inline-flex h-9 items-center rounded-md border border-border px-4 text-sm font-semibold hover:bg-accent"
                    >
                      Call {t.phone}
                    </a>
                  ) : null}
                  {t.email ? (
                    <a
                      href={`mailto:${t.email}?subject=${subject}`}
                      className="inline-flex h-9 items-center rounded-md bg-primary px-4 text-sm font-semibold text-primary-foreground hover:bg-primary/90"
                    >
                      Email {t.name.split(' ')[0]}
                    </a>
                  ) : null}
                  </div>
                </div>
                <ul className="mt-4 divide-y divide-border border-t border-border">
                  {t.items
                    .sort((a, b) => a.s.sessionDate - b.s.sessionDate)
                    .map(({ id, s, d, confirmed }) => (
                      <li key={id}>
                        <Link to={`/my-sessions?session=${encodeURIComponent(id)}`} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-3 text-sm hover:bg-accent">
                          <span className="font-medium tabular-nums">{formatSessionDate(s.sessionDate)}</span>
                          <span className="text-muted-foreground">{sessionTimeText(s.timeBand, d?.startTime)}</span>
                          <span>
                            {topicText(s.topic, s.topicOther)} · Grade {s.grade}
                            {d?.classLabel ? ` · ${d.classLabel}` : ''}
                            {d?.studentCount ? ` · ${d.studentCount} students` : ''}
                          </span>
                          {confirmed ? <Badge variant="success" size="sm">Confirmed</Badge> : <Badge variant="warning" size="sm">Please confirm</Badge>}
                          {d?.readyAt ? <Badge variant="success" size="sm">Class ready</Badge> : null}
                          <span className="ml-auto text-xs font-medium text-primary">Open</span>
                        </Link>
                      </li>
                    ))}
                </ul>
              </li>
            )
          })}
        </ul>
      )}
    </Page>
  )
}

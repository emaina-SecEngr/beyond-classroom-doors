/**
 * Staff desk — program staff (DeepSpace admins) only (M4, M9, SH7).
 *
 *   Sessions         what each upcoming session still needs (staff's day job)
 *   Volunteers       everyone's status at a glance (read-only)
 *   Teachers         give or remove teacher access
 *   Change requests  late cancellations and reschedules from volunteers
 *   Audit log        every privileged action, append-only
 *
 * Approving volunteers, managing staff and delegating approvals live on the
 * Approvals page (/approvals) — the program admin's view (D3b, R6, R7).
 * Staff read these collections directly (admin read: true); every write is a
 * server action that re-checks on the server.
 */
import { useState } from 'react'
import { useQuery, useUsers } from 'deepspace'
import { useSearchParams } from 'react-router-dom'
import {
  Badge,
  Button,
  ConfirmModal,
  EmptyState,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  useToast,
} from '@/components/ui'
import { ErrorNote, Fact, Loading, Page } from '../../../components/Page'
import { AuditLog } from '../../../components/admin/AuditLog'
import type { Person, StatusRow } from '../../../components/admin/shared'
import { SessionDetailsModal, type EditableDetails } from '../../../components/SessionDetailsModal'
import { callAction } from '../../../lib/actions'
import {
  formatDay,
  formatInstant,
  formatSessionDate,
  PROGRAM_EMAIL,
  SESSION_STATUS_BADGE,
  SESSION_STATUS_LABELS,
  sessionTimeText,
  todaySeconds,
  topicText,
  VOLUNTEER_STATUS_BADGE,
  VOLUNTEER_STATUS_LABELS,
} from '../../../lib/labels'
import { useMe, type ProfileRow } from '../../../lib/me'
import { useSchools } from '../../../lib/schools'
import { type AppRole, type SessionStatus, type TimeBand } from '../../../schemas/shared'

interface ChangeRow {
  sessionId: string
  volunteerId: string
  kind: 'cancel' | 'reschedule'
  note: string
  status: 'open' | 'resolved'
}

const ROLE_LABELS: Record<AppRole, string> = { teacher: 'Teacher' }
const roleLabel = (r: string) => ROLE_LABELS[r as AppRole] ?? 'Retired role'

export default function StaffPage() {
  const me = useMe()
  if (!me.ready) return <Loading />
  if (!me.isStaff) {
    return (
      <Page title="Staff desk">
        <EmptyState title="Program staff only" description="This desk is for the nonprofit’s program staff." />
      </Page>
    )
  }
  return <StaffDesk />
}

function StaffDesk() {
  const statuses = useQuery<StatusRow>('volunteer_status', { limit: 500 })
  const profiles = useQuery<ProfileRow>('profiles', { limit: 500 })
  const { users, usersLoaded } = useUsers()
  const [params] = useSearchParams()
  const [tab, setTab] = useState<string | null>(null)

  const profileById = new Map(profiles.records.map((r) => [r.data.userId, r.data]))
  const nameOf = (id: string) => profileById.get(id)?.displayName || users.find((u) => u.id === id)?.name || 'Unknown user'

  return (
    <Page title="Staff desk" intro="Work with teachers so every session is ready for its volunteer, and keep an eye on changes." wide>
      <Tabs value={tab ?? params.get('tab') ?? 'sessions'} onValueChange={(v) => setTab(String(v))}>
        <TabsList className="flex-wrap">
          <TabsTrigger value="sessions">Sessions</TabsTrigger>
          <TabsTrigger value="volunteers">Volunteers</TabsTrigger>
          <TabsTrigger value="roles">Teachers</TabsTrigger>
          <TabsTrigger value="changes">Change requests</TabsTrigger>
          <TabsTrigger value="audit">Audit log</TabsTrigger>
        </TabsList>

        <TabsContent value="sessions" className="pt-6">
          <Sessions nameOf={nameOf} />
        </TabsContent>

        <TabsContent value="volunteers" className="pt-6">
          <p className="mb-4 text-sm text-muted-foreground">Volunteers are approved by the program admin, or by staff the admin has delegated to.</p>
          {statuses.status === 'loading' ? (
            <Loading />
          ) : statuses.status === 'error' ? (
            <ErrorNote message={statuses.error || 'Could not load volunteers.'} />
          ) : statuses.records.length === 0 ? (
            <EmptyState title="No volunteers yet" description="People appear here once they submit a profile." />
          ) : (
            <ul className="divide-y divide-border rounded-md border border-border bg-card">
              {statuses.records.map((r) => (
                <li key={r.recordId} className="flex flex-wrap items-center gap-x-6 gap-y-1 px-4 py-3 text-sm">
                  <span className="min-w-0 flex-1 font-medium">{nameOf(r.data.userId)}</span>
                  <span className="text-muted-foreground">{profileById.get(r.data.userId)?.profession || '—'}</span>
                  <span className="text-muted-foreground">Clearance {formatDay(r.data.clearanceExpiresAt ?? null)}</span>
                  <Badge variant={VOLUNTEER_STATUS_BADGE[r.data.status]}>{VOLUNTEER_STATUS_LABELS[r.data.status]}</Badge>
                </li>
              ))}
            </ul>
          )}
        </TabsContent>

        <TabsContent value="roles" className="pt-6">
          {!usersLoaded ? <Loading /> : <Roles users={users.map((u) => ({ id: u.id, name: u.name, email: u.email ?? '', platformRole: u.role }))} />}
        </TabsContent>

        <TabsContent value="changes" className="pt-6">
          <ChangeRequests nameOf={nameOf} />
        </TabsContent>

        <TabsContent value="audit" className="pt-6">
          <AuditLog nameOf={nameOf} />
        </TabsContent>
      </Tabs>
    </Page>
  )
}

// ── People & roles ───────────────────────────────────────────────────────────

function Roles({ users }: { users: Person[] }) {
  const toast = useToast()
  const roles = useQuery<{ userId: string; role: AppRole; schoolId?: string }>('role_assignments', { limit: 500 })
  const { schools, byId: schoolById } = useSchools()
  const [removing, setRemoving] = useState<Person | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [pick, setPick] = useState<Record<string, string>>({})

  const assignmentById = new Map(roles.records.map((r) => [r.data.userId, r.data]))
  const activeSchools = schools.filter((s) => s.active)

  async function assign(p: Person, schoolId: string) {
    setBusyId(p.id)
    const res = await callAction('assignRole', { userId: p.id, role: 'teacher', schoolId })
    setBusyId(null)
    if (res.success) toast.success(`${p.name || p.email} teaches at ${schoolById.get(schoolId)?.name ?? 'the school'}`)
    else toast.error('Could not assign the role', res.error)
  }

  async function remove() {
    if (!removing) return
    setBusyId(removing.id)
    const res = await callAction('removeRole', { userId: removing.id })
    setBusyId(null)
    if (res.success) {
      toast.success('Access removed')
      setRemoving(null)
    } else toast.error('Could not remove access', res.error)
  }

  if (users.length === 0) return <EmptyState title="No one has signed in yet" description="People appear here after their first sign-in." />

  return (
    <>
      <p className="mb-4 text-sm text-muted-foreground">
        Give teachers access at their school. Their session requests show that school. Volunteers need no role.
      </p>
      {activeSchools.length === 0 && (
        <p className="mb-4 rounded-md border border-warning/50 bg-warning/10 p-3 text-sm">
          No active schools yet. The program admin adds schools on the Approvals page, under Schools.
        </p>
      )}
      <ul className="divide-y divide-border rounded-md border border-border bg-card">
        {users.map((p) => {
          const a = assignmentById.get(p.id)
          const current = a?.role
          const school = a?.schoolId ? schoolById.get(a.schoolId) : undefined
          const chosen = pick[p.id] ?? ''
          return (
            <li key={p.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{p.name || '—'}</p>
                <p className="truncate text-xs text-muted-foreground">{p.email}</p>
              </div>
              {p.platformRole === 'admin' && <Badge variant="secondary">Program staff</Badge>}
              {current && (
                <Badge variant="info">
                  {roleLabel(current)}
                  {current === 'teacher' ? ` · ${school?.name ?? 'no school set'}` : ''}
                </Badge>
              )}
              <div className="flex flex-wrap items-center gap-2">
                {activeSchools.length > 0 && (
                  <>
                    <Select value={chosen} onValueChange={(v) => setPick((m) => ({ ...m, [p.id]: v }))}>
                      <SelectTrigger className="w-52" aria-label={`School for ${p.name || p.email}`}>
                        <SelectValue placeholder={current === 'teacher' ? 'Move to school…' : 'Choose a school'} />
                      </SelectTrigger>
                      <SelectContent>
                        {activeSchools.map((s) => (
                          <SelectItem key={s.id} value={s.id}>
                            {s.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => void assign(p, chosen)}
                      loading={busyId === p.id}
                      disabled={!chosen || (current === 'teacher' && chosen === a?.schoolId)}
                    >
                      {current === 'teacher' ? 'Move' : 'Make teacher'}
                    </Button>
                  </>
                )}
                {current && (
                  <Button size="sm" variant="ghost" onClick={() => setRemoving(p)}>
                    Remove
                  </Button>
                )}
              </div>
            </li>
          )
        })}
      </ul>
      <ConfirmModal
        open={!!removing}
        onClose={() => busyId === null && setRemoving(null)}
        onConfirm={() => void remove()}
        title={removing ? `Remove ${removing.name || removing.email}’s teacher access?` : 'Remove access?'}
        description="They keep their account but lose the teacher desk. Sessions they already posted stay."
        confirmText="Remove access"
        loading={busyId !== null}
      />
    </>
  )
}

// ── Sessions: is each upcoming session ready for its volunteer? ─────────────

interface SessionRow {
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
interface DetailsRow {
  sessionId: string
  room: string
  startTime: string
  arrivalNote: string
  teacherNote: string
}
interface ClaimRow {
  sessionId: string
  volunteerId: string
  status: 'active' | 'withdrawn'
  confirmedAt: number | null
}

/** What still stands between this session and a volunteer walking into the room. */
function missingFor(s: SessionRow, d: DetailsRow | undefined, claim: ClaimRow | undefined): string[] {
  const out: string[] = []
  if (!claim) out.push('No volunteer yet')
  else if (!claim.confirmedAt) out.push('Volunteer hasn’t confirmed')
  if (!d?.room) out.push('No room')
  if (!d?.arrivalNote) out.push('No arrival instructions')
  if (!d?.startTime) out.push('No exact start time')
  return s.status === 'cancelled' ? [] : out
}

function Sessions({ nameOf }: { nameOf: (id: string) => string }) {
  const sessions = useQuery<SessionRow>('session_requests', { limit: 500 })
  const { byId: schoolById } = useSchools()
  const details = useQuery<DetailsRow>('session_details', { limit: 500 })
  const claims = useQuery<ClaimRow>('claims', { where: { status: 'active' }, limit: 500 })
  const [editing, setEditing] = useState<EditableDetails | null>(null)

  if (sessions.status === 'loading' || details.status === 'loading' || claims.status === 'loading') return <Loading />
  if (sessions.status === 'error') return <ErrorNote message={sessions.error || 'Could not load sessions.'} />

  const detailsById = new Map(details.records.map((r) => [r.data.sessionId, r.data]))
  const claimBySession = new Map(claims.records.map((r) => [r.data.sessionId, r.data]))
  const today = todaySeconds()
  const upcoming = sessions.records
    .filter((r) => r.data.sessionDate >= today && r.data.status !== 'cancelled' && r.data.status !== 'completed')
    .sort((a, b) => a.data.sessionDate - b.data.sessionDate)

  if (upcoming.length === 0) return <EmptyState title="No upcoming sessions" description="Sessions appear here as teachers post requests." />

  const readyCount = upcoming.filter((r) => missingFor(r.data, detailsById.get(r.recordId), claimBySession.get(r.recordId)).length === 0).length

  return (
    <>
      <p className="mb-4 text-sm text-muted-foreground">
        {readyCount} of {upcoming.length} upcoming session{upcoming.length === 1 ? '' : 's'} ready. Work with the teacher to fill any gaps; the booked volunteer is told about every change.
      </p>
      <ul className="space-y-3">
        {upcoming.map((r) => {
          const d = detailsById.get(r.recordId)
          const claim = claimBySession.get(r.recordId)
          const missing = missingFor(r.data, d, claim)
          const label = `Grade ${r.data.grade} · ${topicText(r.data.topic, r.data.topicOther)}`
          return (
            <li key={r.recordId} className="rounded-md border border-border bg-card p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-medium">{label}</p>
                  <p className="text-sm text-muted-foreground">
                    {schoolById.get(r.data.schoolId ?? '')?.name ?? 'School not set'} · {formatSessionDate(r.data.sessionDate)},{' '}
                    {sessionTimeText(r.data.timeBand, d?.startTime)} · Teacher: {nameOf(r.data.teacherId)}
                  </p>
                  <p className="text-sm text-muted-foreground">Volunteer: {claim ? nameOf(claim.volunteerId) : '—'}</p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant={SESSION_STATUS_BADGE[r.data.status]}>{SESSION_STATUS_LABELS[r.data.status]}</Badge>
                  {missing.length === 0 ? <Badge variant="success">Ready</Badge> : <Badge variant="warning">{missing.length} to do</Badge>}
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() =>
                      setEditing({
                        sessionId: r.recordId,
                        label: `${label}, ${formatSessionDate(r.data.sessionDate)}`,
                        room: d?.room ?? '',
                        startTime: d?.startTime ?? '',
                        arrivalNote: d?.arrivalNote ?? '',
                        teacherNote: d?.teacherNote ?? '',
                      })
                    }
                  >
                    Details
                  </Button>
                </div>
              </div>
              {missing.length > 0 && (
                <ul className="mt-3 flex flex-wrap gap-2 text-xs">
                  {missing.map((m) => (
                    <li key={m} className="rounded border border-border px-2 py-0.5 text-muted-foreground">
                      {m}
                    </li>
                  ))}
                </ul>
              )}
            </li>
          )
        })}
      </ul>
      <SessionDetailsModal details={editing} onClose={() => setEditing(null)} />
    </>
  )
}

// ── Change requests ──────────────────────────────────────────────────────────

function ChangeRequests({ nameOf }: { nameOf: (id: string) => string }) {
  const { records, status, error } = useQuery<ChangeRow>('change_requests', { limit: 200 })
  if (status === 'loading') return <Loading />
  if (status === 'error') return <ErrorNote message={error || 'Could not load change requests.'} />
  const rows = [...records].sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  if (rows.length === 0) return <EmptyState title="No change requests" description="Volunteers send these when it’s too late to withdraw themselves." />
  return (
    <>
      <p className="mb-4 text-sm text-muted-foreground">
        Follow up with the volunteer and the teacher directly. Volunteers may also email {PROGRAM_EMAIL}.
      </p>
      <ul className="space-y-3">
        {rows.map((r) => (
          <li key={r.recordId} className="rounded-md border border-border bg-card p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="font-medium">
                {nameOf(r.data.volunteerId)} asks to {r.data.kind}
              </p>
              <Badge variant={r.data.status === 'open' ? 'warning' : 'secondary'}>{r.data.status === 'open' ? 'Open' : 'Resolved'}</Badge>
            </div>
            <dl className="mt-2 space-y-1">
              <Fact label="Sent">{formatInstant(r.createdAt)}</Fact>
              {r.data.note && <Fact label="Note">{r.data.note}</Fact>}
            </dl>
          </li>
        ))}
      </ul>
    </>
  )
}


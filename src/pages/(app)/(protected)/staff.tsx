/**
 * Staff desk — program staff (DeepSpace admins) only (M2, M4, M9, R6, R7).
 *
 *   Sessions         what each upcoming session still needs (staff's day job)
 *   Applicants       the vetting queue; only the nonprofit admin vets, or staff
 *                    the admin has asked for help (time-boxed, R7)
 *   Volunteers       everyone's status at a glance
 *   People & roles   program staff (nonprofit admin only), teachers (staff),
 *                    board approvers (nonprofit admin only)
 *   Change requests  late cancellations and reschedules from volunteers
 *   Audit log        every privileged action, append-only
 *
 * Staff read these collections directly (admin read: true); every write is a
 * server action (or the worker's set-role guard) that re-checks on the server.
 * `myAccess` only decides what to SHOW.
 */
import { useEffect, useState } from 'react'
import { useQuery, useUsers } from 'deepspace'
import {
  Badge,
  Button,
  Checkbox,
  ConfirmModal,
  EmptyState,
  Input,
  Modal,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  Textarea,
  useToast,
} from '@/components/ui'
import { ErrorNote, Fact, Field, Loading, Page } from '../../../components/Page'
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
  todayInSanDiego,
  todaySeconds,
  topicText,
  VOLUNTEER_STATUS_BADGE,
  VOLUNTEER_STATUS_LABELS,
} from '../../../lib/labels'
import { useMe, type ProfileRow, type VolunteerStatusRow } from '../../../lib/me'
import { VETTING_HELP_DEFAULT_DAYS, VETTING_HELP_MAX_DAYS, type AppRole, type SessionStatus, type TimeBand } from '../../../schemas/shared'

interface StatusRow extends VolunteerStatusRow {
  identityConfirmed?: boolean | number
  qualificationType?: string
  clearanceExpiresAt?: number | null
}
interface AuditRow {
  actorId: string
  action: string
  targetType: string
  targetId: string
  fromState: string
  toState: string
  reason: string
}
interface ChangeRow {
  sessionId: string
  volunteerId: string
  kind: 'cancel' | 'reschedule'
  note: string
  status: 'open' | 'resolved'
}

const ROLE_LABELS: Record<AppRole, string> = { teacher: 'Teacher', board_member: 'Program Admin' }

interface Access {
  nonprofitAdmin: boolean
  canVet: boolean
  vettingHelpEndsAt: number | null
}
const NO_ACCESS: Access = { nonprofitAdmin: false, canVet: false, vettingHelpEndsAt: null }

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
  const { users, usersLoaded, setRole } = useUsers()
  const [access, setAccess] = useState<Access | null>(null)

  // Display only: the server re-checks every one of these on every action.
  useEffect(() => {
    let live = true
    void callAction<Access>('myAccess').then((r) => {
      if (live) setAccess(r.success ? r.data : NO_ACCESS)
    })
    return () => {
      live = false
    }
  }, [])

  const profileById = new Map(profiles.records.map((r) => [r.data.userId, r.data]))
  const nameOf = (id: string) => profileById.get(id)?.displayName || users.find((u) => u.id === id)?.name || 'Unknown user'
  const queue = statuses.records.filter((r) => r.data.status === 'applied' || r.data.status === 'renewal_pending')

  return (
    <Page title="Staff desk" intro="Work with teachers so every session is ready for its volunteer, and keep an eye on changes." wide>
      <Tabs defaultValue="sessions">
        <TabsList className="flex-wrap">
          <TabsTrigger value="sessions">Sessions</TabsTrigger>
          <TabsTrigger value="applicants">Applicants{queue.length ? ` (${queue.length})` : ''}</TabsTrigger>
          <TabsTrigger value="volunteers">Volunteers</TabsTrigger>
          <TabsTrigger value="roles">People &amp; roles</TabsTrigger>
          <TabsTrigger value="changes">Change requests</TabsTrigger>
          <TabsTrigger value="audit">Audit log</TabsTrigger>
        </TabsList>

        <TabsContent value="sessions" className="pt-6">
          <Sessions nameOf={nameOf} />
        </TabsContent>

        <TabsContent value="applicants" className="pt-6">
          {statuses.status === 'loading' || profiles.status === 'loading' || access === null ? (
            <Loading />
          ) : statuses.status === 'error' ? (
            <ErrorNote message={statuses.error || 'Could not load applicants.'} />
          ) : (
            <Applicants access={access} queue={queue.map((r) => ({ ...r.data, profile: profileById.get(r.data.userId) ?? null }))} />
          )}
        </TabsContent>

        <TabsContent value="volunteers" className="pt-6">
          {statuses.status === 'loading' ? (
            <Loading />
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
          {!usersLoaded || access === null ? (
            <Loading />
          ) : (
            <>
              <ProgramStaff access={access} people={users.map((u) => ({ id: u.id, name: u.name, email: u.email ?? '', platformRole: u.role }))} setRole={setRole} />
              <Roles nonprofitAdmin={access.nonprofitAdmin} users={users.map((u) => ({ id: u.id, name: u.name, email: u.email ?? '', platformRole: u.role }))} />
            </>
          )}
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

// ── Applicants: vetting (first key) ──────────────────────────────────────────

type Applicant = StatusRow & { profile: ProfileRow | null }

const EMPTY_VET = {
  identityConfirmed: false,
  qualificationType: '',
  licenseNumber: '',
  licenseCheckedAt: '',
  clearanceCompletedAt: '',
  clearanceExpiresAt: '',
  reason: '',
}

function Applicants({ queue, access }: { queue: Applicant[]; access: Access }) {
  const toast = useToast()
  const [open, setOpen] = useState<Applicant | null>(null)
  const [form, setForm] = useState(EMPTY_VET)
  const [busy, setBusy] = useState(false)
  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) => setForm((f) => ({ ...f, [k]: v }))

  if (queue.length === 0) return <EmptyState title="No one waiting" description="New volunteer applications appear here." />

  const notice = !access.canVet
    ? 'Vetting is done by the nonprofit admin. You can see who’s waiting; the admin can ask you to help if they need to.'
    : access.vettingHelpEndsAt
      ? `The nonprofit admin asked you to help with vetting until ${formatInstant(access.vettingHelpEndsAt)}.`
      : null

  async function decide(outcome: 'vetted' | 'rejected') {
    if (!open) return
    setBusy(true)
    const res = await callAction('vetVolunteer', { userId: open.userId, outcome, ...form })
    setBusy(false)
    if (!res.success) {
      toast.error('That didn’t go through', res.error)
      return
    }
    toast.success(outcome === 'vetted' ? 'Marked as vetted' : 'Application rejected', outcome === 'vetted' ? 'The Program Admin gives the final approval.' : undefined)
    setOpen(null)
    setForm(EMPTY_VET)
  }

  const name = open?.profile?.displayName ?? 'this volunteer'

  return (
    <>
      {notice && <p className="mb-4 rounded-md border border-border bg-card p-4 text-sm text-muted-foreground">{notice}</p>}
      <ul className="space-y-3">
        {queue.map((a) => (
          <li key={a.userId} className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-border bg-card p-4">
            <div className="min-w-0">
              <p className="font-medium">{a.profile?.displayName ?? 'Unknown'}</p>
              <p className="text-sm text-muted-foreground">
                {a.profile?.profession || '—'}
                {a.profile?.employer ? ` · ${a.profile.employer}` : ''}
              </p>
            </div>
            <div className="flex items-center gap-3">
              <Badge variant={VOLUNTEER_STATUS_BADGE[a.status]}>{VOLUNTEER_STATUS_LABELS[a.status]}</Badge>
              {access.canVet && (
                <Button
                  size="sm"
                  onClick={() => {
                    setForm(EMPTY_VET)
                    setOpen(a)
                  }}
                >
                  Review
                </Button>
              )}
            </div>
          </li>
        ))}
      </ul>

      <Modal open={!!open} onClose={() => !busy && setOpen(null)} size="lg">
        <Modal.Header>
          <Modal.Title>Vet {name}</Modal.Title>
          <Modal.Description>
            {open?.profile?.profession}
            {open?.profile?.employer ? ` · ${open.profile.employer}` : ''}. Record what you checked; the Program Admin sees a summary.
          </Modal.Description>
        </Modal.Header>
        <Modal.Body>
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="flex items-start gap-3 text-sm sm:col-span-2">
              <Checkbox checked={form.identityConfirmed} onCheckedChange={(c) => set('identityConfirmed', c)} />
              <span>I confirmed this person’s identity (government photo ID, in person or by video).</span>
            </label>
            <Field label="Qualification" htmlFor="qualificationType" hint="For example: RN license, PE license, journeyman card, none required.">
              <Input id="qualificationType" value={form.qualificationType} onChange={(e) => set('qualificationType', e.target.value)} maxLength={80} />
            </Field>
            <Field label="License number (if any)" htmlFor="licenseNumber">
              <Input id="licenseNumber" value={form.licenseNumber} onChange={(e) => set('licenseNumber', e.target.value)} maxLength={40} />
            </Field>
            <Field label="License checked on" htmlFor="licenseCheckedAt">
              <Input id="licenseCheckedAt" type="date" max={todayInSanDiego()} value={form.licenseCheckedAt} onChange={(e) => set('licenseCheckedAt', e.target.value)} />
            </Field>
            <Field label="Clearance completed on" htmlFor="clearanceCompletedAt" hint="TB test and background check.">
              <Input id="clearanceCompletedAt" type="date" max={todayInSanDiego()} value={form.clearanceCompletedAt} onChange={(e) => set('clearanceCompletedAt', e.target.value)} />
            </Field>
            <Field label="Clearance valid until" htmlFor="clearanceExpiresAt" hint="Required to vet.">
              <Input id="clearanceExpiresAt" type="date" min={todayInSanDiego()} value={form.clearanceExpiresAt} onChange={(e) => set('clearanceExpiresAt', e.target.value)} />
            </Field>
            <div className="sm:col-span-2">
              <Field label="Note or reason" htmlFor="vetReason" hint="Required to reject. The volunteer sees a rejection reason.">
                <Textarea id="vetReason" rows={2} value={form.reason} onChange={(e) => set('reason', e.target.value)} maxLength={500} />
              </Field>
            </div>
          </div>
        </Modal.Body>
        <Modal.Footer>
          <Button variant="ghost" onClick={() => setOpen(null)} disabled={busy}>
            Close
          </Button>
          <Button variant="outline" onClick={() => void decide('rejected')} disabled={busy || !form.reason.trim()}>
            Reject
          </Button>
          <Button onClick={() => void decide('vetted')} loading={busy} disabled={!form.identityConfirmed || !form.clearanceExpiresAt}>
            Mark vetted
          </Button>
        </Modal.Footer>
      </Modal>
    </>
  )
}

// ── Program staff (decision R6) ──────────────────────────────────────────────
//
// Only the nonprofit admin (the app's owner) can grant or remove staff. The page
// asks the server who you are (myAccess) only to decide what to show; the worker
// (AppRecordRoom + staff-guard.ts) refuses anyone else and audits every change.

function ProgramStaff({ people, setRole, access }: { people: Person[]; setRole: (userId: string, role: string) => void; access: Access }) {
  const toast = useToast()
  const me = useMe()
  const isNonprofitAdmin = access.nonprofitAdmin
  const help = useQuery<{ userId: string; endsAt: number; reason: string }>('vetting_help', { limit: 200 })
  const [confirming, setConfirming] = useState<{ person: Person; role: 'admin' | 'member' } | null>(null)
  const [pending, setPending] = useState<{ id: string; role: 'admin' | 'member'; name: string } | null>(null)
  const [asking, setAsking] = useState<Person | null>(null)
  const [helpDays, setHelpDays] = useState(String(VETTING_HELP_DEFAULT_DAYS))
  const [helpReason, setHelpReason] = useState('')
  const [ending, setEnding] = useState<Person | null>(null)
  const [busy, setBusy] = useState(false)

  const now = Date.now() / 1000
  const helpUntil = new Map(help.records.filter((r) => r.data.endsAt > now).map((r) => [r.data.userId, r.data.endsAt]))

  async function askForHelp() {
    if (!asking) return
    setBusy(true)
    const res = await callAction('grantVettingHelp', { userId: asking.id, days: Number(helpDays), reason: helpReason })
    setBusy(false)
    if (!res.success) {
      toast.error('Could not ask for help', res.error)
      return
    }
    toast.success(`${asking.name || asking.email} can help with vetting`, `For ${helpDays} day${helpDays === '1' ? '' : 's'}. You can end it any time.`)
    setAsking(null)
    setHelpReason('')
    setHelpDays(String(VETTING_HELP_DEFAULT_DAYS))
  }

  async function endHelp() {
    if (!ending) return
    setBusy(true)
    const res = await callAction('endVettingHelp', { userId: ending.id })
    setBusy(false)
    if (!res.success) {
      toast.error('Could not end help', res.error)
      return
    }
    toast.success('Vetting help ended')
    setEnding(null)
  }

  // setRole is fire-and-forget over the realtime connection, so we confirm the change
  // by watching the live user list, and report a failure if it doesn't land in time.
  useEffect(() => {
    if (!pending) return
    const person = people.find((p) => p.id === pending.id)
    if (person?.platformRole === pending.role) {
      toast.success(pending.role === 'admin' ? `${pending.name} is now program staff` : `${pending.name} is no longer program staff`)
      setPending(null)
      return
    }
    const t = setTimeout(() => {
      toast.error('The change didn’t go through', 'Refresh and try again.')
      setPending(null)
    }, 10000)
    return () => clearTimeout(t)
  }, [pending, people, toast])

  if (!isNonprofitAdmin) {
    return (
      <p className="mb-6 rounded-md border border-border bg-card p-4 text-sm text-muted-foreground">
        Only the nonprofit admin can add or remove program staff.
      </p>
    )
  }

  const others = people.filter((p) => p.id !== me.userId)

  return (
    <section className="mb-8">
      <h3 className="font-semibold">Program staff</h3>
      <p className="mt-1 text-sm text-muted-foreground">
        Staff work with teachers so sessions are ready. You vet volunteers; if you need a hand, ask a staff member to help for a set time. Only you can add or remove staff. Every change is in the audit log.
      </p>
      {others.length === 0 ? (
        <p className="mt-3 text-sm text-muted-foreground">No one else has signed in yet.</p>
      ) : (
        <ul className="mt-3 divide-y divide-border rounded-md border border-border bg-card">
          {others.map((p) => {
            const isStaff = p.platformRole === 'admin'
            return (
              <li key={p.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{p.name || '—'}</p>
                  <p className="truncate text-xs text-muted-foreground">{p.email}</p>
                </div>
                {isStaff && <Badge variant="secondary">Program staff</Badge>}
                {isStaff && helpUntil.has(p.id) && <Badge variant="info">Helping vet until {formatDay(helpUntil.get(p.id) ?? null)}</Badge>}
                {isStaff &&
                  (helpUntil.has(p.id) ? (
                    <Button size="sm" variant="ghost" onClick={() => setEnding(p)}>
                      End vetting help
                    </Button>
                  ) : (
                    <Button size="sm" variant="outline" onClick={() => setAsking(p)}>
                      Ask to help vet
                    </Button>
                  ))}
                <Button
                  size="sm"
                  variant={isStaff ? 'ghost' : 'outline'}
                  loading={pending?.id === p.id}
                  disabled={!!pending}
                  onClick={() => setConfirming({ person: p, role: isStaff ? 'member' : 'admin' })}
                >
                  {isStaff ? 'Remove staff' : 'Make staff'}
                </Button>
              </li>
            )
          })}
        </ul>
      )}
      <ConfirmModal
        open={!!confirming}
        onClose={() => setConfirming(null)}
        onConfirm={() => {
          if (!confirming) return
          const { person, role } = confirming
          setPending({ id: person.id, role, name: person.name || person.email })
          setRole(person.id, role)
          setConfirming(null)
        }}
        title={
          confirming
            ? confirming.role === 'admin'
              ? `Make ${confirming.person.name || confirming.person.email} program staff?`
              : `Remove ${confirming.person.name || confirming.person.email} from program staff?`
            : 'Change staff access?'
        }
        description={
          confirming?.role === 'admin'
            ? 'They’ll work with teachers on sessions, assign teacher roles, and read the audit log. They can’t vet unless you ask them to help, and staff can never give the Program Admin approval.'
            : 'They’ll lose the staff desk immediately.'
        }
        confirmText={confirming?.role === 'admin' ? 'Make staff' : 'Remove staff'}
        variant={confirming?.role === 'admin' ? 'default' : 'destructive'}
      />
      <Modal open={!!asking} onClose={() => !busy && setAsking(null)} size="sm">
        <Modal.Header>
          <Modal.Title>Ask {asking?.name || asking?.email} to help vet?</Modal.Title>
          <Modal.Description>They can vet volunteers until the help ends. The Program Admin still gives the final approval.</Modal.Description>
        </Modal.Header>
        <Modal.Body>
          <div className="space-y-4">
            <Field label={`For how many days? (1–${VETTING_HELP_MAX_DAYS})`} htmlFor="helpDays">
              <Input id="helpDays" type="number" inputMode="numeric" min={1} max={VETTING_HELP_MAX_DAYS} value={helpDays} onChange={(e) => setHelpDays(e.target.value)} />
            </Field>
            <Field label="Why (recorded in the audit log)" htmlFor="helpReason" hint="For example: I’m travelling Oct 10–20.">
              <Textarea id="helpReason" rows={2} value={helpReason} onChange={(e) => setHelpReason(e.target.value)} maxLength={300} />
            </Field>
          </div>
        </Modal.Body>
        <Modal.Footer>
          <Button variant="ghost" onClick={() => setAsking(null)} disabled={busy}>
            Cancel
          </Button>
          <Button
            onClick={() => void askForHelp()}
            loading={busy}
            disabled={!helpReason.trim() || !(Number(helpDays) >= 1 && Number(helpDays) <= VETTING_HELP_MAX_DAYS)}
          >
            Ask for help
          </Button>
        </Modal.Footer>
      </Modal>
      <ConfirmModal
        open={!!ending}
        onClose={() => !busy && setEnding(null)}
        onConfirm={() => void endHelp()}
        title={`End ${ending?.name || ending?.email || 'this'}’s vetting help?`}
        description="They’ll stop being able to vet right away."
        confirmText="End help"
        loading={busy}
      />
    </section>
  )
}

// ── People & roles ───────────────────────────────────────────────────────────

interface Person {
  id: string
  name: string
  email: string
  platformRole: string
}

function Roles({ users, nonprofitAdmin }: { users: Person[]; nonprofitAdmin: boolean }) {
  const toast = useToast()
  const roles = useQuery<{ userId: string; role: AppRole }>('role_assignments', { limit: 500 })
  const [choice, setChoice] = useState<Record<string, string>>({})
  const [removing, setRemoving] = useState<Person | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)

  const roleById = new Map(roles.records.map((r) => [r.data.userId, r.data.role]))

  async function assign(p: Person) {
    const role = choice[p.id]
    if (!role) return
    setBusyId(p.id)
    const res = await callAction('assignRole', { userId: p.id, role })
    setBusyId(null)
    if (res.success) toast.success(`${p.name || p.email} is now ${ROLE_LABELS[role as AppRole].toLowerCase()}`)
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
        Give teacher access to the school’s teachers.{' '}
        {nonprofitAdmin
          ? 'As the nonprofit admin, you also seat the Program Admin who approves volunteers; a Program Admin can’t be program staff.'
          : 'The Program Admin is seated by the nonprofit admin.'}{' '}
        Volunteers need no role.
      </p>
      <ul className="divide-y divide-border rounded-md border border-border bg-card">
        {users.map((p) => {
          const current = roleById.get(p.id)
          return (
            <li key={p.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{p.name || '—'}</p>
                <p className="truncate text-xs text-muted-foreground">{p.email}</p>
              </div>
              {p.platformRole === 'admin' && <Badge variant="secondary">Program staff</Badge>}
              {current && <Badge variant="info">{ROLE_LABELS[current]}</Badge>}
              <div className="flex items-center gap-2">
                <Select value={choice[p.id] ?? ''} onValueChange={(v) => setChoice((c) => ({ ...c, [p.id]: v }))}>
                  <SelectTrigger className="w-48" aria-label={`Role for ${p.name || p.email}`}>
                    <SelectValue placeholder="Choose a role" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="teacher">Teacher</SelectItem>
                    {nonprofitAdmin && p.platformRole !== 'admin' && <SelectItem value="board_member">Program Admin</SelectItem>}
                  </SelectContent>
                </Select>
                <Button size="sm" variant="outline" onClick={() => void assign(p)} loading={busyId === p.id} disabled={!choice[p.id] || choice[p.id] === current}>
                  Assign
                </Button>
                {current && (current !== 'board_member' || nonprofitAdmin) && (
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
        title={removing ? `Remove ${removing.name || removing.email}’s access?` : 'Remove access?'}
        description="They keep their account but lose the teacher or school-administrator desk."
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
                    {formatSessionDate(r.data.sessionDate)}, {sessionTimeText(r.data.timeBand, d?.startTime)} · Teacher: {nameOf(r.data.teacherId)}
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

// ── Audit log ────────────────────────────────────────────────────────────────

function AuditLog({ nameOf }: { nameOf: (id: string) => string }) {
  const { records, status, error } = useQuery<AuditRow>('audit_log', { limit: 300 })
  if (status === 'loading') return <Loading />
  if (status === 'error') return <ErrorNote message={error || 'Could not load the audit log.'} />
  const rows = [...records].sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  if (rows.length === 0) return <EmptyState title="Nothing recorded yet" description="Every privileged action is recorded here." />
  return (
    <div className="overflow-x-auto rounded-md border border-border bg-card">
      <table className="w-full min-w-[640px] text-left text-sm">
        <thead className="border-b border-border text-xs uppercase tracking-wide text-muted-foreground">
          <tr>
            <th className="px-4 py-2 font-medium">When</th>
            <th className="px-4 py-2 font-medium">Who</th>
            <th className="px-4 py-2 font-medium">Action</th>
            <th className="px-4 py-2 font-medium">Target</th>
            <th className="px-4 py-2 font-medium">Change</th>
            <th className="px-4 py-2 font-medium">Reason</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {rows.map((r) => (
            <tr key={r.recordId}>
              <td className="whitespace-nowrap px-4 py-2 tabular-nums">{formatInstant(r.createdAt)}</td>
              <td className="px-4 py-2">{nameOf(r.data.actorId)}</td>
              <td className="px-4 py-2">{r.data.action.replace(/_/g, ' ')}</td>
              <td className="px-4 py-2">{r.data.targetType === 'volunteer' || r.data.targetType === 'user' ? nameOf(r.data.targetId) : `${r.data.targetType} ${r.data.targetId.slice(0, 8)}`}</td>
              <td className="whitespace-nowrap px-4 py-2 text-muted-foreground">
                {r.data.fromState || '—'} → {r.data.toState || '—'}
              </td>
              <td className="px-4 py-2 text-muted-foreground">{r.data.reason || ''}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

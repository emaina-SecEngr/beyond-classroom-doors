/**
 * Staff desk — program staff (DeepSpace admins) only (M2, M4, M9).
 *
 *   Applicants       vet new volunteers: identity, license, clearance (the first key)
 *   Volunteers       everyone's status at a glance
 *   People & roles   give teacher / school-admin access
 *   Change requests  late cancellations and reschedules from volunteers
 *   Audit log        every privileged action, append-only
 *
 * Staff read these collections directly (admin read: true); every write is a
 * server action that re-checks staff status on the server.
 */
import { useState } from 'react'
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
import { callAction } from '../../../lib/actions'
import { formatDay, formatInstant, PROGRAM_EMAIL, todayInSanDiego, VOLUNTEER_STATUS_BADGE, VOLUNTEER_STATUS_LABELS } from '../../../lib/labels'
import { useMe, type ProfileRow, type VolunteerStatusRow } from '../../../lib/me'
import type { AppRole } from '../../../schemas/shared'

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

const ROLE_LABELS: Record<AppRole, string> = { teacher: 'Teacher', school_admin: 'School administrator' }

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

  const profileById = new Map(profiles.records.map((r) => [r.data.userId, r.data]))
  const nameOf = (id: string) => profileById.get(id)?.displayName || users.find((u) => u.id === id)?.name || 'Unknown user'
  const queue = statuses.records.filter((r) => r.data.status === 'applied' || r.data.status === 'renewal_pending')

  return (
    <Page title="Staff desk" intro="Vet volunteers, give school access, and keep an eye on changes." wide>
      <Tabs defaultValue="applicants">
        <TabsList>
          <TabsTrigger value="applicants">Applicants{queue.length ? ` (${queue.length})` : ''}</TabsTrigger>
          <TabsTrigger value="volunteers">Volunteers</TabsTrigger>
          <TabsTrigger value="roles">People &amp; roles</TabsTrigger>
          <TabsTrigger value="changes">Change requests</TabsTrigger>
          <TabsTrigger value="audit">Audit log</TabsTrigger>
        </TabsList>

        <TabsContent value="applicants" className="pt-6">
          {statuses.status === 'loading' || profiles.status === 'loading' ? (
            <Loading />
          ) : statuses.status === 'error' ? (
            <ErrorNote message={statuses.error || 'Could not load applicants.'} />
          ) : (
            <Applicants queue={queue.map((r) => ({ ...r.data, profile: profileById.get(r.data.userId) ?? null }))} />
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

function Applicants({ queue }: { queue: Applicant[] }) {
  const toast = useToast()
  const [open, setOpen] = useState<Applicant | null>(null)
  const [form, setForm] = useState(EMPTY_VET)
  const [busy, setBusy] = useState(false)
  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) => setForm((f) => ({ ...f, [k]: v }))

  if (queue.length === 0) return <EmptyState title="No one waiting" description="New volunteer applications appear here." />

  async function decide(outcome: 'vetted' | 'rejected') {
    if (!open) return
    setBusy(true)
    const res = await callAction('vetVolunteer', { userId: open.userId, outcome, ...form })
    setBusy(false)
    if (!res.success) {
      toast.error('That didn’t go through', res.error)
      return
    }
    toast.success(outcome === 'vetted' ? 'Marked as vetted' : 'Application rejected', outcome === 'vetted' ? 'The school administrator gives the final approval.' : undefined)
    setOpen(null)
    setForm(EMPTY_VET)
  }

  const name = open?.profile?.displayName ?? 'this volunteer'

  return (
    <>
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
              <Button
                size="sm"
                onClick={() => {
                  setForm(EMPTY_VET)
                  setOpen(a)
                }}
              >
                Review
              </Button>
            </div>
          </li>
        ))}
      </ul>

      <Modal open={!!open} onClose={() => !busy && setOpen(null)} size="lg">
        <Modal.Header>
          <Modal.Title>Vet {name}</Modal.Title>
          <Modal.Description>
            {open?.profile?.profession}
            {open?.profile?.employer ? ` · ${open.profile.employer}` : ''}. Record what you checked; the school sees a summary.
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

// ── People & roles ───────────────────────────────────────────────────────────

interface Person {
  id: string
  name: string
  email: string
  platformRole: string
}

function Roles({ users }: { users: Person[] }) {
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
        Give teacher access to the school’s teachers, and school-administrator access to the one person who approves volunteers. Volunteers need no role.
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
                    <SelectItem value="school_admin">School administrator</SelectItem>
                  </SelectContent>
                </Select>
                <Button size="sm" variant="outline" onClick={() => void assign(p)} loading={busyId === p.id} disabled={!choice[p.id] || choice[p.id] === current}>
                  Assign
                </Button>
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
        title={removing ? `Remove ${removing.name || removing.email}’s access?` : 'Remove access?'}
        description="They keep their account but lose the teacher or school-administrator desk."
        confirmText="Remove access"
        loading={busyId !== null}
      />
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

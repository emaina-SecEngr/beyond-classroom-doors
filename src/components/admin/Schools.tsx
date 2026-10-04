/**
 * Schools in the district — the program admin adds, edits and (de)activates them
 * (D9). Inactive schools keep their history but take no new teachers or sessions.
 * The createSchool / updateSchool actions refuse anyone but the program admin.
 *
 * Each school lists its teachers (D10): those with access, and those invited by
 * name + school email who haven't signed in yet. Signing in with that email gives
 * them access automatically.
 */
import { useState } from 'react'
import { useQuery, useUsers } from 'deepspace'
import { Badge, Button, Checkbox, ConfirmModal, EmptyState, Input, Modal, useToast } from '@/components/ui'
import { ErrorNote, Field, Loading } from '../Page'
import { callAction } from '../../lib/actions'
import { CITIES, DISTRICTS } from '../../lib/options'
import { PickOrOther } from '../Pickers'
import { useSchools, type SchoolRecord, fullAddress } from '../../lib/schools'

const EMPTY = { name: '', district: 'San Diego Unified', city: 'San Diego', address: '', active: true }

interface InviteRow {
  email: string
  name: string
  schoolId: string
  status: 'pending' | 'accepted' | 'revoked'
}

export function Schools({ editable }: { editable: boolean }) {
  const toast = useToast()
  const { schools, status, error } = useSchools()
  const [editing, setEditing] = useState<SchoolRecord | 'new' | null>(null)
  const [form, setForm] = useState(EMPTY)
  const [busy, setBusy] = useState(false)
  const assignments = useQuery<{ userId: string; role: string; schoolId?: string }>('role_assignments', { limit: 500 })
  const invites = useQuery<InviteRow>('teacher_invites', { limit: 500 })
  const { users } = useUsers()
  const [inviting, setInviting] = useState<SchoolRecord | null>(null)
  const [invite, setInvite] = useState({ name: '', email: '' })
  const [revoking, setRevoking] = useState<{ id: string; name: string } | null>(null)
  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) => setForm((f) => ({ ...f, [k]: v }))

  function open(s: SchoolRecord | 'new') {
    setForm(s === 'new' ? EMPTY : { name: s.name, district: s.district ?? '', city: s.city ?? '', address: s.address ?? '', active: !!s.active })
    setEditing(s)
  }

  async function save() {
    if (!editing) return
    setBusy(true)
    const res =
      editing === 'new'
        ? await callAction('createSchool', { name: form.name, district: form.district, city: form.city, address: form.address })
        : await callAction('updateSchool', { schoolId: editing.id, ...form })
    setBusy(false)
    if (!res.success) {
      toast.error('Could not save the school', res.error)
      return
    }
    toast.success(editing === 'new' ? `${form.name} added` : `${form.name} saved`)
    setEditing(null)
  }

  async function sendInvite() {
    if (!inviting) return
    setBusy(true)
    const res = await callAction<{ accepted: boolean }>('inviteTeacher', { ...invite, schoolId: inviting.id })
    setBusy(false)
    if (!res.success) {
      toast.error('Could not add the teacher', res.error)
      return
    }
    toast.success(
      res.data.accepted ? `${invite.name} now has teacher access` : `${invite.name} added to ${inviting.name}`,
      res.data.accepted ? 'They had already signed in, so access is ready.' : 'They get access when they sign in with that email.',
    )
    setInviting(null)
    setInvite({ name: '', email: '' })
  }

  async function revoke() {
    if (!revoking) return
    setBusy(true)
    const res = await callAction('revokeTeacherInvite', { inviteId: revoking.id })
    setBusy(false)
    if (!res.success) {
      toast.error('Could not cancel the invite', res.error)
      return
    }
    toast.success('Invite cancelled')
    setRevoking(null)
  }

  const userName = (id: string) => users.find((u) => u.id === id)?.name || users.find((u) => u.id === id)?.email || 'Teacher'
  const teachersAt = (schoolId: string) => assignments.records.filter((r) => r.data.role === 'teacher' && r.data.schoolId === schoolId)
  const pendingAt = (schoolId: string) => invites.records.filter((r) => r.data.status === 'pending' && r.data.schoolId === schoolId)

  if (status === 'loading') return <Loading />
  if (status === 'error') return <ErrorNote message={error || 'Could not load schools.'} />

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-prose text-sm text-muted-foreground">
          Schools in the district that take volunteers. Teachers are assigned to one school, and their sessions show it.
        </p>
        {editable && <Button onClick={() => open('new')}>Add a school</Button>}
      </div>
      {schools.length === 0 ? (
        <EmptyState
          title="No schools yet"
          description={editable ? 'Add the first school, then give its teachers access.' : 'The program admin adds schools.'}
          action={editable ? { label: 'Add a school', onClick: () => open('new') } : undefined}
        />
      ) : (
        <ul className="divide-y divide-border rounded-md border border-border bg-card">
          {schools.map((s) => {
            const teachers = teachersAt(s.id)
            const pending = pendingAt(s.id)
            return (
              <li key={s.id} className="px-4 py-4">
                <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                  <div className="min-w-0 flex-1">
                    <p className="font-medium">{s.name}</p>
                    <p className="text-xs text-muted-foreground">{[s.district, fullAddress(s)].filter(Boolean).join(' · ') || '—'}</p>
                  </div>
                  {!s.active && <Badge variant="outline">Inactive</Badge>}
                  {editable && (
                    <>
                      {!!s.active && (
                        <Button size="sm" variant="outline" onClick={() => setInviting(s)}>
                          Add teacher
                        </Button>
                      )}
                      <Button size="sm" variant="ghost" onClick={() => open(s)}>
                        Edit
                      </Button>
                    </>
                  )}
                </div>
                <div className="mt-3 border-l-2 border-border pl-3 text-sm">
                  {teachers.length === 0 && pending.length === 0 ? (
                    <p className="text-muted-foreground">No teachers yet.</p>
                  ) : (
                    <ul className="space-y-1">
                      {teachers.map((t) => (
                        <li key={t.recordId} className="flex items-center gap-2">
                          <span>{userName(t.data.userId)}</span>
                          <Badge variant="success" size="sm">
                            Has access
                          </Badge>
                        </li>
                      ))}
                      {pending.map((i) => (
                        <li key={i.recordId} className="flex flex-wrap items-center gap-2">
                          <span>{i.data.name}</span>
                          <span className="text-xs text-muted-foreground">{i.data.email}</span>
                          <Badge variant="warning" size="sm">
                            Invited
                          </Badge>
                          {editable && (
                            <button type="button" className="text-xs text-muted-foreground underline-offset-4 hover:underline" onClick={() => setRevoking({ id: i.recordId, name: i.data.name })}>
                              Cancel invite
                            </button>
                          )}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </li>
            )
          })}
        </ul>
      )}

      <Modal open={!!inviting} onClose={() => !busy && setInviting(null)} size="sm">
        <Modal.Header>
          <Modal.Title>Add a teacher at {inviting?.name}</Modal.Title>
          <Modal.Description>When they sign in with this school email, they get teacher access here automatically.</Modal.Description>
        </Modal.Header>
        <Modal.Body>
          <div className="space-y-4">
            <Field label="Teacher’s name" htmlFor="inv-name">
              <Input id="inv-name" value={invite.name} onChange={(e) => setInvite((v) => ({ ...v, name: e.target.value }))} maxLength={80} />
            </Field>
            <Field label="School email" htmlFor="inv-email" hint="The email they’ll sign in with.">
              <Input id="inv-email" type="email" value={invite.email} onChange={(e) => setInvite((v) => ({ ...v, email: e.target.value }))} maxLength={120} />
            </Field>
          </div>
        </Modal.Body>
        <Modal.Footer>
          <Button variant="ghost" onClick={() => setInviting(null)} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={() => void sendInvite()} loading={busy} disabled={!invite.name.trim() || !invite.email.includes('@')}>
            Add teacher
          </Button>
        </Modal.Footer>
      </Modal>

      <ConfirmModal
        open={!!revoking}
        onClose={() => !busy && setRevoking(null)}
        onConfirm={() => void revoke()}
        title={`Cancel ${revoking?.name ?? 'this'}’s invite?`}
        description="They won’t get teacher access when they sign in. You can add them again later."
        confirmText="Cancel invite"
        loading={busy}
      />

      <Modal open={!!editing} onClose={() => !busy && setEditing(null)}>
        <Modal.Header>
          <Modal.Title>{editing === 'new' ? 'Add a school' : `Edit ${editing?.name ?? ''}`}</Modal.Title>
          <Modal.Description>Public information only: name, district and front-office address.</Modal.Description>
        </Modal.Header>
        <Modal.Body>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <Field label="School name" htmlFor="sch-name">
                <Input id="sch-name" value={form.name} onChange={(e) => set('name', e.target.value)} maxLength={80} required />
              </Field>
            </div>
            <Field label="District" htmlFor="sch-district">
              <PickOrOther id="sch-district" options={DISTRICTS} value={form.district} onChange={(v) => set('district', v)} placeholder="Choose a district" otherPlaceholder="District name" />
            </Field>
            <Field label="City" htmlFor="sch-city">
              <PickOrOther id="sch-city" options={CITIES} value={form.city} onChange={(v) => set('city', v)} placeholder="Choose a city" otherPlaceholder="City" maxLength={60} />
            </Field>
            <div className="sm:col-span-2">
              <Field label="Front-office address" htmlFor="sch-address" hint="Shown to a volunteer once they book a session here.">
                <Input id="sch-address" value={form.address} onChange={(e) => set('address', e.target.value)} maxLength={160} />
              </Field>
            </div>
            {editing !== 'new' && (
              <label className="flex items-start gap-3 text-sm sm:col-span-2">
                <Checkbox checked={form.active} onCheckedChange={(c) => set('active', c)} />
                <span>Active — taking new teachers and sessions</span>
              </label>
            )}
          </div>
        </Modal.Body>
        <Modal.Footer>
          <Button variant="ghost" onClick={() => setEditing(null)} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={() => void save()} loading={busy} disabled={!form.name.trim()}>
            {editing === 'new' ? 'Add school' : 'Save'}
          </Button>
        </Modal.Footer>
      </Modal>
    </>
  )
}

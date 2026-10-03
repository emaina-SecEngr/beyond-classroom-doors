/**
 * Schools in the district — the program admin adds, edits and (de)activates them
 * (D9). Inactive schools keep their history but take no new teachers or sessions.
 * The createSchool / updateSchool actions refuse anyone but the program admin.
 */
import { useState } from 'react'
import { Badge, Button, Checkbox, EmptyState, Input, Modal, useToast } from '@/components/ui'
import { ErrorNote, Field, Loading } from '../Page'
import { callAction } from '../../lib/actions'
import { useSchools, type SchoolRecord } from '../../lib/schools'

const EMPTY = { name: '', district: '', city: '', address: '', active: true }

export function Schools({ editable }: { editable: boolean }) {
  const toast = useToast()
  const { schools, status, error } = useSchools()
  const [editing, setEditing] = useState<SchoolRecord | 'new' | null>(null)
  const [form, setForm] = useState(EMPTY)
  const [busy, setBusy] = useState(false)
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
          {schools.map((s) => (
            <li key={s.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
              <div className="min-w-0 flex-1">
                <p className="font-medium">{s.name}</p>
                <p className="text-xs text-muted-foreground">{[s.district, s.address, s.city].filter(Boolean).join(' · ') || '—'}</p>
              </div>
              {!s.active && <Badge variant="outline">Inactive</Badge>}
              {editable && (
                <Button size="sm" variant="outline" onClick={() => open(s)}>
                  Edit
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}

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
              <Input id="sch-district" value={form.district} onChange={(e) => set('district', e.target.value)} maxLength={80} />
            </Field>
            <Field label="City" htmlFor="sch-city">
              <Input id="sch-city" value={form.city} onChange={(e) => set('city', e.target.value)} maxLength={60} />
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

/**
 * Edit a session's private details — room, exact start, arrival instructions, note
 * for the volunteer. Used by the owning teacher (Teacher desk) and by program staff
 * (Staff desk → Sessions). The server action re-checks who may edit, and tells the
 * booked volunteer about any change.
 */
import { useEffect, useState } from 'react'
import { Button, Input, Modal, Textarea, useToast } from '@/components/ui'
import { Field } from './Page'
import { callAction } from '../lib/actions'

export interface EditableDetails {
  sessionId: string
  label: string
  room: string
  startTime: string
  arrivalNote: string
  teacherNote: string
}

export function SessionDetailsModal({ details, onClose }: { details: EditableDetails | null; onClose: () => void }) {
  const toast = useToast()
  const [form, setForm] = useState({ room: '', startTime: '', arrivalNote: '', teacherNote: '' })
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (details) setForm({ room: details.room, startTime: details.startTime, arrivalNote: details.arrivalNote, teacherNote: details.teacherNote })
  }, [details])

  const set = (k: keyof typeof form, v: string) => setForm((f) => ({ ...f, [k]: v }))

  async function save() {
    if (!details) return
    setBusy(true)
    const res = await callAction<{ changed: string[] }>('updateSessionDetails', { sessionId: details.sessionId, ...form })
    setBusy(false)
    if (!res.success) {
      toast.error('Could not save', res.error)
      return
    }
    toast.success(res.data.changed.length ? 'Details saved' : 'Nothing changed', res.data.changed.length ? 'If a volunteer is booked, they’ve been told.' : undefined)
    onClose()
  }

  return (
    <Modal open={!!details} onClose={() => !busy && onClose()}>
      <Modal.Header>
        <Modal.Title>Session details</Modal.Title>
        <Modal.Description>{details?.label}. Shared only with the booked volunteer.</Modal.Description>
      </Modal.Header>
      <Modal.Body>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Room" htmlFor="sd-room">
            <Input id="sd-room" value={form.room} onChange={(e) => set('room', e.target.value)} maxLength={40} />
          </Field>
          <Field label="Exact start" htmlFor="sd-start">
            <Input id="sd-start" type="time" value={form.startTime} onChange={(e) => set('startTime', e.target.value)} />
          </Field>
          <div className="sm:col-span-2">
            <Field label="Arrival instructions" htmlFor="sd-arrival" hint="For example: Sign in at the front office with photo ID.">
              <Textarea id="sd-arrival" rows={2} value={form.arrivalNote} onChange={(e) => set('arrivalNote', e.target.value)} maxLength={300} />
            </Field>
          </div>
          <div className="sm:col-span-2">
            <Field label="Note for the volunteer" htmlFor="sd-note" hint="What the class is studying, questions they have. No student names.">
              <Textarea id="sd-note" rows={3} value={form.teacherNote} onChange={(e) => set('teacherNote', e.target.value)} maxLength={300} />
            </Field>
          </div>
        </div>
      </Modal.Body>
      <Modal.Footer>
        <Button variant="ghost" onClick={onClose} disabled={busy}>
          Cancel
        </Button>
        <Button onClick={() => void save()} loading={busy}>
          Save details
        </Button>
      </Modal.Footer>
    </Modal>
  )
}

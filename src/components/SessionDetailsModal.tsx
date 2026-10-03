/**
 * Session details and prep (D11) — used by the owning teacher (Teacher desk) and by
 * the program admin / staff at that school (School view).
 *
 * Room, start, class, how many students, arrival instructions, a note, and which of
 * the volunteer's requested items are ready. The server action re-checks who may
 * edit, accepts "ready" only for items the volunteer asked for, and tells the
 * booked volunteer about any change.
 */
import { useEffect, useState } from 'react'
import { Button, Checkbox, Input, Modal, Textarea, useToast } from '@/components/ui'
import { Field } from './Page'
import { callAction } from '../lib/actions'
import { EQUIPMENT_LABELS } from '../lib/labels'
import type { Equipment } from '../schemas/shared'

export interface EditableDetails {
  sessionId: string
  label: string
  room: string
  startTime: string
  arrivalNote: string
  teacherNote: string
  classLabel?: string
  studentCount?: number | null
  volunteerName?: string
  equipmentRequested?: string[]
  equipmentOther?: string
  equipmentReady?: string[]
}

/** Build the modal's input from a session_details row. */
export function toEditable(sessionId: string, label: string, d: Partial<EditableDetails> | undefined | null): EditableDetails {
  return {
    sessionId,
    label,
    room: d?.room ?? '',
    startTime: d?.startTime ?? '',
    arrivalNote: d?.arrivalNote ?? '',
    teacherNote: d?.teacherNote ?? '',
    classLabel: d?.classLabel ?? '',
    studentCount: d?.studentCount ?? null,
    volunteerName: d?.volunteerName ?? '',
    equipmentRequested: d?.equipmentRequested ?? [],
    equipmentOther: d?.equipmentOther ?? '',
    equipmentReady: d?.equipmentReady ?? [],
  }
}

export function SessionDetailsModal({ details, onClose }: { details: EditableDetails | null; onClose: () => void }) {
  const toast = useToast()
  const [form, setForm] = useState({ room: '', startTime: '', arrivalNote: '', teacherNote: '', classLabel: '', studentCount: '' })
  const [ready, setReady] = useState<string[]>([])
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!details) return
    setForm({
      room: details.room,
      startTime: details.startTime,
      arrivalNote: details.arrivalNote,
      teacherNote: details.teacherNote,
      classLabel: details.classLabel ?? '',
      studentCount: details.studentCount ? String(details.studentCount) : '',
    })
    setReady(details.equipmentReady ?? [])
  }, [details])

  const set = (k: keyof typeof form, v: string) => setForm((f) => ({ ...f, [k]: v }))
  const requested = details?.equipmentRequested ?? []

  async function save() {
    if (!details) return
    setBusy(true)
    const res = await callAction<{ changed: string[] }>('updateSessionDetails', {
      sessionId: details.sessionId,
      ...form,
      studentCount: form.studentCount ? Number(form.studentCount) : null,
      equipmentReady: ready,
    })
    setBusy(false)
    if (!res.success) {
      toast.error('Could not save', res.error)
      return
    }
    toast.success(res.data.changed.length ? 'Details saved' : 'Nothing changed', res.data.changed.length ? 'If a volunteer is booked, they’ve been told.' : undefined)
    onClose()
  }

  return (
    <Modal open={!!details} onClose={() => !busy && onClose()} size="lg">
      <Modal.Header>
        <Modal.Title>Session details</Modal.Title>
        <Modal.Description>
          {details?.label}
          {details?.volunteerName ? ` · Volunteer: ${details.volunteerName}` : ' · No volunteer yet'}. Shared only with the booked volunteer.
        </Modal.Description>
      </Modal.Header>
      <Modal.Body>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Class" htmlFor="sd-class" hint="For example: AP Biology, period 3.">
            <Input id="sd-class" value={form.classLabel} onChange={(e) => set('classLabel', e.target.value)} maxLength={80} />
          </Field>
          <Field label="Students taking part" htmlFor="sd-count">
            <Input id="sd-count" type="number" inputMode="numeric" min={1} max={200} value={form.studentCount} onChange={(e) => set('studentCount', e.target.value)} />
          </Field>
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
              <Textarea id="sd-note" rows={2} value={form.teacherNote} onChange={(e) => set('teacherNote', e.target.value)} maxLength={300} />
            </Field>
          </div>
          <fieldset className="sm:col-span-2">
            <legend className="text-sm font-medium">What the volunteer needs</legend>
            {requested.length === 0 && !details?.equipmentOther ? (
              <p className="mt-1 text-sm text-muted-foreground">
                {details?.volunteerName ? 'The volunteer hasn’t listed anything yet.' : 'Once a volunteer books, they can list what they need here.'}
              </p>
            ) : (
              <>
                <p className="mt-1 text-xs text-muted-foreground">Tick each item once it’s ready in the room.</p>
                <div className="mt-2 grid gap-2 sm:grid-cols-2">
                  {requested.map((item) => (
                    <label key={item} className="flex items-center gap-3 text-sm">
                      <Checkbox
                        checked={ready.includes(item)}
                        onCheckedChange={(c) => setReady((r) => (c ? [...new Set([...r, item])] : r.filter((x) => x !== item)))}
                      />
                      <span>{EQUIPMENT_LABELS[item as Equipment] ?? item}</span>
                    </label>
                  ))}
                </div>
                {details?.equipmentOther && <p className="mt-2 text-sm">Also asked for: {details.equipmentOther}</p>}
              </>
            )}
          </fieldset>
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

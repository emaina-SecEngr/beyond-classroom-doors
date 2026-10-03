/**
 * The program admin books an approved volunteer onto an open session (D13).
 * Lists only approved volunteers with an unexpired clearance; the assignVolunteer
 * action re-checks all of it (and the race gate) on the server.
 */
import { useState } from 'react'
import { useQuery } from 'deepspace'
import { Button, Modal, Select, SelectContent, SelectItem, SelectTrigger, SelectValue, useToast } from '@/components/ui'
import { Field } from '../Page'
import { callAction } from '../../lib/actions'
import type { ProfileRow } from '../../lib/me'

export function AssignVolunteerButton({ sessionId, label }: { sessionId: string; label: string }) {
  const toast = useToast()
  const [open, setOpen] = useState(false)
  const [pick, setPick] = useState('')
  const [busy, setBusy] = useState(false)
  const statuses = useQuery<{ userId: string; status: string; clearanceExpiresAt?: number | null }>('volunteer_status', { where: { status: 'approved' }, limit: 500 })
  const profiles = useQuery<ProfileRow>('profiles', { limit: 500 })
  const now = Date.now() / 1000
  const byId = new Map(profiles.records.map((r) => [r.data.userId, r.data]))
  const eligible = statuses.records
    .filter((r) => (r.data.clearanceExpiresAt ?? 0) > now)
    .map((r) => ({ id: r.data.userId, p: byId.get(r.data.userId) }))
    .sort((a, b) => (a.p?.displayName ?? '').localeCompare(b.p?.displayName ?? ''))

  async function assign() {
    setBusy(true)
    const res = await callAction('assignVolunteer', { sessionId, volunteerId: pick })
    setBusy(false)
    if (!res.success) {
      toast.error('Could not assign', res.error)
      return
    }
    toast.success('Volunteer booked', 'They and the teacher have been told.')
    setOpen(false)
    setPick('')
  }

  return (
    <>
      <Button size="sm" onClick={() => setOpen(true)}>
        Assign volunteer
      </Button>
      <Modal open={open} onClose={() => !busy && setOpen(false)} size="sm">
        <Modal.Header>
          <Modal.Title>Assign a volunteer</Modal.Title>
          <Modal.Description>{label}. They’ll be asked to confirm they’re available, and get the teacher’s contact.</Modal.Description>
        </Modal.Header>
        <Modal.Body>
          {eligible.length === 0 ? (
            <p className="text-sm text-muted-foreground">No approved volunteers with a current clearance yet.</p>
          ) : (
            <Field label="Approved volunteer" htmlFor={`assign-${sessionId}`}>
              <Select value={pick} onValueChange={(v) => setPick(v)}>
                <SelectTrigger id={`assign-${sessionId}`}>
                  <SelectValue placeholder="Choose a volunteer" />
                </SelectTrigger>
                <SelectContent>
                  {eligible.map((v) => (
                    <SelectItem key={v.id} value={v.id}>
                      {(v.p?.displayName ?? 'Unknown') + (v.p?.profession ? ` · ${v.p.profession}` : '')}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          )}
        </Modal.Body>
        <Modal.Footer>
          <Button variant="ghost" onClick={() => setOpen(false)} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={() => void assign()} loading={busy} disabled={!pick}>
            Book them
          </Button>
        </Modal.Footer>
      </Modal>
    </>
  )
}

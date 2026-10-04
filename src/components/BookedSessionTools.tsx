/**
 * Teacher-side tools for a booked session (D13), shared by the Teacher desk and the
 * School view: contact the volunteer (email / call — opens the user's own email
 * or phone app; contact details come from the private session row), confirm the
 * class is ready, propose another date, and answer the volunteer's proposal.
 * Every action is re-checked on the server.
 */
import { useState } from 'react'
import { Badge, Button, Modal, Textarea, useToast } from '@/components/ui'
import { callAction } from '../lib/actions'
import { formatInstant } from '../lib/labels'
import { ProposalBanner, ProposeDateButton } from './DateProposal'

export interface BookedDetails {
  volunteerName?: string
  volunteerEmail?: string
  volunteerPhone?: string
  accessNeeds?: string
  readyAt?: number | null
  proposedDate?: number | null
  proposedTimeBand?: string
  proposedBy?: string
  proposedNote?: string
}

export function BookedSessionTools({
  sessionId,
  label,
  status,
  details,
  viewerId,
  hideName = false,
}: {
  sessionId: string
  label: string
  status: string
  details: BookedDetails | undefined
  viewerId: string | null
  /** The card already shows the volunteer's name (My volunteers). */
  hideName?: boolean
}) {
  const toast = useToast()
  const [confirming, setConfirming] = useState(false)
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  if (status !== 'claimed' && status !== 'confirmed') return null
  const d = details ?? {}

  async function markReady() {
    setBusy(true)
    const res = await callAction('markClassReady', { sessionId, note })
    setBusy(false)
    if (!res.success) {
      toast.error('Could not mark ready', res.error)
      return
    }
    toast.success('Volunteer told the class is ready')
    setConfirming(false)
    setNote('')
  }

  return (
    <div className="basis-full rounded-md border border-border p-3 text-sm">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        {!hideName && <span className="font-medium">{d.volunteerName || 'Booked volunteer'}</span>}
        {d.volunteerEmail && (
          <a className="text-primary underline-offset-4 hover:underline" href={`mailto:${d.volunteerEmail}?subject=${encodeURIComponent(`Career session: ${label}`)}`}>
            Email
          </a>
        )}
        {d.volunteerPhone && (
          <a className="text-primary underline-offset-4 hover:underline" href={`tel:${d.volunteerPhone.replace(/[^0-9+]/g, '')}`}>
            Call {d.volunteerPhone}
          </a>
        )}
        <span className="flex-1" />
        {d.readyAt ? (
          <Badge variant="success">Class ready · {formatInstant(d.readyAt)}</Badge>
        ) : (
          <Button size="sm" onClick={() => setConfirming(true)}>
            Class is ready
          </Button>
        )}
        {!d.proposedDate && <ProposeDateButton sessionId={sessionId} label={label} />}
      </div>
      {d.accessNeeds ? (
        <p className="mt-2 rounded-sm bg-accent px-2 py-1">
          <span className="font-medium">To help them on the day:</span> {d.accessNeeds}
        </p>
      ) : null}
      {d.proposedDate ? (
        <ProposalBanner
          sessionId={sessionId}
          proposedDate={d.proposedDate}
          proposedTimeBand={d.proposedTimeBand}
          proposedNote={d.proposedNote}
          mine={d.proposedBy === viewerId}
          who="Your volunteer"
        />
      ) : null}
      <Modal open={confirming} onClose={() => !busy && setConfirming(false)} size="sm">
        <Modal.Header>
          <Modal.Title>Tell the volunteer the class is ready?</Modal.Title>
          <Modal.Description>{label}. They’ll get a message with the date, room and class size.</Modal.Description>
        </Modal.Header>
        <Modal.Body>
          <label htmlFor={`ready-note-${sessionId}`} className="text-sm font-medium">
            Note for the volunteer (optional)
          </label>
          <Textarea id={`ready-note-${sessionId}`} rows={2} value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} placeholder="Projector is set up; park in the visitor lot." />
        </Modal.Body>
        <Modal.Footer>
          <Button variant="ghost" onClick={() => setConfirming(false)} disabled={busy}>
            Not yet
          </Button>
          <Button onClick={() => void markReady()} loading={busy}>
            Class is ready
          </Button>
        </Modal.Footer>
      </Modal>
    </div>
  )
}

/**
 * Moving a booked session to another date (D13), shared by the volunteer's
 * My sessions and the teacher's desk / School view.
 *
 *   <ProposeDateButton>  propose a new date + time of day, with a reason
 *   <ProposalBanner>     shows a pending proposal; the OTHER side can accept/decline
 *
 * The server decides who may propose and who may answer (respondToProposal).
 */
import { useState } from 'react'
import { Button, Input, Modal, Select, SelectContent, SelectItem, SelectTrigger, SelectValue, Textarea, useToast } from '@/components/ui'
import { Field } from './Page'
import { callAction } from '../lib/actions'
import { formatSessionDate, TIME_BAND_LABELS, TIME_BAND_SHORT, todayInSanDiego } from '../lib/labels'
import { TIME_BANDS, type TimeBand } from '../schemas/shared'

export function ProposeDateButton({ sessionId, label, size = 'sm' }: { sessionId: string; label: string; size?: 'sm' | 'default' }) {
  const toast = useToast()
  const [open, setOpen] = useState(false)
  const [date, setDate] = useState('')
  const [band, setBand] = useState<TimeBand>('morning')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)

  async function send() {
    setBusy(true)
    const res = await callAction('proposeNewDate', { sessionId, date, timeBand: band, note })
    setBusy(false)
    if (!res.success) {
      toast.error('Could not propose the date', res.error)
      return
    }
    toast.success('New date proposed', 'They’ll be asked to accept or decline.')
    setOpen(false)
    setNote('')
  }

  return (
    <>
      <Button size={size} variant="outline" onClick={() => setOpen(true)}>
        Propose another date
      </Button>
      <Modal open={open} onClose={() => !busy && setOpen(false)} size="sm">
        <Modal.Header>
          <Modal.Title>Propose another date</Modal.Title>
          <Modal.Description>{label}. The session stays on its current date unless the other side accepts.</Modal.Description>
        </Modal.Header>
        <Modal.Body>
          <div className="space-y-4">
            <Field label="New date" htmlFor={`pd-date-${sessionId}`}>
              <Input id={`pd-date-${sessionId}`} type="date" min={todayInSanDiego()} value={date} onChange={(e) => setDate(e.target.value)} />
            </Field>
            <Field label="Time of day" htmlFor={`pd-band-${sessionId}`}>
              <Select value={band} onValueChange={(v) => setBand((v || 'morning') as TimeBand)}>
                <SelectTrigger id={`pd-band-${sessionId}`}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TIME_BANDS.map((b) => (
                    <SelectItem key={b} value={b}>
                      {TIME_BAND_LABELS[b]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field label="Why (optional)" htmlFor={`pd-note-${sessionId}`} hint="For example: the projector is out for repair until next week.">
              <Textarea id={`pd-note-${sessionId}`} rows={2} value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} />
            </Field>
          </div>
        </Modal.Body>
        <Modal.Footer>
          <Button variant="ghost" onClick={() => setOpen(false)} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={() => void send()} loading={busy} disabled={!date}>
            Propose date
          </Button>
        </Modal.Footer>
      </Modal>
    </>
  )
}

export function ProposalBanner({
  sessionId,
  proposedDate,
  proposedTimeBand,
  proposedNote,
  mine,
  who,
}: {
  sessionId: string
  proposedDate: number
  proposedTimeBand?: string
  proposedNote?: string
  /** True when the viewer made the proposal (they wait; they can't answer it). */
  mine: boolean
  /** Who proposed, from the viewer's point of view: "The teacher" / "Your volunteer". */
  who: string
}) {
  const toast = useToast()
  const [busy, setBusy] = useState<'accept' | 'decline' | null>(null)
  const when = `${formatSessionDate(proposedDate)}, ${TIME_BAND_SHORT[(proposedTimeBand || 'morning') as TimeBand] ?? proposedTimeBand}`

  async function answer(a: 'accept' | 'decline') {
    setBusy(a)
    const res = await callAction('respondToProposal', { sessionId, answer: a })
    setBusy(null)
    if (res.success) toast.success(a === 'accept' ? `Moved to ${when}` : 'Kept the current date')
    else toast.error('That didn’t go through', res.error)
  }

  return (
    <div role="status" className="mt-4 rounded-md border border-warning/50 bg-warning/10 p-3 text-sm">
      <p>
        <span className="font-semibold">{mine ? 'You proposed' : `${who} proposed`} a new date: {when}.</span>
        {proposedNote ? ` “${proposedNote}”` : ''}
      </p>
      {mine ? (
        <p className="mt-1 text-muted-foreground">Waiting for an answer.</p>
      ) : (
        <div className="mt-2 flex gap-2">
          <Button size="sm" onClick={() => void answer('accept')} loading={busy === 'accept'} disabled={!!busy}>
            Accept new date
          </Button>
          <Button size="sm" variant="ghost" onClick={() => void answer('decline')} loading={busy === 'decline'} disabled={!!busy}>
            Keep current date
          </Button>
        </div>
      )}
    </div>
  )
}

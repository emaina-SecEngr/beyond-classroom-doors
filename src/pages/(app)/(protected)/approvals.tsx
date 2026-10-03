/**
 * Board approvals — the second key (M3, decision D3a).
 *
 * A member of the nonprofit's board sees a vetting SUMMARY of volunteers program staff
 * have vetted (name, profession, employer, qualification, clearance date) —
 * never the raw records, never emails — and approves or declines. The list
 * comes from a server action because board members can't read other people's
 * volunteer records directly.
 */
import { useCallback, useEffect, useState } from 'react'
import { Button, ConfirmModal, EmptyState, Modal, Textarea, useToast } from '@/components/ui'
import { ErrorNote, Fact, Field, Loading, Page } from '../../../components/Page'
import { callAction } from '../../../lib/actions'
import { formatDay } from '../../../lib/labels'
import { useMe } from '../../../lib/me'

interface Candidate {
  userId: string
  displayName: string
  profession: string
  employer: string
  qualificationType: string
  clearanceExpiresAt: number | null
}

export default function ApprovalsPage() {
  const me = useMe()
  const toast = useToast()
  const [list, setList] = useState<Candidate[] | null>(null)
  const [loadError, setLoadError] = useState('')
  const [approving, setApproving] = useState<Candidate | null>(null)
  const [declining, setDeclining] = useState<Candidate | null>(null)
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)

  const isBoardMember = me.ready && me.appRole === 'board_member'

  const load = useCallback(async () => {
    setLoadError('')
    const res = await callAction<{ volunteers: Candidate[] }>('listVettedVolunteers')
    if (res.success) setList(res.data.volunteers)
    else setLoadError(res.error)
  }, [])

  useEffect(() => {
    if (isBoardMember) void load()
  }, [isBoardMember, load])

  if (!me.ready) return <Loading />
  if (!isBoardMember) {
    return (
      <Page title="Board approvals">
        <EmptyState title="For the nonprofit’s board" description="Program staff give this access to the board member(s) who approve volunteers." />
      </Page>
    )
  }

  async function decide(c: Candidate, outcome: 'approved' | 'declined') {
    setBusy(true)
    const res = await callAction('approveVolunteer', { userId: c.userId, outcome, reason: outcome === 'declined' ? reason : '' })
    setBusy(false)
    if (!res.success) {
      toast.error('That didn’t go through', res.error)
      void load()
      return
    }
    toast.success(outcome === 'approved' ? `${c.displayName} approved` : `${c.displayName} declined`, outcome === 'approved' ? 'They can now claim sessions.' : undefined)
    setApproving(null)
    setDeclining(null)
    setReason('')
    void load()
  }

  return (
    <Page
      title="Board approvals"
      intro="Program staff have confirmed each volunteer’s identity, license (where relevant) and school clearance. The board’s approval lets them claim sessions."
      actions={
        <Button variant="outline" size="sm" onClick={() => void load()}>
          Refresh
        </Button>
      }
    >
      {loadError && <ErrorNote message={loadError} />}
      {!loadError && list === null && <Loading label="Loading volunteers…" />}
      {list && list.length === 0 && <EmptyState title="No one is waiting" description="Vetted volunteers appear here for your approval." />}
      {list && list.length > 0 && (
        <ul className="space-y-4">
          {list.map((c) => (
            <li key={c.userId} className="rounded-md border border-border bg-card p-5">
              <h3 className="font-semibold">{c.displayName}</h3>
              <dl className="mt-3 space-y-1.5">
                <Fact label="Profession">{c.profession || '—'}</Fact>
                <Fact label="Employer">{c.employer || '—'}</Fact>
                <Fact label="Qualification">{c.qualificationType || '—'}</Fact>
                <Fact label="Clearance until">{formatDay(c.clearanceExpiresAt)}</Fact>
              </dl>
              <div className="mt-5 flex flex-wrap gap-2">
                <Button size="sm" onClick={() => setApproving(c)}>
                  Approve
                </Button>
                <Button size="sm" variant="outline" onClick={() => setDeclining(c)}>
                  Decline
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <ConfirmModal
        open={!!approving}
        onClose={() => !busy && setApproving(null)}
        onConfirm={() => approving && void decide(approving, 'approved')}
        title={approving ? `Approve ${approving.displayName}?` : 'Approve?'}
        description="They’ll be able to claim sessions until their clearance expires."
        confirmText="Approve"
        variant="default"
        loading={busy}
      />

      <Modal open={!!declining} onClose={() => !busy && setDeclining(null)} size="sm">
        <Modal.Header>
          <Modal.Title>Decline {declining?.displayName}?</Modal.Title>
          <Modal.Description>The volunteer sees your reason.</Modal.Description>
        </Modal.Header>
        <Modal.Body>
          <Field label="Reason" htmlFor="declineReason">
            <Textarea id="declineReason" rows={3} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} required />
          </Field>
        </Modal.Body>
        <Modal.Footer>
          <Button variant="ghost" onClick={() => setDeclining(null)} disabled={busy}>
            Back
          </Button>
          <Button variant="destructive" onClick={() => declining && void decide(declining, 'declined')} loading={busy} disabled={!reason.trim()}>
            Decline
          </Button>
        </Modal.Footer>
      </Modal>
    </Page>
  )
}

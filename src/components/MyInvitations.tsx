/**
 * A volunteer's pending invitations from teachers (D18), shown in My sessions.
 * Claim uses the normal claimSession action (same approval, clearance and race
 * checks); Decline tells the teacher. The reply email is the teacher's own, shared
 * only if she chose to.
 */
import { useState } from 'react'
import { useQuery } from 'deepspace'
import { Button, useToast } from '@/components/ui'
import { Section } from './Page'
import { callAction } from '../lib/actions'
import { formatSessionDate, TIME_BAND_SHORT, topicText } from '../lib/labels'
import { fullAddress, useSchools } from '../lib/schools'
import { Directions } from './Directions'
import type { TimeBand } from '../schemas/shared'

interface InviteRow {
  sessionId: string
  teacherName?: string
  note?: string
  replyEmail?: string
  status: string
}
interface SessionRow {
  grade: string
  topic: string
  topicOther: string
  sessionDate: number
  timeBand: TimeBand
  status: string
  schoolId?: string
}

export function MyInvitations({ volunteerId, canClaim }: { volunteerId: string; canClaim: boolean }) {
  const toast = useToast()
  const invites = useQuery<InviteRow>('session_invites', { where: { volunteerId, status: 'pending' }, limit: 50 })
  const sessions = useQuery<SessionRow>('session_requests', { where: { status: 'open' }, limit: 300 })
  const { byId } = useSchools()
  const [busy, setBusy] = useState<string | null>(null)

  const sessionById = new Map(sessions.records.map((r) => [r.recordId, r.data]))
  const rows = invites.records.map((r) => ({ id: r.recordId, inv: r.data, s: sessionById.get(r.data.sessionId) })).filter((x) => !!x.s)
  if (rows.length === 0) return null

  async function claim(id: string, sessionId: string) {
    setBusy(id)
    const res = await callAction('claimSession', { sessionId })
    setBusy(null)
    if (res.success) toast.success('Session booked', 'It’s in your upcoming sessions, and the teacher has been told.')
    else toast.error('Could not claim', res.error)
  }
  async function decline(id: string) {
    setBusy(id)
    const res = await callAction('respondToInvite', { inviteId: id, answer: 'decline' })
    setBusy(null)
    if (res.success) toast.success('Declined', 'The teacher has been told.')
    else toast.error('That didn’t go through', res.error)
  }

  return (
    <Section title="Invitations" description="Teachers who’d like you to visit their class.">
      <ul className="space-y-3">
        {rows.map(({ id, inv, s }) => {
          const school = byId.get(s!.schoolId ?? '')
          const what = `Grade ${s!.grade} · ${topicText(s!.topic, s!.topicOther)}`
          return (
            <li key={id} className="rounded-md border border-primary/40 bg-card p-4">
              <p className="font-medium">
                {inv.teacherName || 'A teacher'} invited you: {what}
              </p>
              <p className="text-sm text-muted-foreground">
                {formatSessionDate(s!.sessionDate)}, {TIME_BAND_SHORT[s!.timeBand]}
                {school ? ` · ${[school.name, fullAddress(school)].filter(Boolean).join(', ')} · ` : ''}
                {school ? <Directions school={school} /> : null}
              </p>
              {inv.note ? <p className="mt-2 text-sm">“{inv.note}”</p> : null}
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <Button size="sm" onClick={() => void claim(id, inv.sessionId)} loading={busy === id} disabled={!canClaim || !!busy}>
                  Claim this session
                </Button>
                <Button size="sm" variant="ghost" onClick={() => void decline(id)} disabled={!!busy}>
                  Decline
                </Button>
                {inv.replyEmail ? (
                  <a
                    className="text-sm font-medium text-primary underline-offset-4 hover:underline"
                    href={`mailto:${inv.replyEmail}?subject=${encodeURIComponent(`Your invitation: ${what}, ${formatSessionDate(s!.sessionDate)}`)}`}
                  >
                    Reply by email
                  </a>
                ) : null}
              </div>
              {!canClaim && <p className="mt-2 text-xs text-muted-foreground">Your clearance needs renewing before you can claim.</p>}
            </li>
          )
        })}
      </ul>
    </Section>
  )
}

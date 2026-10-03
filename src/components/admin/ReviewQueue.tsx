/**
 * The volunteer review queue: approve (final) or reject. Used on the Approvals page.
 * Only the nonprofit admin, or staff during an active delegation, can decide —
 * enforced by the vetVolunteer action (D3b, R7).
 */
import { useState } from 'react'
import {
  Badge,
  Button,
  Checkbox,
  EmptyState,
  Input,
  Modal,
  Textarea,
  useToast,
} from '@/components/ui'
import { Fact, Field } from '../Page'
import { LicenseFileList } from '../LicenseFiles'
import { callAction } from '../../lib/actions'
import { formatInstant, todayInSanDiego, VOLUNTEER_STATUS_BADGE, VOLUNTEER_STATUS_LABELS } from '../../lib/labels'
import type { ProfileRow } from '../../lib/me'
import type { Access, StatusRow } from './shared'

export type Applicant = StatusRow & { profile: ProfileRow | null }

const EMPTY_VET = {
  identityConfirmed: false,
  qualificationType: '',
  licenseNumber: '',
  licenseCheckedAt: '',
  clearanceCompletedAt: '',
  clearanceExpiresAt: '',
  reason: '',
}

export function ReviewQueue({ queue, access }: { queue: Applicant[]; access: Access }) {
  const toast = useToast()
  const [open, setOpen] = useState<Applicant | null>(null)
  const [form, setForm] = useState(EMPTY_VET)
  const [busy, setBusy] = useState(false)
  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) => setForm((f) => ({ ...f, [k]: v }))

  if (queue.length === 0) return <EmptyState title="No one waiting" description="New volunteer applications appear here." />

  const notice = !access.canVet
    ? 'Volunteers are approved by the program admin. You can see who’s waiting; the admin can delegate approvals to you.'
    : access.vettingHelpEndsAt
      ? `Approvals delegated to you until ${formatInstant(access.vettingHelpEndsAt)}. Your decisions are final.`
      : null

  async function decide(outcome: 'approved' | 'rejected') {
    if (!open) return
    setBusy(true)
    const res = await callAction('vetVolunteer', { userId: open.userId, outcome, ...form })
    setBusy(false)
    if (!res.success) {
      toast.error('That didn’t go through', res.error)
      return
    }
    toast.success(outcome === 'approved' ? 'Volunteer approved' : 'Application rejected', outcome === 'approved' ? 'They can claim sessions now. This decision is final.' : undefined)
    setOpen(null)
    setForm(EMPTY_VET)
  }

  const name = open?.profile?.displayName ?? 'this volunteer'

  return (
    <>
      {notice && <p className="mb-4 rounded-md border border-border bg-card p-4 text-sm text-muted-foreground">{notice}</p>}
      <ul className="space-y-3">
        {queue.map((a) => (
          <li key={a.userId} className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-border bg-card p-4">
            <div className="min-w-0">
              <p className="font-medium">{a.profile?.displayName ?? 'Unknown'}</p>
              <p className="text-sm text-muted-foreground">
                {a.profile?.profession || '—'}
                {a.profile?.employer ? ` · ${a.profile.employer}` : ''}
                {a.profile?.yearsExperience != null ? ` · ${a.profile.yearsExperience} yrs` : ''}
              </p>
            </div>
            <div className="flex items-center gap-3">
              <Badge variant={VOLUNTEER_STATUS_BADGE[a.status]}>{VOLUNTEER_STATUS_LABELS[a.status]}</Badge>
              {access.canVet && (
                <Button
                  size="sm"
                  onClick={() => {
                    // Pre-fill what the volunteer reported; the approver confirms it.
                    const p = a.profile
                    setForm({
                      ...EMPTY_VET,
                      qualificationType: [p?.licenseType, p?.licenseState].filter(Boolean).join(', '),
                      licenseNumber: p?.licenseNumber ?? '',
                    })
                    setOpen(a)
                  }}
                >
                  Review
                </Button>
              )}
            </div>
          </li>
        ))}
      </ul>

      <Modal open={!!open} onClose={() => !busy && setOpen(null)} size="lg">
        <Modal.Header>
          <Modal.Title>Review {name}</Modal.Title>
          <Modal.Description>
            {open?.profile?.profession}
            {open?.profile?.employer ? ` · ${open.profile.employer}` : ''}. Record what you checked. Approving is final: they can claim sessions right away.
          </Modal.Description>
        </Modal.Header>
        <Modal.Body>
          {open && (
            <div className="mb-5 space-y-3 rounded-md border border-border bg-muted p-4 text-sm">
              <dl className="grid gap-x-6 gap-y-1 sm:grid-cols-2">
                <Fact label="Company">{open.profile?.employer || '—'}</Fact>
                <Fact label="Experience">{open.profile?.yearsExperience != null ? `${open.profile.yearsExperience} years` : '—'}</Fact>
                <Fact label="Skills">{open.profile?.skills || '—'}</Fact>
                <Fact label="Hobbies">{open.profile?.hobbies || '—'}</Fact>
                <Fact label="License (reported)">
                  {open.profile?.licenseNumber
                    ? `${open.profile.licenseType || 'License'} ${open.profile.licenseNumber}${open.profile.licenseState ? ` · ${open.profile.licenseState}` : ''}`
                    : 'None reported'}
                </Fact>
              </dl>
              <div>
                <p className="mb-1 font-medium">License documents</p>
                <LicenseFileList volunteerId={open.userId} />
              </div>
            </div>
          )}
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
          <Button onClick={() => void decide('approved')} loading={busy} disabled={!form.identityConfirmed || !form.clearanceExpiresAt}>
            Approve volunteer
          </Button>
        </Modal.Footer>
      </Modal>
    </>
  )
}

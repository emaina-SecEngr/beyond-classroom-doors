/**
 * Program staff and delegation — nonprofit admin only (R6, R7).
 * Make or remove staff (worker set-role guard) and delegate approvals to a staff
 * member for a set time (grantVettingHelp / endVettingHelp). The server refuses
 * anyone else; this component only decides what to show.
 */
import { useEffect, useState } from 'react'
import { useQuery, useUsers } from 'deepspace'
import {
  Badge,
  Button,
  ConfirmModal,
  Input,
  Modal,
  Textarea,
  useToast,
} from '@/components/ui'
import { Field, Loading } from '../Page'
import { callAction } from '../../lib/actions'
import { formatDay } from '../../lib/labels'
import { useMe } from '../../lib/me'
import { VETTING_HELP_DEFAULT_DAYS, VETTING_HELP_MAX_DAYS } from '../../schemas/shared'
import type { Access, Person } from './shared'

// ── Program staff (decision R6) ──────────────────────────────────────────────
//
// Only the nonprofit admin (the app's owner) can grant or remove staff. The page
// asks the server who you are (myAccess) only to decide what to show; the worker
// (AppRecordRoom + staff-guard.ts) refuses anyone else and audits every change.

export function ProgramStaff({ access }: { access: Access }) {
  // The ONLY place in the app that may call setRole (guardrail-check §1.18).
  const { users, usersLoaded, setRole } = useUsers()
  const people: Person[] = users.map((u) => ({ id: u.id, name: u.name, email: u.email ?? '', platformRole: u.role }))
  const toast = useToast()
  const me = useMe()
  const isNonprofitAdmin = access.nonprofitAdmin
  const help = useQuery<{ userId: string; endsAt: number; reason: string }>('vetting_help', { limit: 200 })
  const [confirming, setConfirming] = useState<{ person: Person; role: 'admin' | 'member' } | null>(null)
  const [pending, setPending] = useState<{ id: string; role: 'admin' | 'member'; name: string } | null>(null)
  const [asking, setAsking] = useState<Person | null>(null)
  const [helpDays, setHelpDays] = useState(String(VETTING_HELP_DEFAULT_DAYS))
  const [helpReason, setHelpReason] = useState('')
  const [ending, setEnding] = useState<Person | null>(null)
  const [busy, setBusy] = useState(false)

  const now = Date.now() / 1000
  const helpUntil = new Map(help.records.filter((r) => r.data.endsAt > now).map((r) => [r.data.userId, r.data.endsAt]))

  async function askForHelp() {
    if (!asking) return
    setBusy(true)
    const res = await callAction('grantVettingHelp', { userId: asking.id, days: Number(helpDays), reason: helpReason })
    setBusy(false)
    if (!res.success) {
      toast.error('Could not delegate', res.error)
      return
    }
    toast.success(`${asking.name || asking.email} can approve volunteers`, `For ${helpDays} day${helpDays === '1' ? '' : 's'}. You can end it any time.`)
    setAsking(null)
    setHelpReason('')
    setHelpDays(String(VETTING_HELP_DEFAULT_DAYS))
  }

  async function endHelp() {
    if (!ending) return
    setBusy(true)
    const res = await callAction('endVettingHelp', { userId: ending.id })
    setBusy(false)
    if (!res.success) {
      toast.error('Could not end the delegation', res.error)
      return
    }
    toast.success('Delegation ended')
    setEnding(null)
  }

  // setRole is fire-and-forget over the realtime connection, so we confirm the change
  // by watching the live user list, and report a failure if it doesn't land in time.
  useEffect(() => {
    if (!pending) return
    const person = people.find((p) => p.id === pending.id)
    if (person?.platformRole === pending.role) {
      toast.success(pending.role === 'admin' ? `${pending.name} is now program staff` : `${pending.name} is no longer program staff`)
      setPending(null)
      return
    }
    const t = setTimeout(() => {
      toast.error('The change didn’t go through', 'Refresh and try again.')
      setPending(null)
    }, 10000)
    return () => clearTimeout(t)
  }, [pending, people, toast])

  if (!usersLoaded) return <Loading />
  if (!isNonprofitAdmin) {
    return (
      <p className="mb-6 rounded-md border border-border bg-card p-4 text-sm text-muted-foreground">
        Only the nonprofit admin can add or remove program staff.
      </p>
    )
  }

  const others = people.filter((p) => p.id !== me.userId)

  return (
    <section className="mb-8">
      <h3 className="font-semibold">Program staff</h3>
      <p className="mt-1 text-sm text-muted-foreground">
        Staff work with teachers so sessions are ready. Going away? Delegate approvals to a staff member for a set number of days; it ends on its own, and you can end it early. Only you can add or remove staff. Every change is recorded.
      </p>
      {others.length === 0 ? (
        <p className="mt-3 text-sm text-muted-foreground">No one else has signed in yet.</p>
      ) : (
        <ul className="mt-3 divide-y divide-border rounded-md border border-border bg-card">
          {others.map((p) => {
            const isStaff = p.platformRole === 'admin'
            return (
              <li key={p.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{p.name || '—'}</p>
                  <p className="truncate text-xs text-muted-foreground">{p.email}</p>
                </div>
                {isStaff && <Badge variant="secondary">Program staff</Badge>}
                {isStaff && helpUntil.has(p.id) && <Badge variant="info">Approving until {formatDay(helpUntil.get(p.id) ?? null)}</Badge>}
                {isStaff &&
                  (helpUntil.has(p.id) ? (
                    <Button size="sm" variant="ghost" onClick={() => setEnding(p)}>
                      End delegation
                    </Button>
                  ) : (
                    <Button size="sm" variant="outline" onClick={() => setAsking(p)}>
                      Delegate approvals
                    </Button>
                  ))}
                <Button
                  size="sm"
                  variant={isStaff ? 'ghost' : 'outline'}
                  loading={pending?.id === p.id}
                  disabled={!!pending}
                  onClick={() => setConfirming({ person: p, role: isStaff ? 'member' : 'admin' })}
                >
                  {isStaff ? 'Remove staff' : 'Make staff'}
                </Button>
              </li>
            )
          })}
        </ul>
      )}
      <ConfirmModal
        open={!!confirming}
        onClose={() => setConfirming(null)}
        onConfirm={() => {
          if (!confirming) return
          const { person, role } = confirming
          setPending({ id: person.id, role, name: person.name || person.email })
          setRole(person.id, role)
          setConfirming(null)
        }}
        title={
          confirming
            ? confirming.role === 'admin'
              ? `Make ${confirming.person.name || confirming.person.email} program staff?`
              : `Remove ${confirming.person.name || confirming.person.email} from program staff?`
            : 'Change staff access?'
        }
        description={
          confirming?.role === 'admin'
            ? 'They’ll work with teachers on sessions, assign teacher roles, and read the audit log. They can’t review volunteers unless you ask them to help.'
            : 'They’ll lose the staff desk immediately.'
        }
        confirmText={confirming?.role === 'admin' ? 'Make staff' : 'Remove staff'}
        variant={confirming?.role === 'admin' ? 'default' : 'destructive'}
      />
      <Modal open={!!asking} onClose={() => !busy && setAsking(null)} size="sm">
        <Modal.Header>
          <Modal.Title>Delegate approvals to {asking?.name || asking?.email}?</Modal.Title>
          <Modal.Description>They can review, approve and reject volunteers until the help ends. Their decisions are final, like yours.</Modal.Description>
        </Modal.Header>
        <Modal.Body>
          <div className="space-y-4">
            <Field label={`For how many days? (1–${VETTING_HELP_MAX_DAYS})`} htmlFor="helpDays">
              <Input id="helpDays" type="number" inputMode="numeric" min={1} max={VETTING_HELP_MAX_DAYS} value={helpDays} onChange={(e) => setHelpDays(e.target.value)} />
            </Field>
            <Field label="Why (recorded in the audit log)" htmlFor="helpReason" hint="For example: I’m travelling Oct 10–20.">
              <Textarea id="helpReason" rows={2} value={helpReason} onChange={(e) => setHelpReason(e.target.value)} maxLength={300} />
            </Field>
          </div>
        </Modal.Body>
        <Modal.Footer>
          <Button variant="ghost" onClick={() => setAsking(null)} disabled={busy}>
            Cancel
          </Button>
          <Button
            onClick={() => void askForHelp()}
            loading={busy}
            disabled={!helpReason.trim() || !(Number(helpDays) >= 1 && Number(helpDays) <= VETTING_HELP_MAX_DAYS)}
          >
            Delegate
          </Button>
        </Modal.Footer>
      </Modal>
      <ConfirmModal
        open={!!ending}
        onClose={() => !busy && setEnding(null)}
        onConfirm={() => void endHelp()}
        title={`End ${ending?.name || ending?.email || 'this'}’s delegation?`}
        description="They’ll stop being able to approve volunteers right away."
        confirmText="End delegation"
        loading={busy}
      />
    </section>
  )
}

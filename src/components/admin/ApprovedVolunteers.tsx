/**
 * The roster of approved volunteers — read-only (approvals are final, D3b).
 * For the program admin on the Approvals page. Staff read these collections
 * directly (admin read: true); nothing here writes.
 *
 * Shows who they are, what was checked, when the clearance runs out (flagged
 * within 30 days), who approved them and when, and sessions booked.
 */
import { useState } from 'react'
import { useQuery } from 'deepspace'
import { Badge, EmptyState, SearchInput } from '@/components/ui'
import { ErrorNote, Loading } from '../Page'
import { formatDay, formatInstant } from '../../lib/labels'
import type { ProfileRow } from '../../lib/me'
import type { StatusRow } from './shared'

interface ApprovedRow extends StatusRow {
  approvedBy?: string
  licenseNumber?: string
}
interface AuditRow {
  action: string
  targetId: string
  toState: string
}
interface ClaimRow {
  volunteerId: string
  status: 'active' | 'withdrawn'
}

const SOON_DAYS = 30

export function ApprovedVolunteers({ nameOf }: { nameOf: (id: string) => string }) {
  const statuses = useQuery<ApprovedRow>('volunteer_status', { where: { status: 'approved' }, limit: 500 })
  const profiles = useQuery<ProfileRow>('profiles', { limit: 500 })
  const audit = useQuery<AuditRow>('audit_log', { limit: 1000 })
  const claims = useQuery<ClaimRow>('claims', { limit: 1000 })
  const [q, setQ] = useState('')

  if (statuses.status === 'loading' || profiles.status === 'loading') return <Loading />
  if (statuses.status === 'error') return <ErrorNote message={statuses.error || 'Could not load approved volunteers.'} />

  const profileById = new Map(profiles.records.map((r) => [r.data.userId, r.data]))
  // When each volunteer was approved: the latest 'approve' audit entry for them.
  const approvedAt = new Map<string, string>()
  for (const r of audit.records) {
    if (r.data.action !== 'approve' || r.data.toState !== 'approved') continue
    const prev = approvedAt.get(r.data.targetId)
    if (!prev || r.createdAt > prev) approvedAt.set(r.data.targetId, r.createdAt)
  }
  const booked = new Map<string, number>()
  for (const c of claims.records) if (c.data.status === 'active') booked.set(c.data.volunteerId, (booked.get(c.data.volunteerId) ?? 0) + 1)

  const now = Date.now() / 1000
  const needle = q.trim().toLowerCase()
  const rows = statuses.records
    .map((r) => ({ ...r.data, profile: profileById.get(r.data.userId) ?? null }))
    .filter((r) => !needle || `${r.profile?.displayName ?? ''} ${r.profile?.profession ?? ''} ${r.profile?.employer ?? ''}`.toLowerCase().includes(needle))
    .sort((a, b) => (a.profile?.displayName ?? '').localeCompare(b.profile?.displayName ?? ''))

  if (statuses.records.length === 0) {
    return <EmptyState title="No approved volunteers yet" description="Volunteers you approve appear here." />
  }

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          {statuses.records.length} approved volunteer{statuses.records.length === 1 ? '' : 's'}. Approvals are final; this list is read-only.
        </p>
        <SearchInput
          aria-label="Search approved volunteers"
          placeholder="Search name or profession"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onClear={() => setQ('')}
          className="w-64"
        />
      </div>
      {rows.length === 0 ? (
        <EmptyState title="No matches" description="Try a different name or profession." />
      ) : (
        <div className="overflow-x-auto rounded-md border border-border bg-card">
          <table className="w-full min-w-[760px] text-left text-sm">
            <thead className="border-b border-border text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-4 py-2 font-medium">Volunteer</th>
                <th className="px-4 py-2 font-medium">Qualification</th>
                <th className="px-4 py-2 font-medium">Clearance until</th>
                <th className="px-4 py-2 font-medium">Approved</th>
                <th className="px-4 py-2 font-medium">Booked</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {rows.map((r) => {
                const exp = r.clearanceExpiresAt ?? 0
                const expired = exp <= now
                const soon = !expired && exp - now < SOON_DAYS * 86400
                return (
                  <tr key={r.userId} className="align-top">
                    <td className="px-4 py-3">
                      <p className="font-medium">{r.profile?.displayName ?? 'Unknown'}</p>
                      <p className="text-xs text-muted-foreground">
                        {r.profile?.profession || '—'}
                        {r.profile?.employer ? ` · ${r.profile.employer}` : ''}
                      </p>
                    </td>
                    <td className="px-4 py-3">
                      {r.qualificationType || '—'}
                      {r.licenseNumber ? <p className="text-xs text-muted-foreground">License {r.licenseNumber}</p> : null}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3">
                      <span className="tabular-nums">{formatDay(exp || null)}</span>{' '}
                      {expired ? (
                        <Badge variant="destructive" size="sm">
                          Expired
                        </Badge>
                      ) : soon ? (
                        <Badge variant="warning" size="sm">
                          Soon
                        </Badge>
                      ) : null}
                    </td>
                    <td className="px-4 py-3">
                      <p className="whitespace-nowrap tabular-nums">{formatInstant(approvedAt.get(r.userId) ?? null)}</p>
                      <p className="text-xs text-muted-foreground">by {r.approvedBy ? nameOf(r.approvedBy) : '—'}</p>
                    </td>
                    <td className="px-4 py-3 tabular-nums">{booked.get(r.userId) ?? 0}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </>
  )
}

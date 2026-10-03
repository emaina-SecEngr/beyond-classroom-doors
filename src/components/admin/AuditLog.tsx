/**
 * The audit log table (append-only; staff and the nonprofit admin can read it).
 * `actions` narrows it to particular actions, e.g. approval decisions.
 */
import { useQuery } from 'deepspace'
import { EmptyState } from '@/components/ui'
import { ErrorNote, Loading } from '../Page'
import { formatInstant } from '../../lib/labels'

interface AuditRow {
  actorId: string
  action: string
  targetType: string
  targetId: string
  fromState: string
  toState: string
  reason: string
}

export function AuditLog({ nameOf, actions }: { nameOf: (id: string) => string; actions?: string[] }) {
  const { records, status, error } = useQuery<AuditRow>('audit_log', { limit: 300 })
  if (status === 'loading') return <Loading />
  if (status === 'error') return <ErrorNote message={error || 'Could not load the audit log.'} />
  const rows = records
    .filter((r) => !actions || actions.includes(r.data.action))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  if (rows.length === 0) return <EmptyState title="Nothing recorded yet" description="Every privileged action is recorded here." />
  return (
    <div className="overflow-x-auto rounded-md border border-border bg-card">
      <table className="w-full min-w-[640px] text-left text-sm">
        <thead className="border-b border-border text-xs uppercase tracking-wide text-muted-foreground">
          <tr>
            <th className="px-4 py-2 font-medium">When</th>
            <th className="px-4 py-2 font-medium">Who</th>
            <th className="px-4 py-2 font-medium">Action</th>
            <th className="px-4 py-2 font-medium">Target</th>
            <th className="px-4 py-2 font-medium">Change</th>
            <th className="px-4 py-2 font-medium">Reason</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {rows.map((r) => (
            <tr key={r.recordId}>
              <td className="whitespace-nowrap px-4 py-2 tabular-nums">{formatInstant(r.createdAt)}</td>
              <td className="px-4 py-2">{nameOf(r.data.actorId)}</td>
              <td className="px-4 py-2">{r.data.action.replace(/_/g, ' ')}</td>
              <td className="px-4 py-2">{r.data.targetType === 'volunteer' || r.data.targetType === 'user' ? nameOf(r.data.targetId) : `${r.data.targetType} ${r.data.targetId.slice(0, 8)}`}</td>
              <td className="whitespace-nowrap px-4 py-2 text-muted-foreground">
                {r.data.fromState || '—'} → {r.data.toState || '—'}
              </td>
              <td className="px-4 py-2 text-muted-foreground">{r.data.reason || ''}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/**
 * Open sessions a volunteer can claim (M6, M7) — shared by the Program board and the
 * volunteer's My sessions. Shows school, grade, date, time of day and class size;
 * room and contacts are shared only after booking. Filter by school when more than
 * one has open sessions. claimSession re-checks everything on the server.
 */
import { useState, type ReactNode } from 'react'
import { useQuery } from 'deepspace'
import { Badge, Button, ConfirmModal, EmptyState, Select, SelectContent, SelectItem, SelectTrigger, SelectValue, useToast } from '@/components/ui'
import { ErrorNote, Loading } from './Page'
import { callAction } from '../lib/actions'
import { formatSessionDate, TIME_BAND_SHORT, todaySeconds, topicText } from '../lib/labels'
import { useSchools } from '../lib/schools'
import type { TimeBand } from '../schemas/shared'

interface SessionRow {
  teacherId: string
  grade: string
  topic: string
  topicOther: string
  sessionDate: number
  timeBand: TimeBand
  expectedHeadcount: number | null
  status: string
  schoolId?: string
}

export interface BoardItem {
  /** D17: at one of the viewer's preferred schools. */
  preferred?: boolean
  id: string
  grade: string
  topic: string
  topicOther?: string
  sessionDate: number
  timeBand: TimeBand
  expectedHeadcount: number | null
  schoolName?: string
}

export function OpenSessions({ canClaim, emptyDescription, preferredSchools = [] }: { canClaim: boolean; emptyDescription: string; preferredSchools?: string[] }) {
  const toast = useToast()
  const { records, status, error } = useQuery<SessionRow>('session_requests', {
    where: { status: 'open' },
    orderBy: 'sessionDate',
    orderDir: 'asc',
    limit: 200,
  })
  const [pending, setPending] = useState<BoardItem | null>(null)
  const [busy, setBusy] = useState(false)
  const { schools, byId: schoolById } = useSchools()
  const [schoolFilter, setSchoolFilter] = useState('__all__')

  const today = todaySeconds()
  const upcoming = records.filter((r) => r.data.sessionDate >= today)
  const schoolsOnBoard = schools.filter((sc) => upcoming.some((r) => r.data.schoolId === sc.id))
  const items: BoardItem[] = upcoming
    .filter((r) => schoolFilter === '__all__' || r.data.schoolId === schoolFilter)
    .map((r) => ({ id: r.recordId, ...r.data, schoolName: schoolById.get(r.data.schoolId ?? '')?.name, preferred: preferredSchools.includes(r.data.schoolId ?? '') }))
    // D17: sessions at the volunteer's chosen schools first, each group by date.
    .sort((a, b) => Number(!!b.preferred) - Number(!!a.preferred) || a.sessionDate - b.sessionDate)

  async function claim() {
    if (!pending) return
    setBusy(true)
    const res = await callAction<{ claimId: string }>('claimSession', { sessionId: pending.id })
    setBusy(false)
    setPending(null)
    if (res.success) toast.success('Session booked', 'It’s in My sessions now, and the teacher has been told.')
    else toast.error('Could not claim', res.error)
  }

  return (
    <>
      {schoolsOnBoard.length > 1 && (
        <div className="mb-4 flex items-center gap-3">
          <label htmlFor="school-filter" className="text-sm text-muted-foreground">
            School
          </label>
          <Select value={schoolFilter} onValueChange={(v) => setSchoolFilter(v || '__all__')}>
            <SelectTrigger id="school-filter" className="w-60">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__">All schools</SelectItem>
              {schoolsOnBoard.map((sc) => (
                <SelectItem key={sc.id} value={sc.id}>
                  {sc.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}
      {status === 'loading' && <Loading label="Loading sessions…" />}
      {status === 'error' && <ErrorNote message={error || 'Could not load open sessions. Refresh to try again.'} />}
      {status === 'ready' && items.length === 0 && <EmptyState title="No open sessions right now" description={emptyDescription} />}
      {status === 'ready' && items.length > 0 && (
        <BoardList
          items={items}
          renderAction={(item) =>
            canClaim ? (
              <Button size="sm" onClick={() => setPending(item)}>
                Claim
              </Button>
            ) : null
          }
        />
      )}

      <ConfirmModal
        open={!!pending}
        onClose={() => (busy ? undefined : setPending(null))}
        onConfirm={claim}
        title={pending ? `Claim Grade ${pending.grade} · ${topicText(pending.topic, pending.topicOther)}?` : 'Claim session?'}
        description={
          pending
            ? `${pending.schoolName ? `${pending.schoolName}, ` : ''}${formatSessionDate(pending.sessionDate)}, ${TIME_BAND_SHORT[pending.timeBand]}. You can withdraw yourself up to 48 hours before.`
            : undefined
        }
        confirmText="Claim session"
        variant="default"
        loading={busy}
      />
    </>
  )
}

export function BoardList({ items, renderAction }: { items: BoardItem[]; renderAction: (item: BoardItem) => ReactNode }) {
  return (
    <ul className="divide-y divide-border rounded-md border border-border bg-card">
      {items.map((item) => (
        <li key={item.id} className="flex flex-wrap items-center gap-x-6 gap-y-2 px-4 py-4 sm:flex-nowrap">
          <div className="w-32 shrink-0">
            <p className="text-sm font-semibold tabular-nums">{formatSessionDate(item.sessionDate)}</p>
            <p className="text-xs text-muted-foreground">{TIME_BAND_SHORT[item.timeBand]}</p>
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate font-medium">{topicText(item.topic, item.topicOther)}</p>
            <p className="text-xs text-muted-foreground">
              {item.schoolName ? `${item.schoolName} · ` : ''}Grade {item.grade}
              {item.expectedHeadcount ? ` · about ${item.expectedHeadcount} students` : ''}
            </p>
          </div>
          {item.preferred ? <Badge variant="success">Your school</Badge> : null}
          <Badge variant="info">Open</Badge>
          <div className="shrink-0">{renderAction(item)}</div>
        </li>
      ))}
    </ul>
  )
}

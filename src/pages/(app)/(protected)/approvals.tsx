/**
 * Approvals — the program admin's page (D3b, R6, R7).
 *
 *   Waiting      applications to approve (final) or reject
 *   Approved     read-only roster of approved volunteers
 *   Schools      the district's schools taking volunteers (D9)
 *   Delegate     hand approvals to a staff member for a set time; add/remove staff
 *   Decisions    every approval, rejection and delegation, from the audit log
 *
 * The nonprofit admin sees all three. A staff member sees only "Waiting", and only
 * while the admin has delegated approvals to them. Everyone else sees a short note.
 * The server (vetVolunteer, grantVettingHelp, the worker's set-role guard) is what
 * actually decides who may act; this page just shows the right tools.
 */
import { useEffect, useState } from 'react'
import { useQuery, useUsers } from 'deepspace'
import { useSearchParams } from 'react-router-dom'
import { EmptyState, Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui'
import { ErrorNote, Loading, Page } from '../../../components/Page'
import { ApprovedVolunteers } from '../../../components/admin/ApprovedVolunteers'
import { AuditLog } from '../../../components/admin/AuditLog'
import { Schools } from '../../../components/admin/Schools'
import { ReviewQueue } from '../../../components/admin/ReviewQueue'
import { ProgramStaff } from '../../../components/admin/StaffAccess'
import { markAdminLanded, useAccess, type Access, type StatusRow } from '../../../components/admin/shared'
import { formatInstant } from '../../../lib/labels'
import { useMe, type ProfileRow } from '../../../lib/me'

const DECISION_ACTIONS = ['approve', 'reject', 'vet', 'grant_vetting_help', 'end_vetting_help', 'grant_staff', 'remove_staff', 'staff_change_refused', 'create_school', 'update_school']

export default function ApprovalsPage() {
  const me = useMe()
  const access = useAccess(me.ready && me.isStaff)
  if (!me.ready || (me.isStaff && access === null)) return <Loading />
  if (!me.isStaff || !access?.canVet) {
    return (
      <Page title="Approvals">
        <EmptyState
          title="For the program admin"
          description="Volunteer approvals are made by the program admin, or by staff the admin has delegated to while they’re away."
        />
      </Page>
    )
  }
  return <ApprovalsDesk access={access} />
}

function ApprovalsDesk({ access }: { access: Access }) {
  const { nonprofitAdmin, vettingHelpEndsAt: delegatedUntil } = access
  // After this, Board shows the board for the rest of the session (home.tsx).
  useEffect(() => {
    if (nonprofitAdmin) markAdminLanded()
  }, [nonprofitAdmin])
  const statuses = useQuery<StatusRow>('volunteer_status', { limit: 500 })
  const profiles = useQuery<ProfileRow>('profiles', { limit: 500 })
  const { users } = useUsers()
  const [params] = useSearchParams()
  const [tab, setTab] = useState<string | null>(null)

  const profileById = new Map(profiles.records.map((r) => [r.data.userId, r.data]))
  const nameOf = (id: string) => profileById.get(id)?.displayName || users.find((u) => u.id === id)?.name || 'Unknown user'
  const queue = statuses.records
    .filter((r) => r.data.status === 'applied' || r.data.status === 'renewal_pending' || r.data.status === 'vetted')
    .map((r) => ({ ...r.data, profile: profileById.get(r.data.userId) ?? null }))

  const approvedCount = statuses.records.filter((r) => r.data.status === 'approved').length

  const waiting =
    statuses.status === 'loading' || profiles.status === 'loading' ? (
      <Loading />
    ) : statuses.status === 'error' ? (
      <ErrorNote message={statuses.error || 'Could not load applications.'} />
    ) : (
      <ReviewQueue access={access} queue={queue} />
    )

  return (
    <Page
      title="Approvals"
      intro={
        nonprofitAdmin
          ? 'Review each application and decide. Your decision is final. Away for a while? Delegate approvals to a staff member.'
          : `The program admin delegated approvals to you until ${formatInstant(delegatedUntil)}. Your decisions are final.`
      }
      wide
    >
      {nonprofitAdmin ? (
        <Tabs value={tab ?? params.get('tab') ?? 'waiting'} onValueChange={(v) => setTab(String(v))}>
          <TabsList className="flex-wrap">
            <TabsTrigger value="waiting">Waiting{queue.length ? ` (${queue.length})` : ''}</TabsTrigger>
            <TabsTrigger value="approved">Approved{approvedCount ? ` (${approvedCount})` : ''}</TabsTrigger>
            <TabsTrigger value="schools">Schools</TabsTrigger>
            <TabsTrigger value="delegate">Delegate &amp; staff</TabsTrigger>
            <TabsTrigger value="decisions">Decisions</TabsTrigger>
          </TabsList>
          <TabsContent value="waiting" className="pt-6">
            {waiting}
          </TabsContent>
          <TabsContent value="approved" className="pt-6">
            <ApprovedVolunteers nameOf={nameOf} />
          </TabsContent>
          <TabsContent value="schools" className="pt-6">
            <Schools editable />
          </TabsContent>
          <TabsContent value="delegate" className="pt-6">
            <ProgramStaff access={access} />
          </TabsContent>
          <TabsContent value="decisions" className="pt-6">
            <AuditLog nameOf={nameOf} actions={DECISION_ACTIONS} />
          </TabsContent>
        </Tabs>
      ) : (
        waiting
      )}
    </Page>
  )
}

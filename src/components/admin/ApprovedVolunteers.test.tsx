import { describe, expect, it, vi } from 'vitest'
import { renderToString } from 'react-dom/server'

const now = Math.floor(Date.now() / 1000)
const DAY = 86400
const data: Record<string, unknown[]> = {
  volunteer_status: [
    { recordId: 'a', data: { userId: 'u_ana', status: 'approved', qualificationType: 'RN license', licenseNumber: 'RN123', clearanceExpiresAt: now + 200 * DAY, approvedBy: 'u_owner' } },
    { recordId: 'b', data: { userId: 'u_ben', status: 'approved', qualificationType: 'None required', clearanceExpiresAt: now + 10 * DAY, approvedBy: 'u_owner' } },
    { recordId: 'c', data: { userId: 'u_cy', status: 'approved', clearanceExpiresAt: now - DAY, approvedBy: 'u_staff' } },
  ],
  profiles: [
    { recordId: 'pa', data: { userId: 'u_ana', displayName: 'Ana Ruiz', profession: 'Registered nurse', employer: 'Rady Children’s' } },
    { recordId: 'pb', data: { userId: 'u_ben', displayName: 'Ben Okafor', profession: 'Electrician', employer: '' } },
    { recordId: 'pc', data: { userId: 'u_cy', displayName: 'Cy Lee', profession: 'Civil engineer', employer: 'City of SD' } },
  ],
  audit_log: [{ recordId: 'l1', createdAt: '2026-10-01T17:00:00.000Z', data: { action: 'approve', targetId: 'u_ana', toState: 'approved' } }],
  claims: [
    { recordId: 'k1', data: { volunteerId: 'u_ana', status: 'active' } },
    { recordId: 'k2', data: { volunteerId: 'u_ana', status: 'active' } },
    { recordId: 'k3', data: { volunteerId: 'u_ben', status: 'withdrawn' } },
  ],
}
vi.mock('deepspace', () => ({
  useQuery: (c: string, opts?: { where?: Record<string, unknown> }) => ({
    status: 'ready',
    records: (data[c] ?? []).filter((r) => {
      const d = (r as { data: Record<string, unknown> }).data
      return Object.entries(opts?.where ?? {}).every(([k, v]) => d[k] === v)
    }),
  }),
}))

describe('Approved volunteers roster', () => {
  it('lists approved volunteers alphabetically with checks, clearance flags, approver and bookings', async () => {
    const { ApprovedVolunteers } = await import('./ApprovedVolunteers')
    const html = renderToString(<ApprovedVolunteers nameOf={(id) => (id === 'u_owner' ? 'Program Admin' : 'Staff Helper')} />)
    const text = html.replace(/<!-- -->/g, '')
    expect(text).toContain('3 approved volunteers')
    expect(html.indexOf('Ana Ruiz')).toBeLessThan(html.indexOf('Ben Okafor'))
    expect(html.indexOf('Ben Okafor')).toBeLessThan(html.indexOf('Cy Lee'))
    expect(text).toContain('License RN123')
    expect(text).toContain('Expired') // Cy
    expect(text).toContain('Soon') // Ben, 10 days
    expect(text).toContain('by Program Admin')
    expect(text).toContain('by Staff Helper')
    expect(html).not.toMatch(/@/) // no emails on the roster
    // Bookings: Ana has 2 active claims; Ben's only claim was withdrawn.
    expect(text).toMatch(/Ana Ruiz[\s\S]*?tabular-nums">2</)
  })
})

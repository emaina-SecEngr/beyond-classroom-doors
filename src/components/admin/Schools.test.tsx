import { describe, expect, it, vi } from 'vitest'
import { renderToString } from 'react-dom/server'

const data: Record<string, unknown[]> = {
  schools: [
    { recordId: 's2', data: { name: 'Lincoln High', district: 'San Diego Unified', city: 'San Diego', address: '4777 Imperial Ave', active: true } },
    { recordId: 's1', data: { name: 'Hoover High', district: 'San Diego Unified', city: 'San Diego', address: '4474 El Cajon Blvd', active: false } },
  ],
  role_assignments: [{ recordId: 'r1', data: { userId: 'u_kim', role: 'teacher', schoolId: 's2' } }],
  teacher_invites: [
    { recordId: 'i1', data: { name: 'Ms. Rivera', email: 'rivera@lincoln.edu', schoolId: 's2', status: 'pending' } },
    { recordId: 'i2', data: { name: 'Old Invite', email: 'old@lincoln.edu', schoolId: 's2', status: 'revoked' } },
  ],
}
vi.mock('deepspace', () => ({
  useQuery: (c: string) => ({ status: 'ready', records: data[c] ?? [] }),
  useUsers: () => ({ users: [{ id: 'u_kim', name: 'Mr. Kim', email: 'kim@lincoln.edu', role: 'member' }], usersLoaded: true }),
  getAuthToken: async () => null,
}))
vi.mock('@/components/ui', async () => {
  const real = await vi.importActual<Record<string, unknown>>('@/components/ui')
  return { ...real, useToast: () => ({ success: () => {}, error: () => {} }) }
})

describe('Schools list', () => {
  it('lists schools alphabetically, marks inactive ones, and shows each school’s teachers and pending invites', async () => {
    const { Schools } = await import('./Schools')
    const admin = renderToString(<Schools editable />).replace(/<!-- -->/g, '')
    expect(admin.indexOf('Hoover High')).toBeLessThan(admin.indexOf('Lincoln High'))
    expect(admin).toContain('Inactive')
    expect(admin).toContain('Add a school')
    expect(admin).toContain('Mr. Kim')
    expect(admin).toContain('Has access')
    expect(admin).toContain('Ms. Rivera')
    expect(admin).toContain('Invited')
    expect(admin).not.toContain('Old Invite') // revoked invites are hidden
    expect(admin).toContain('Add teacher')
  })
  it('read-only for anyone but the program admin', async () => {
    const { Schools } = await import('./Schools')
    const staff = renderToString(<Schools editable={false} />)
    expect(staff).not.toContain('Add a school')
    expect(staff).not.toContain('Add teacher')
    expect(staff).not.toContain('Cancel invite')
  })
})

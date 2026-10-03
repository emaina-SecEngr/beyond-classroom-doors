import { describe, expect, it, vi } from 'vitest'
import { renderToString } from 'react-dom/server'

vi.mock('deepspace', () => ({
  useQuery: () => ({
    status: 'ready',
    records: [
      { recordId: 's2', data: { name: 'Lincoln High', district: 'San Diego Unified', city: 'San Diego', address: '4777 Imperial Ave', active: true } },
      { recordId: 's1', data: { name: 'Hoover High', district: 'San Diego Unified', city: 'San Diego', address: '4474 El Cajon Blvd', active: false } },
    ],
  }),
  getAuthToken: async () => null,
}))
vi.mock('@/components/ui', async () => {
  const real = await vi.importActual<Record<string, unknown>>('@/components/ui')
  return { ...real, useToast: () => ({ success: () => {}, error: () => {} }) }
})

describe('Schools list', () => {
  it('lists schools alphabetically, marks inactive ones, and offers editing only to the program admin', async () => {
    const { Schools } = await import('./Schools')
    const admin = renderToString(<Schools editable />).replace(/<!-- -->/g, '')
    expect(admin.indexOf('Hoover High')).toBeLessThan(admin.indexOf('Lincoln High'))
    expect(admin).toContain('Inactive')
    expect(admin).toContain('Add a school')
    expect(admin).toContain('4777 Imperial Ave')
    const staff = renderToString(<Schools editable={false} />)
    expect(staff).not.toContain('Add a school')
    expect(staff).not.toContain('>Edit<')
  })
})

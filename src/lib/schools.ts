/**
 * Reading the district's schools (D9). Readable by every signed-in member.
 * Writes go through the program admin's createSchool / updateSchool actions.
 */
import { useQuery } from 'deepspace'

export interface School {
  name: string
  district: string
  city: string
  address: string
  active: boolean | number
}
export type SchoolRecord = School & { id: string }

export function useSchools(): { schools: SchoolRecord[]; byId: Map<string, SchoolRecord>; status: 'loading' | 'ready' | 'error'; error?: string } {
  const { records, status, error } = useQuery<School>('schools', { limit: 200 })
  const schools = records.map((r) => ({ id: r.recordId, ...r.data })).sort((a, b) => a.name.localeCompare(b.name))
  return { schools, byId: new Map(schools.map((s) => [s.id, s])), status, error }
}

export const schoolLine = (s: SchoolRecord | undefined | null): string => (s ? [s.name, s.city].filter(Boolean).join(', ') : '')

/** Street address plus city — the city only when the address doesn't already include it. */
export const fullAddress = (s: Pick<School, 'address' | 'city'> | undefined | null): string => {
  if (!s) return ''
  const addr = (s.address ?? '').trim()
  const city = (s.city ?? '').trim()
  return city && !addr.toLowerCase().includes(city.toLowerCase()) ? [addr, city].filter(Boolean).join(', ') : addr
}

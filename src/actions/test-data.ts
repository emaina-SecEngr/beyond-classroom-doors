/**
 * Test data for manual testing (D16) — San Diego Unified high schools.
 *
 * Names and front-office addresses are public (San Diego Unified's school
 * directory). No student data, no real teachers: test teachers are the email
 * addresses the program admin types in (their own test accounts), and every
 * sample session is marked "[Test data]" so it's obvious on the board.
 */
import { GRADES, TIME_BANDS, TOPICS } from '../schemas/shared'

export const TEST_DISTRICT = 'San Diego Unified'
export const TEST_MARK = '[Test data]'

export const TEST_SCHOOLS = [
  { name: 'Lincoln High', address: '4777 Imperial Ave., San Diego, CA 92113' },
  { name: 'Hoover High', address: '4474 El Cajon Blvd., San Diego, CA 92115' },
  { name: 'Crawford High', address: '4191 Colts Way, San Diego, CA 92115' },
  { name: 'San Diego High', address: '1405 Park Blvd., San Diego, CA 92101' },
  { name: 'Point Loma High', address: '2335 Chatsworth Blvd., San Diego, CA 92106' },
] as const

type Grade = (typeof GRADES)[number]
type Topic = (typeof TOPICS)[number]
type TimeBand = (typeof TIME_BANDS)[number]

/** Two sample sessions per test teacher: different topic, grade and time of day. */
export const TEST_SESSIONS: { topic: Topic; grade: Grade; timeBand: TimeBand; startTime: string; room: string; classLabel: string; studentCount: number; daysOut: number }[] = [
  { topic: 'healthcare', grade: '11', timeBand: 'morning', startTime: '09:30', room: 'B-204', classLabel: 'Period 2 · Health Science', studentCount: 28, daysOut: 10 },
  { topic: 'engineering', grade: '10', timeBand: 'afternoon', startTime: '13:15', room: 'Lab 3', classLabel: 'Period 5 · Intro to Engineering', studentCount: 24, daysOut: 17 },
]

/**
 * A weekday at least `daysOut` days after `nowMs`, as YYYY-MM-DD.
 * Saturdays and Sundays roll forward to Monday.
 */
export function testSessionDate(nowMs: number, daysOut: number): string {
  const d = new Date(nowMs + daysOut * 86400_000)
  const dow = d.getUTCDay()
  if (dow === 6) d.setUTCDate(d.getUTCDate() + 2)
  if (dow === 0) d.setUTCDate(d.getUTCDate() + 1)
  return d.toISOString().slice(0, 10)
}

export function testTeacherName(schoolName: string, n: number): string {
  return `Test Teacher ${n} (${schoolName})`
}

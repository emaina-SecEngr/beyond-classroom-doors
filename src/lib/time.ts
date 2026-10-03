/**
 * Session time in San Diego. Pure functions, shared by server actions and pages
 * so both sides agree on when a session starts (and so on the 48-hour rule).
 * The server's answer is the one that counts; the page uses this only to pick
 * which button to show.
 */
import type { TimeBand } from '../schemas/shared'

export const BAND_START: Record<TimeBand, string> = { morning: '08:00', midday: '11:00', afternoon: '13:00' }

/** Offset of America/Los_Angeles from UTC, in minutes, at a given instant (DST-aware). */
function laOffsetMinutes(utcMs: number): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Los_Angeles',
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).formatToParts(new Date(utcMs))
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value)
  const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'))
  return Math.round((asUtc - utcMs) / 60000)
}

/** Session start in Unix seconds: the session's date + exact start time (or the band's start), San Diego time. */
export function sessionStartSeconds(sessionDate: number, timeBand: TimeBand, startTime?: string | null): number {
  const hhmm = startTime && /^([01]\d|2[0-3]):[0-5]\d$/.test(startTime) ? startTime : BAND_START[timeBand]
  const [h, m] = hhmm.split(':').map(Number)
  const naiveUtcMs = sessionDate * 1000 + (h * 60 + m) * 60000
  const offset = laOffsetMinutes(naiveUtcMs)
  return Math.floor((naiveUtcMs - offset * 60000) / 1000)
}

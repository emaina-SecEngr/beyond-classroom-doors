/* home pattern: editorial landing — split-flap session board hero, then how it works, then who it's for. */
/**
 * Design Direction
 *
 * Product: Beyond Classroom Doors brings vetted local professionals — nurses,
 *   electricians, engineers — into San Diego high school classrooms for
 *   one-hour career sessions.
 * Emotion: Clipping on a visitor badge at a school front office: you've been
 *   checked, and today you belong here.
 * Metaphor: A paper room schedule taped to a school front-office counter in
 *   morning light, a visitor badge clipped beside it.
 * References: An airport split-flap departure board; a library due-date card;
 *   a museum admission wristband.
 * Signature: A split-flap board listing upcoming sessions
 *   ("11TH GRADE · NURSING · TUE").
 * Approval: one final decision by the program admin (decisions D3b).
 * Hero: Four board rows flip in, 0.4s apart; at 3s, row two flips
 *   OPEN → CLAIMED; then the board stays still.
 *
 * Style Tile
 * - Color: Warm paper-cream dominant, deep chalkboard-green accent; muted
 *   everywhere except CTAs, which use the full-strength green.
 * - Type: Fraunces (heading) + Source Sans 3 (body).
 * - Theme: Light (front-office in src/themes.css).
 * - Art direction: Editorial — Fraunces headlines, asymmetric two-column
 *   "how it works" rows, schedule-style hierarchy.
 * - Motion: Mechanical — split-flap rows snap with linear easing; motion only
 *   confirms a state change (OPEN → CLAIMED); nothing drifts or floats.
 *   CSS keyframes only (prerender-safe), off under prefers-reduced-motion.
 * - Voice: Second person, never starts with "we", short sentences, no
 *   exclamation points.
 *
 * STATIC page: no DeepSpace providers, no auth call, no records socket. The
 * board here is a labeled example; the live board is /home.
 */

import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { PublicFooter, PublicHeader } from '../components/PublicChrome'
import { Seo } from '../components/Seo'
import { cn } from '../lib/utils'
import { seo } from '../seo'

const BOARD = [
  { day: 'TUE', time: '08:30', grade: '11TH', career: 'NURSING', status: 'open' },
  { day: 'WED', time: '11:15', grade: '09TH', career: 'ELECTRICAL', status: 'flips' },
  { day: 'THU', time: '13:00', grade: '12TH', career: 'CIVIL ENG', status: 'open' },
  { day: 'FRI', time: '09:45', grade: '10TH', career: 'SOFTWARE', status: 'claimed' },
] as const

const STEPS = [
  {
    n: '01',
    title: 'A teacher asks for a session.',
    body: 'Grade, career area, date and time of day. Class-level facts only. No student names, ever.',
  },
  {
    n: '02',
    title: 'The nonprofit checks every volunteer.',
    body: 'Identity confirmed, any professional license looked up, school clearance recorded: TB screening and background check.',
  },
  {
    n: '03',
    title: 'The program admin decides. That’s final.',
    body: 'One accountable person approves or rejects. The decision is recorded with their name, and nobody can quietly change it.',
  },
  {
    n: '04',
    title: 'An approved volunteer claims it.',
    body: 'First to claim gets it. Only then do they see the room, start time and arrival instructions.',
  },
]

const FLAP_CSS = `
.bcd-row { transform-origin: 50% 0; animation: bcd-flip 0.32s linear both; }
.bcd-row:nth-child(1) { animation-delay: 0.2s; }
.bcd-row:nth-child(2) { animation-delay: 0.6s; }
.bcd-row:nth-child(3) { animation-delay: 1.0s; }
.bcd-row:nth-child(4) { animation-delay: 1.4s; }
@keyframes bcd-flip {
  0% { transform: perspective(600px) rotateX(-90deg); opacity: 0; }
  60% { transform: perspective(600px) rotateX(12deg); opacity: 1; }
  100% { transform: perspective(600px) rotateX(0deg); opacity: 1; }
}
.bcd-status { position: relative; display: inline-grid; }
.bcd-status > * { grid-area: 1 / 1; }
.bcd-out { animation: bcd-out 0.18s linear 3s both; transform-origin: 50% 100%; }
.bcd-in { animation: bcd-in 0.18s linear 3.18s both; transform-origin: 50% 0; }
@keyframes bcd-out { from { transform: perspective(300px) rotateX(0); } to { transform: perspective(300px) rotateX(90deg); visibility: hidden; } }
@keyframes bcd-in { from { transform: perspective(300px) rotateX(-90deg); } to { transform: perspective(300px) rotateX(0); } }
.bcd-tile { position: relative; }
.bcd-tile::after { content: ''; position: absolute; left: 0; right: 0; top: 50%; border-top: 1px solid currentColor; opacity: 0.18; }
@media (prefers-reduced-motion: reduce) {
  .bcd-row, .bcd-out, .bcd-in { animation: none; }
  .bcd-out { visibility: hidden; }
}
`

function Tile({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <span className={cn('bcd-tile inline-block rounded-sm bg-background/10 px-1.5 py-1 font-mono text-[13px] font-semibold tracking-[0.12em] text-background sm:text-sm', className)}>
      {children}
    </span>
  )
}

function StatusTile({ state }: { state: 'open' | 'claimed' }) {
  return state === 'open' ? (
    <Tile className="bg-background text-foreground">OPEN</Tile>
  ) : (
    <Tile className="bg-primary text-primary-foreground">CLAIMED</Tile>
  )
}

function SessionBoard() {
  return (
    <figure className="w-full">
      <div className="rounded-md bg-foreground p-4 shadow-lg sm:p-5">
        <div className="mb-3 flex items-center justify-between font-mono text-[11px] tracking-[0.2em] text-background">
          <span>CAREER SESSIONS</span>
          <span>ROOM SCHEDULE</span>
        </div>
        <ol className="space-y-2" aria-label="Example upcoming sessions">
          {BOARD.map((r) => (
            <li key={r.day} className="bcd-row grid grid-cols-[auto_auto_1fr_auto] items-center gap-2">
              <Tile>{r.day}</Tile>
              <Tile>{r.grade}</Tile>
              <Tile className="truncate">{r.career}</Tile>
              {r.status === 'flips' ? (
                <span className="bcd-status">
                  <span className="bcd-out">
                    <StatusTile state="open" />
                  </span>
                  <span className="bcd-in">
                    <StatusTile state="claimed" />
                  </span>
                </span>
              ) : (
                <StatusTile state={r.status} />
              )}
            </li>
          ))}
        </ol>
      </div>
      <figcaption className="mt-2 text-xs text-muted-foreground">Example board. The live one is inside the app.</figcaption>
    </figure>
  )
}

export default function Landing() {
  return (
    <>
      <Seo {...seo} path="/" />
      <style>{FLAP_CSS}</style>
      <div data-testid="static-landing" className="min-h-screen bg-background text-foreground">
        <PublicHeader />

        <main>
          {/* ── Hero ─────────────────────────────────────────────── */}
          <section className="mx-auto grid max-w-6xl items-center gap-12 px-4 py-16 sm:px-6 md:grid-cols-[1.05fr_1fr] md:py-24">
            <div>
              <p className="mb-4 text-xs font-semibold uppercase tracking-[0.18em] text-primary">San Diego high schools · career sessions</p>
              <h1 className="font-display text-4xl font-semibold leading-[1.08] tracking-tight sm:text-5xl md:text-[3.5rem]">
                Real careers walk into class, one hour at a time.
              </h1>
              <p className="mt-6 max-w-xl text-lg text-muted-foreground">
                Nurses, electricians and engineers visit a high school classroom for an hour. Every volunteer is checked and approved before
                any visit.
              </p>
              <div className="mt-8 flex flex-wrap gap-3">
                <Link
                  to="/volunteer"
                  className="inline-flex h-11 items-center rounded-md bg-primary px-5 text-sm font-semibold text-primary-foreground hover:bg-primary/90"
                >
                  Volunteer your hour
                </Link>
                <Link to="/home" className="inline-flex h-11 items-center rounded-md border border-input px-5 text-sm font-semibold hover:bg-accent">
                  See open sessions
                </Link>
              </div>
            </div>
            <SessionBoard />
          </section>

          {/* ── How it works ─────────────────────────────────────── */}
          <section id="how" className="border-t border-border bg-card">
            <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6 md:py-20">
              <h2 className="font-display text-3xl font-semibold tracking-tight">How a session happens</h2>
              <p className="mt-2 max-w-xl text-muted-foreground">Four steps. Nobody enters a classroom before the program admin approves them.</p>
              <ol className="mt-10 divide-y divide-border border-y border-border">
                {STEPS.map((s) => (
                  <li key={s.n} className="grid gap-2 py-6 md:grid-cols-[6rem_1fr_1.3fr] md:gap-8">
                    <span className="font-mono text-sm text-muted-foreground">{s.n}</span>
                    <h3 className="font-display text-xl font-semibold">{s.title}</h3>
                    <p className="text-muted-foreground">{s.body}</p>
                  </li>
                ))}
              </ol>
            </div>
          </section>

          {/* ── Who it's for ─────────────────────────────────────── */}
          <section id="who" className="mx-auto max-w-6xl px-4 py-16 sm:px-6 md:py-20">
            <h2 className="font-display text-3xl font-semibold tracking-tight">Who it’s for</h2>
            <div className="mt-10 grid gap-10 md:grid-cols-3">
              <div>
                <h3 className="font-display text-xl font-semibold">Professionals</h3>
                <p className="mt-2 text-muted-foreground">
                  Give one hour to show students what your work is really like. Apply once; claim sessions that fit your week.
                </p>
                <Link to="/volunteer" className="mt-4 inline-block text-sm font-semibold text-primary underline-offset-4 hover:underline">
                  How volunteering works
                </Link>
              </div>
              <div>
                <h3 className="font-display text-xl font-semibold">Teachers</h3>
                <p className="mt-2 text-muted-foreground">
                  Ask for the career your class wants to meet. You choose the date; you stay in the room.
                </p>
                <Link to="/teach" className="mt-4 inline-block text-sm font-semibold text-primary underline-offset-4 hover:underline">
                  Open the teacher desk
                </Link>
              </div>
              <div>
                <h3 className="font-display text-xl font-semibold">Schools and families</h3>
                <p className="mt-2 text-muted-foreground">
                  Students never sign in, and no student data is stored. Every approval and change is recorded.
                </p>
                <a href="#how" className="mt-4 inline-block text-sm font-semibold text-primary underline-offset-4 hover:underline">
                  See the safeguards
                </a>
              </div>
            </div>
          </section>

          {/* ── Safeguards strip ─────────────────────────────────── */}
          <section className="border-y border-border bg-secondary">
            <dl className="mx-auto grid max-w-6xl gap-6 px-4 py-10 text-sm sm:grid-cols-2 sm:px-6 md:grid-cols-4">
              <div>
                <dt className="font-semibold">No student data</dt>
                <dd className="mt-1 text-muted-foreground">Requests carry grade and class size only.</dd>
              </div>
              <div>
                <dt className="font-semibold">One accountable approver</dt>
                <dd className="mt-1 text-muted-foreground">The program admin decides, and the decision is final.</dd>
              </div>
              <div>
                <dt className="font-semibold">Clearance tracked</dt>
                <dd className="mt-1 text-muted-foreground">Expired clearance means no new sessions.</dd>
              </div>
              <div>
                <dt className="font-semibold">Everything logged</dt>
                <dd className="mt-1 text-muted-foreground">Each decision records who made it, and when.</dd>
              </div>
            </dl>
          </section>
        </main>

        <PublicFooter />
      </div>
    </>
  )
}

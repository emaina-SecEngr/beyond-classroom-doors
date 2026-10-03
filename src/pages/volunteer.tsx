/**
 * Volunteer page — public, STATIC, prerendered (like the landing page).
 *
 * For a professional deciding whether to give an hour: what it involves, what
 * they'll need, how approval works, and an Apply button. Applying itself happens
 * inside the app (/apply), which asks them to sign in first.
 *
 * Voice and look follow the Design Direction in src/pages/index.tsx.
 */
import { Link } from 'react-router-dom'
import { PROGRAM_EMAIL, PublicFooter, PublicHeader } from '../components/PublicChrome'
import { Seo } from '../components/Seo'
import { seo } from '../seo'

const NEEDS = [
  { item: 'A photo ID', note: 'Checked in person or on a video call.' },
  { item: 'Your professional license', note: 'Only if your field requires one. The program looks it up in public records.' },
  { item: 'School clearance', note: 'A TB screening and a background check, as the school requires. The program team tells you exactly what’s needed.' },
  { item: 'About an hour, now and then', note: 'One class period plus travel. You pick which sessions fit your week.' },
]

const STEPS = [
  { n: '1', title: 'Tell us about your work', body: 'Sign in and fill in a short profile: your name, profession and employer. It takes two minutes.' },
  { n: '2', title: 'The program checks and decides', body: 'The program admin confirms your ID, license and clearance, then approves you. That decision is final.' },
  { n: '3', title: 'Pick a session', body: 'Open sessions show grade, career area, date and time of day. Claim one that fits.' },
  { n: '4', title: 'Walk into class', body: 'You get the room and arrival instructions. Confirm you’re coming, sign in at the front office, and meet the class.' },
]

const FAQ = [
  { q: 'Do I need teaching experience?', a: 'No. Talk about your work the way you would to a curious friend. The teacher stays in the room.' },
  { q: 'What do students see about me?', a: 'Your name and profession. Never your email or phone number.' },
  { q: 'What if plans change?', a: 'Withdraw in the app up to 48 hours before. Closer than that, send the program team a change request.' },
  { q: 'Does it cost anything?', a: 'No. Volunteering is free.' },
]

export default function VolunteerPage() {
  return (
    <>
      <Seo
        {...seo}
        title="Volunteer | Beyond Classroom Doors"
        description="Give one hour to show a San Diego high school class what your work is really like. What you'll need, how approval works, and how to apply."
        path="/volunteer"
      />
      <div className="min-h-screen bg-background text-foreground">
        <PublicHeader current="/volunteer" />

        <main>
          {/* ── Intro ─────────────────────────────────────────── */}
          <section className="mx-auto max-w-6xl px-4 py-16 sm:px-6 md:py-20">
            <p className="mb-4 text-xs font-semibold uppercase tracking-[0.18em] text-primary">Volunteer</p>
            <h1 className="max-w-3xl font-display text-4xl font-semibold leading-[1.1] tracking-tight sm:text-5xl">
              Give one hour. Show a class what your work is really like.
            </h1>
            <p className="mt-6 max-w-2xl text-lg text-muted-foreground">
              Students meet the nurse, the electrician, the engineer behind the job title. You bring the stories; the teacher brings the class.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link
                to="/apply"
                className="inline-flex h-11 items-center rounded-md bg-primary px-5 text-sm font-semibold text-primary-foreground hover:bg-primary/90"
              >
                Apply to volunteer
              </Link>
              <Link to="/home" className="inline-flex h-11 items-center rounded-md border border-input px-5 text-sm font-semibold hover:bg-accent">
                See open sessions
              </Link>
            </div>
            <p className="mt-3 text-xs text-muted-foreground">You’ll sign in first. It’s free.</p>
          </section>

          {/* ── What you'll need ──────────────────────────────── */}
          <section className="border-t border-border bg-card">
            <div className="mx-auto grid max-w-6xl gap-10 px-4 py-16 sm:px-6 md:grid-cols-[1fr_1.6fr] md:py-20">
              <div>
                <h2 className="font-display text-3xl font-semibold tracking-tight">What you’ll need</h2>
                <p className="mt-2 text-muted-foreground">Every volunteer goes through the same checks before any visit.</p>
              </div>
              <ul className="divide-y divide-border border-y border-border">
                {NEEDS.map((n) => (
                  <li key={n.item} className="grid gap-1 py-5 sm:grid-cols-[14rem_1fr] sm:gap-6">
                    <span className="font-semibold">{n.item}</span>
                    <span className="text-muted-foreground">{n.note}</span>
                  </li>
                ))}
              </ul>
            </div>
          </section>

          {/* ── How it works ──────────────────────────────────── */}
          <section className="mx-auto max-w-6xl px-4 py-16 sm:px-6 md:py-20">
            <h2 className="font-display text-3xl font-semibold tracking-tight">From application to classroom</h2>
            <ol className="mt-10 grid gap-8 md:grid-cols-4">
              {STEPS.map((s) => (
                <li key={s.n}>
                  <span className="inline-flex h-8 w-8 items-center justify-center rounded-sm bg-primary font-mono text-sm font-semibold text-primary-foreground">
                    {s.n}
                  </span>
                  <h3 className="mt-4 font-display text-xl font-semibold">{s.title}</h3>
                  <p className="mt-2 text-muted-foreground">{s.body}</p>
                </li>
              ))}
            </ol>
          </section>

          {/* ── Questions ─────────────────────────────────────── */}
          <section className="border-t border-border bg-secondary">
            <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
              <h2 className="font-display text-3xl font-semibold tracking-tight">Questions</h2>
              <dl className="mt-8 grid gap-8 md:grid-cols-2">
                {FAQ.map((f) => (
                  <div key={f.q}>
                    <dt className="font-semibold">{f.q}</dt>
                    <dd className="mt-1 text-muted-foreground">{f.a}</dd>
                  </div>
                ))}
              </dl>
              <p className="mt-10 text-sm text-muted-foreground">
                Something else? Email{' '}
                <a href={`mailto:${PROGRAM_EMAIL}?subject=${encodeURIComponent('Volunteering question')}`} className="font-semibold text-primary underline-offset-4 hover:underline">
                  {PROGRAM_EMAIL}
                </a>
                .
              </p>
            </div>
          </section>

          {/* ── Closing CTA ───────────────────────────────────── */}
          <section className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
            <div className="flex flex-col items-start justify-between gap-6 rounded-md bg-foreground p-8 text-background md:flex-row md:items-center">
              <p className="font-display text-2xl font-semibold">Ready to give an hour?</p>
              <Link
                to="/apply"
                className="inline-flex h-11 items-center rounded-md bg-background px-5 text-sm font-semibold text-foreground hover:bg-secondary"
              >
                Apply to volunteer
              </Link>
            </div>
          </section>
        </main>

        <PublicFooter />
      </div>
    </>
  )
}

/**
 * Gated routes. Any file under src/pages/(app)/(protected)/ requires sign-in.
 * The `(protected)` folder is a Generouted route group — parentheses mean
 * it doesn't appear in the URL. For a dynamic page that does NOT require
 * sign-in, put it directly under src/pages/(app)/; for a static page, put it
 * at the top level of src/pages/.
 *
 * Children may call data hooks like `useUser()` safely because the parent
 * (app)/_layout.tsx mounts <RecordProvider> above this layout.
 *
 * The `fallback` keeps signed-out visitors inside the app's own chrome
 * (without it, AuthGate shows the SDK's full-screen, non-dismissible
 * overlay). The sign-in overlay opens on demand and can be dismissed.
 */

import { useState } from 'react'
import { Link, Outlet, useLocation } from 'react-router-dom'
import { AuthGate, AuthOverlay } from 'deepspace'
import { Button } from '@/components/ui'
import { signInCopy } from '../../../lib/signin'

export default function ProtectedLayout() {
  return (
    <AuthGate fallback={<SignedOutPanel />}>
      <Outlet />
    </AuthGate>
  )
}

function SignedOutPanel() {
  const { pathname } = useLocation()
  // D22: someone applying to volunteer gets an application start, not a login wall.
  return pathname === '/apply' ? <ApplyStart /> : <SignInGate />
}

function SignInGate() {
  const [showAuthModal, setShowAuthModal] = useState(false)

  return (
    <div className="flex min-h-[60vh] items-center justify-center px-6 py-20">
      <div className="w-full max-w-sm rounded-lg border border-border bg-card p-8 text-center">
        <h1 className="text-lg font-semibold text-foreground">Sign in to continue</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          This page is for signed-in members. New here? Continuing with Google or GitHub creates your account.
        </p>
        <Button className="mt-6 w-full" onClick={() => setShowAuthModal(true)}>
          Sign in or create an account
        </Button>
        <Link
          to="/"
          className="mt-4 inline-block text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
        >
          Back to home
        </Link>
      </div>

      {showAuthModal && <AuthOverlay onClose={() => setShowAuthModal(false)} {...signInCopy()} />}
    </div>
  )
}

const APPLY_STEPS = [
  { title: 'Create your account', body: 'Continue with Google or GitHub. It’s free, and there’s no separate password to remember.' },
  { title: 'Fill in a short application', body: 'Your name, profession and employer, any license, the schools you’d like to visit. About two minutes.' },
  { title: 'The program admin reviews it', body: 'They confirm your identity and check your clearance (TB test and background check). You’ll get a message when you’re approved.' },
  { title: 'Pick a session', body: 'Claim an open session at a school, or accept a teacher’s invitation.' },
]

function ApplyStart() {
  const [showAuthModal, setShowAuthModal] = useState(false)
  return (
    <div className="mx-auto max-w-2xl px-6 py-16">
      <p className="text-xs font-semibold uppercase tracking-widest text-primary">Volunteer application</p>
      <h1 className="mt-2 font-display text-3xl font-semibold tracking-tight">Apply to volunteer with a class</h1>
      <p className="mt-3 text-muted-foreground">One hour, one classroom, your real job. Here’s how it works.</p>
      <ol className="mt-8 space-y-4">
        {APPLY_STEPS.map((s, i) => (
          <li key={s.title} className="flex gap-4 rounded-md border border-border bg-card p-4">
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary text-sm font-semibold text-primary-foreground">{i + 1}</span>
            <div>
              <p className="font-medium">{s.title}</p>
              <p className="text-sm text-muted-foreground">{s.body}</p>
            </div>
          </li>
        ))}
      </ol>
      <div className="mt-8 flex flex-wrap items-center gap-4">
        <Button size="lg" onClick={() => setShowAuthModal(true)}>
          Create your account and apply
        </Button>
        <button type="button" className="text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline" onClick={() => setShowAuthModal(true)}>
          Already applied? Sign in
        </button>
      </div>
      <p className="mt-4 text-xs text-muted-foreground">Students never see your contact details. Only the teacher of a session you book does.</p>
      {showAuthModal && <AuthOverlay onClose={() => setShowAuthModal(false)} {...signInCopy('volunteer')} />}
    </div>
  )
}

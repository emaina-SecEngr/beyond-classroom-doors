/**
 * Header and footer for the public (static, prerendered) pages: the landing page
 * and the volunteer page. No DeepSpace hooks here — these pages render without
 * auth or a records connection.
 */
import { Link } from 'react-router-dom'
import { APP_NAME } from '../constants'
import { cn } from '../lib/utils'

export const PROGRAM_EMAIL = 'mainin2003@yahoo.com'

const NAV = [
  { to: '/#how', label: 'How it works' },
  { to: '/volunteer', label: 'Volunteer' },
  { to: '/#support', label: 'Support' },
]

export function PublicHeader({ current }: { current?: '/volunteer' }) {
  return (
    <header className="border-b border-border">
      <div className="mx-auto flex h-14 max-w-6xl items-center gap-3 px-4 sm:gap-6 sm:px-6">
        <Link to="/" className="min-w-0 truncate font-display text-base font-semibold sm:text-lg">
          {APP_NAME}
        </Link>
        <nav aria-label="Main" className="ml-auto flex shrink-0 items-center gap-4 text-sm text-muted-foreground sm:gap-6">
          {NAV.map((n) => {
            const className = cn('hover:text-foreground', n.to !== '/volunteer' && 'hidden sm:inline', current === n.to && 'font-semibold text-foreground')
            // Section anchors are plain links so the browser scrolls to them.
            return n.to.includes('#') ? (
              <a key={n.to} href={n.to} className={className}>
                {n.label}
              </a>
            ) : (
              <Link key={n.to} to={n.to} aria-current={current === n.to ? 'page' : undefined} className={className}>
                {n.label}
              </Link>
            )
          })}
        </nav>
        <Link to="/home" className="inline-flex h-9 shrink-0 items-center whitespace-nowrap rounded-md border border-input px-3 text-sm font-medium hover:bg-accent">
          Sign in
        </Link>
      </div>
    </header>
  )
}

export function PublicFooter() {
  return (
    <footer id="support" className="border-t border-border">
      <div className="mx-auto grid max-w-6xl gap-8 px-4 py-12 sm:px-6 md:grid-cols-[1.4fr_1fr_1fr]">
        <div>
          <p className="font-display text-lg font-semibold">{APP_NAME}</p>
          <p className="mt-2 max-w-sm text-sm text-muted-foreground">A pilot with one San Diego high school.</p>
        </div>
        <div>
          <h2 className="text-sm font-semibold">Support the program</h2>
          <p className="mt-2 text-sm text-muted-foreground">Donations aren’t taken online yet. Email to give or sponsor a school.</p>
          <a
            href={`mailto:${PROGRAM_EMAIL}?subject=${encodeURIComponent('Supporting Beyond Classroom Doors')}`}
            className="mt-3 inline-block text-sm font-semibold text-primary underline-offset-4 hover:underline"
          >
            {PROGRAM_EMAIL}
          </a>
        </div>
        <div>
          <h2 className="text-sm font-semibold">Get started</h2>
          <ul className="mt-2 space-y-1 text-sm text-muted-foreground">
            <li>
              <Link to="/volunteer" className="hover:text-foreground">
                Volunteer with a class
              </Link>
            </li>
            <li>
              <Link to="/home" className="hover:text-foreground">
                Session board
              </Link>
            </li>
            <li>
              <a href={`mailto:${PROGRAM_EMAIL}`} className="hover:text-foreground">
                Contact the program team
              </a>
            </li>
          </ul>
        </div>
      </div>
    </footer>
  )
}

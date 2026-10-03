/**
 * Navigation Config
 *
 * Add one entry per nav item. Routes are handled by generouted
 * (file-based routing in src/pages/), this just controls what
 * appears in the navigation bar.
 */

import type { Role } from './constants'

export interface NavItem {
  path: string
  label: string
  roles?: Role[]
  devOnly?: boolean
}

export const nav: NavItem[] = [
  { path: '/home', label: 'Board' },
  { path: '/my-sessions', label: 'My sessions' },
  { path: '/inbox', label: 'Inbox' },
  { path: '/apply', label: 'Profile' },
  // Program staff only (DeepSpace admin). Teacher and school-admin desks are app
  // roles, not DeepSpace roles, so they're linked from the board instead.
  { path: '/staff', label: 'Staff', roles: ['admin'] },
  { path: '/settings', label: 'Settings' },
  // The /api-status debug page still exists — add
  // `{ path: '/api-status', label: 'API Status', devOnly: true }` to surface it.
  // ── Features add nav items below this line ──
]

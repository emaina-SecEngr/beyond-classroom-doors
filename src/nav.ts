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
  /**
   * Who sees it (display only — every page and action re-checks on the server):
   *   'approvers'       the program admin, or staff while approvals are delegated to them
   *   'volunteer'       signed-in people with no staff or teacher role (D15)
   *   'teacher'         people with teacher access
   *   'team'            staff, the program admin and teachers — not volunteers
   *   'inbox'           everyone signed in except the program admin
   */
  show?: 'approvers' | 'volunteer' | 'teacher' | 'team' | 'inbox'
}

export const nav: NavItem[] = [
  // Volunteers (D15): My sessions · My teachers · Inbox · Profile — no board, no settings.
  { path: '/my-sessions', label: 'My sessions', show: 'volunteer' },
  { path: '/my-teachers', label: 'My teachers', show: 'volunteer' },
  { path: '/inbox', label: 'Inbox', show: 'inbox' },
  { path: '/apply', label: 'Profile', show: 'volunteer' },
  // Everyone else.
  { path: '/approvals', label: 'Approvals', roles: ['admin'], show: 'approvers' },
  { path: '/home', label: 'Program board', show: 'team' },
  { path: '/teach', label: 'Teacher desk', show: 'teacher' },
  { path: '/my-volunteers', label: 'My volunteers', show: 'teacher' },
  { path: '/teacher-profile', label: 'Profile', show: 'teacher' },
  // Staff desk: program staff and the program admin (DeepSpace admin). The teacher
  // desk is an app role, so it's linked from the board instead.
  { path: '/staff', label: 'School', roles: ['admin'] },
  { path: '/settings', label: 'Settings', show: 'team' },
  // ── Features add nav items below this line ──
]

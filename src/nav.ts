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
   *   'staff'           program staff other than the program admin
   *   'notProgramAdmin' everyone except the program admin, whose view is just Approvals
   */
  show?: 'approvers' | 'staff' | 'notProgramAdmin'
}

export const nav: NavItem[] = [
  { path: '/approvals', label: 'Approvals', roles: ['admin'], show: 'approvers' },
  { path: '/home', label: 'Board', show: 'notProgramAdmin' },
  { path: '/my-sessions', label: 'My sessions', show: 'notProgramAdmin' },
  { path: '/inbox', label: 'Inbox', show: 'notProgramAdmin' },
  { path: '/apply', label: 'Profile', show: 'notProgramAdmin' },
  // Staff desk: program staff (DeepSpace admin) other than the program admin. The
  // teacher desk is an app role, so it's linked from the board instead.
  { path: '/staff', label: 'Staff', roles: ['admin'], show: 'staff' },
  { path: '/settings', label: 'Settings' },
  // The /api-status debug page still exists — add
  // `{ path: '/api-status', label: 'API Status', devOnly: true }` to surface it.
  // ── Features add nav items below this line ──
]

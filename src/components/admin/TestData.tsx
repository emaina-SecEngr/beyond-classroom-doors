/**
 * Load test data (D16) — for the program admin's manual testing.
 *
 * Adds five San Diego Unified high schools, invites up to five test-teacher emails
 * (one per school), and, once those teachers have signed in, two sample open
 * sessions each. Safe to run again; it only adds what's missing. The server
 * (seedTestData) checks that the caller is the nonprofit admin.
 */
import { useState } from 'react'
import { useUsers } from 'deepspace'
import { Button, Textarea, useToast } from '@/components/ui'
import { Panel } from '../Page'
import { callAction } from '../../lib/actions'
import { useMe } from '../../lib/me'

const SCHOOLS = ['Lincoln High', 'Hoover High', 'Crawford High', 'San Diego High', 'Point Loma High']
const TAGS = ['lincoln', 'hoover', 'crawford', 'sdhigh', 'pointloma']

/** you@gmail.com → you+lincoln@gmail.com … (Gmail delivers these to the same inbox). */
function suggest(email: string, count: number): string {
  const at = email.indexOf('@')
  if (at < 1) return ''
  const local = email.slice(0, at).split('+')[0]
  return TAGS.slice(0, count)
    .map((t) => `${local}+${t}${email.slice(at)}`)
    .join('\n')
}

export function TestData() {
  const toast = useToast()
  const me = useMe()
  const { users } = useUsers()
  const myEmail = users.find((u) => u.id === me.userId)?.email ?? ''
  const [emails, setEmails] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const value = emails ?? suggest(myEmail, 2)

  async function load() {
    setBusy(true)
    const teacherEmails = value
      .split(/[\n,]/)
      .map((e) => e.trim())
      .filter(Boolean)
    const res = await callAction<{ schoolsAdded: number; invited: number; sessionsAdded: number }>('seedTestData', { teacherEmails })
    setBusy(false)
    if (!res.success) {
      toast.error('Could not load test data', res.error)
      return
    }
    const { schoolsAdded, invited, sessionsAdded } = res.data
    toast.success(
      'Test data loaded',
      `${schoolsAdded} school${schoolsAdded === 1 ? '' : 's'} added, ${invited} teacher invite${invited === 1 ? '' : 's'}, ${sessionsAdded} sample session${sessionsAdded === 1 ? '' : 's'}.`,
    )
  }

  return (
    <Panel>
      <h2 className="font-display text-lg font-semibold">Test data</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        For manual testing. Adds five San Diego Unified high schools ({SCHOOLS.join(', ')}) and invites one test teacher per school, in order. After each test teacher has
        signed in, press the button again to give them two sample open sessions marked “[Test data]”. Safe to run more than once.
      </p>
      <label htmlFor="test-teacher-emails" className="mt-4 block text-sm font-medium">
        Test teacher emails (one per line, up to five)
      </label>
      <Textarea id="test-teacher-emails" rows={3} value={value} onChange={(e) => setEmails(e.target.value)} placeholder="you+lincoln@gmail.com" />
      <p className="mt-1 text-xs text-muted-foreground">Use addresses you can sign in with. No real teachers or student data.</p>
      <div className="mt-3">
        <Button onClick={() => void load()} loading={busy}>
          Load test data
        </Button>
      </div>
    </Panel>
  )
}

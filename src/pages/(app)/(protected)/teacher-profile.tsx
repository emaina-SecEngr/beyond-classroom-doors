/**
 * Teacher profile (D17): name, subject, grades taught, phone.
 * The school is shown but not editable here: the program admin assigns it (D9).
 * Name and phone go to the volunteer only when they're booked for one of your sessions.
 */
import { useEffect, useState, type FormEvent } from 'react'
import { Navigate } from 'react-router-dom'
import { useQuery } from 'deepspace'
import { Button, Input, useToast } from '@/components/ui'
import { Fact, Field, Loading, Page, Panel, Section } from '../../../components/Page'
import { CheckList, PickOrOther } from '../../../components/Pickers'
import { callAction } from '../../../lib/actions'
import { useMe } from '../../../lib/me'
import { SUBJECTS } from '../../../lib/options'
import { useSchools } from '../../../lib/schools'
import { GRADES } from '../../../schemas/shared'

interface TeacherProfileRow {
  userId: string
  displayName: string
  subject?: string
  grades?: string[]
  phone?: string
}

const GRADE_OPTIONS = GRADES.map((g) => ({ value: g, label: `Grade ${g}` }))

export default function TeacherProfilePage() {
  const me = useMe()
  const toast = useToast()
  const { byId } = useSchools()
  const mine = useQuery<TeacherProfileRow>('teacher_profiles', { where: { userId: me.userId ?? '__none__' }, limit: 1 })
  const [form, setForm] = useState({ displayName: '', subject: '', phone: '' })
  const [grades, setGrades] = useState<string[]>([])
  const [loaded, setLoaded] = useState(false)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (loaded || !me.ready || mine.status === 'loading') return
    const p = mine.records[0]?.data
    setForm({ displayName: p?.displayName || me.name || '', subject: p?.subject ?? '', phone: p?.phone ?? '' })
    setGrades(Array.isArray(p?.grades) ? p!.grades : [])
    setLoaded(true)
  }, [loaded, me.ready, me.name, mine.status, mine.records])

  if (!me.ready || mine.status === 'loading') return <Loading />
  if (me.appRole !== 'teacher') return <Navigate to="/home" replace />
  const school = me.schoolId ? byId.get(me.schoolId) : undefined

  async function save(e: FormEvent) {
    e.preventDefault()
    setSaving(true)
    const res = await callAction('saveTeacherProfile', { ...form, grades })
    setSaving(false)
    if (res.success) toast.success('Profile saved')
    else toast.error('Could not save', res.error)
  }

  return (
    <Page title="Your teacher profile" intro="Volunteers booked for your sessions see your name and phone so they can reach you. Students never see this.">
      <Section title="School">
        <Panel>
          <dl>
            <Fact label="School">{school ? school.name : 'Not set yet'}</Fact>
            <Fact label="Address">{school ? [school.address, school.city].filter(Boolean).join(', ') || '—' : '—'}</Fact>
            <Fact label="District">{school?.district || '—'}</Fact>
          </dl>
          <p className="mt-3 text-xs text-muted-foreground">The program admin assigns your school. Email them if it’s wrong.</p>
        </Panel>
      </Section>
      <Section title="Profile">
        <Panel>
          <form onSubmit={save} className="space-y-5">
            <Field label="Your name" htmlFor="t-name" hint="As volunteers will see it.">
              <Input id="t-name" value={form.displayName} onChange={(e) => setForm((f) => ({ ...f, displayName: e.target.value }))} maxLength={80} required autoComplete="name" />
            </Field>
            <Field label="Subject you teach" htmlFor="t-subject">
              <PickOrOther id="t-subject" options={SUBJECTS} value={form.subject} onChange={(v) => setForm((f) => ({ ...f, subject: v }))} placeholder="Choose a subject" maxLength={60} otherPlaceholder="Your subject" />
            </Field>
            <Field label="Grades you teach" htmlFor="t-grades">
              <CheckList options={GRADE_OPTIONS} value={grades} onChange={setGrades} />
            </Field>
            <Field label="Phone (optional)" htmlFor="t-phone" hint="Shared only with the volunteer booked for one of your sessions.">
              <Input id="t-phone" type="tel" value={form.phone} onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))} maxLength={20} autoComplete="tel" />
            </Field>
            <Button type="submit" loading={saving} disabled={!form.displayName.trim()}>
              Save profile
            </Button>
          </form>
        </Panel>
      </Section>
    </Page>
  )
}

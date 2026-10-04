/**
 * Volunteer application, profile and status (M1, D22).
 *
 * Open to signed-out visitors (D22): they fill in the application FIRST. Pressing
 * Submit keeps it in this tab (lib/application-draft) and opens the sign-in box to
 * create their account (Google or GitHub). When they come back signed in, the draft is
 * submitted with the normal saveProfile action — the server sees an ordinary,
 * authenticated save. Schools and license files need an account, so they come after.
 *
 * Saving the profile for the first time submits the application. Changing your
 * profession or employer after vetting sends it back for review (M1-AC4) —
 * the form says so before you save.
 */
import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { AuthOverlay } from 'deepspace'
import { Badge, Button, Input, Textarea, useToast } from '@/components/ui'
import { Fact, Field, Loading, Page, Panel, Section } from '../../components/Page'
import { callAction } from '../../lib/actions'
import { formatDay, PROGRAM_EMAIL, VOLUNTEER_STATUS_BADGE, VOLUNTEER_STATUS_LABELS } from '../../lib/labels'
import { useMe } from '../../lib/me'
import { LicenseUploader } from '../../components/LicenseFiles'
import { clearDraft, loadDraft, saveDraft, type ApplicationDraft } from '../../lib/application-draft'
import { signInCopy } from '../../lib/signin'
import { CheckList, PickList, PickOrOther, SchoolPicker } from '../../components/Pickers'
import { ACCESS_NEEDS, LICENSE_TYPES, MAX_PREFERRED_SCHOOLS, PROFESSIONS, US_STATES, YEARS, joinAccessNeeds, splitAccessNeeds } from '../../lib/options'

const NEXT_STEP: Record<string, string> = {
  applied: 'The nonprofit will confirm your identity, check any professional license, and record your school clearance (TB test and background check), then decide.',
  vetted: 'Checks are done. The nonprofit admin makes the final decision.',
  approved: 'You can claim open sessions and accept teachers’ invitations in My sessions.',
  rejected: 'The program admin did not approve this application.',
  declined: 'This application was not approved.',
  renewal_pending: 'Your clearance needs renewing before you can claim new sessions.',
}

export default function ApplyPage() {
  const me = useMe()
  const toast = useToast()
  const [displayName, setDisplayName] = useState('')
  const [profession, setProfession] = useState('')
  const [employer, setEmployer] = useState('')
  // D12: richer profile and license details.
  const [extra, setExtra] = useState({ skills: '', yearsExperience: '', hobbies: '', phone: '', accessNeeds: '', licenseType: '', licenseNumber: '', licenseState: '' })
  const setX = (k: keyof typeof extra, v: string) => setExtra((x) => ({ ...x, [k]: v }))
  // D17: access needs as a checklist plus "anything else"; preferred district and schools.
  const [needs, setNeeds] = useState<{ picked: string[]; other: string }>({ picked: [], other: '' })
  const [prefDistrict, setPrefDistrict] = useState('')
  const [prefSchools, setPrefSchools] = useState<string[]>([])
  const [saving, setSaving] = useState(false)
  const [loaded, setLoaded] = useState(false)
  // D22: signed out → keep the draft and create the account; signed in → submit it.
  const [signIn, setSignIn] = useState(false)
  const autoSubmitted = useRef(false)

  // Fill the form once from the saved profile.
  useEffect(() => {
    if (!me.ready || loaded) return
    if (!me.signedIn) {
      // Signed out: start from a draft kept in this tab, if any.
      const d = loadDraft()
      if (d) fillFromDraft(d)
      setLoaded(true)
      return
    }
    setDisplayName(me.profile?.displayName ?? me.name ?? '')
    setProfession(me.profile?.profession ?? '')
    setEmployer(me.profile?.employer ?? '')
    const p = me.profile
    setExtra({
      skills: p?.skills ?? '',
      yearsExperience: p?.yearsExperience != null ? String(p.yearsExperience) : '',
      hobbies: p?.hobbies ?? '',
      phone: p?.phone ?? '',
      accessNeeds: p?.accessNeeds ?? '',
      licenseType: p?.licenseType ?? '',
      licenseNumber: p?.licenseNumber ?? '',
      licenseState: p?.licenseState ?? '',
    })
    setNeeds(splitAccessNeeds(p?.accessNeeds ?? ''))
    setPrefDistrict(p?.preferredDistrict ?? '')
    setPrefSchools(Array.isArray(p?.preferredSchools) ? p!.preferredSchools : [])
    setLoaded(true)
  }, [me.ready, me.profile, me.name, loaded])

  // D22: just back from creating the account with a draft in hand → submit it once.
  useEffect(() => {
    if (!me.ready || !me.signedIn || autoSubmitted.current) return
    const d = loadDraft()
    if (!d) return
    autoSubmitted.current = true
    // Already a volunteer, a teacher or staff: don't file a second application.
    if (me.volunteer || me.appRole || me.isStaff) {
      clearDraft()
      return
    }
    fillFromDraft(d)
    void submit(payloadFrom(d), true)
  }, [me.ready, me.signedIn, me.volunteer, me.appRole, me.isStaff])

  function fillFromDraft(d: ApplicationDraft) {
    setDisplayName(d.displayName)
    setProfession(d.profession)
    setEmployer(d.employer)
    setExtra({ skills: d.skills, yearsExperience: d.yearsExperience, hobbies: d.hobbies, phone: d.phone, accessNeeds: d.accessNeeds, licenseType: d.licenseType, licenseNumber: d.licenseNumber, licenseState: d.licenseState })
    setNeeds(splitAccessNeeds(d.accessNeeds))
  }

  function currentDraft(): ApplicationDraft {
    return { displayName, profession, employer, ...extra, accessNeeds: joinAccessNeeds(needs.picked, needs.other) }
  }

  function payloadFrom(d: ApplicationDraft, schools: { district: string; ids: string[] } = { district: '', ids: [] }) {
    return {
      ...d,
      yearsExperience: d.yearsExperience === '' ? null : Number(d.yearsExperience),
      preferredDistrict: schools.district,
      preferredSchools: schools.ids,
    }
  }

  async function submit(payload: Record<string, unknown>, fromDraft = false) {
    setSaving(true)
    const res = await callAction<{ status: string; reset?: boolean }>('saveProfile', payload)
    setSaving(false)
    if (!res.success) {
      toast.error(fromDraft ? 'Your account is ready, but the application didn’t go through' : 'Could not save', res.error)
      return
    }
    if (fromDraft) clearDraft()
    if (!status) toast.success('Application submitted', fromDraft ? 'Your account is ready. Add the schools you’d like and any license documents below.' : 'The nonprofit will review it.')
    else if (res.data.reset) toast.info('Profile saved', 'Your application goes back for review because your work details changed.')
    else toast.success('Profile saved')
  }

  if (!me.ready) return <Loading />

  const status = me.volunteer?.status
  const vettedAlready = !!status && status !== 'applied'
  const willReset =
    vettedAlready &&
    !!me.profile &&
    (me.profile.profession !== profession.trim() ||
      me.profile.employer !== employer.trim() ||
      (me.profile.licenseType ?? '') !== extra.licenseType.trim() ||
      (me.profile.licenseNumber ?? '') !== extra.licenseNumber.trim() ||
      (me.profile.licenseState ?? '') !== extra.licenseState.trim().toUpperCase())

  async function save(e: FormEvent) {
    e.preventDefault()
    if (!me.signedIn) {
      // D22: keep the answers in this tab, then create the account.
      if (!saveDraft(currentDraft())) toast.info('Heads up', 'Your browser blocks saving the form, so you may need to fill it in again after signing in.')
      setSignIn(true)
      return
    }
    await submit(payloadFrom(currentDraft(), { district: prefDistrict, ids: prefSchools }))
  }

  return (
    <Page
      title={status ? 'Your volunteer profile' : 'Apply to volunteer with a class'}
      intro={
        me.signedIn
          ? 'Share what you do. Students see your name and profession when you visit; nothing else.'
          : 'Tell us about your work. When you submit, you’ll create your account with Google or GitHub. The program admin then reviews your application.'
      }
    >
      {!me.signedIn && (
        <ol className="mb-8 grid gap-2 text-sm sm:grid-cols-4" aria-label="How applying works">
          {['Fill in this form', 'Create your account', 'Admin reviews it', 'Pick a session'].map((t, i) => (
            <li key={t} className={`flex items-center gap-2 rounded-md border px-3 py-2 ${i === 0 ? 'border-primary bg-card font-medium' : 'border-border text-muted-foreground'}`}>
              <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-xs ${i === 0 ? 'bg-primary text-primary-foreground' : 'bg-muted'}`}>{i + 1}</span>
              {t}
            </li>
          ))}
        </ol>
      )}
      {status && (
        <Section title="Application status">
          <Panel>
            <div className="flex flex-wrap items-center gap-3">
              <Badge variant={VOLUNTEER_STATUS_BADGE[status]}>{VOLUNTEER_STATUS_LABELS[status]}</Badge>
            </div>
            <p className="mt-3 text-sm text-muted-foreground">{NEXT_STEP[status]}</p>
            {me.volunteer?.decisionReason && (status === 'rejected' || status === 'declined') && (
              <p className="mt-2 text-sm">Reason: {me.volunteer.decisionReason}</p>
            )}
            {me.volunteer?.clearanceExpiresAt ? (
              <dl className="mt-4">
                <Fact label="Clearance until">{formatDay(me.volunteer.clearanceExpiresAt)}</Fact>
              </dl>
            ) : null}
            {status === 'approved' && (
              <Link to="/my-sessions" className="mt-4 inline-block text-sm font-medium text-primary underline-offset-4 hover:underline">
                Go to My sessions
              </Link>
            )}
            <p className="mt-4 text-xs text-muted-foreground">
              Questions? Email the program team at{' '}
              <a className="underline" href={`mailto:${PROGRAM_EMAIL}`}>
                {PROGRAM_EMAIL}
              </a>
              .
            </p>
          </Panel>
        </Section>
      )}

      <Section
        title={me.signedIn ? 'Profile' : 'Your application'}
        description={status ? undefined : me.signedIn ? 'Saving this submits your application.' : 'Required: your name and profession. Everything else is optional.'}
      >
        <Panel>
          <form onSubmit={save} className="space-y-5">
            <Field label="Your name" htmlFor="displayName" hint="As students and teachers will see it.">
              <Input id="displayName" value={displayName} onChange={(e) => setDisplayName(e.target.value)} maxLength={80} required autoComplete="name" />
            </Field>
            <Field label="Profession" htmlFor="profession" hint="Pick the closest, or choose Other and type yours.">
              <PickOrOther id="profession" options={PROFESSIONS} value={profession} onChange={setProfession} placeholder="Choose your profession" otherPlaceholder="Your profession" />
            </Field>
            <div className="grid gap-5 sm:grid-cols-2">
              <Field label="Company you work for (optional)" htmlFor="employer">
                <Input id="employer" value={employer} onChange={(e) => setEmployer(e.target.value)} maxLength={120} autoComplete="organization" />
              </Field>
              <Field label="Years of experience (optional)" htmlFor="years">
                <PickList id="years" options={YEARS} value={extra.yearsExperience} onChange={(v) => setX('yearsExperience', v)} placeholder="Choose" noneLabel="Prefer not to say" />
              </Field>
            </div>
            <Field label="Skills (optional)" htmlFor="skills" hint="What you could show or talk about. For example: wound care, wiring a panel, CAD drawings.">
              <Textarea id="skills" rows={2} value={extra.skills} onChange={(e) => setX('skills', e.target.value)} maxLength={300} />
            </Field>
            <Field label="Hobbies (optional)" htmlFor="hobbies" hint="Students love the person behind the job.">
              <Input id="hobbies" value={extra.hobbies} onChange={(e) => setX('hobbies', e.target.value)} maxLength={300} />
            </Field>
            <Field
              label="Phone (optional)"
              htmlFor="phone"
              hint="Shared, with your email, only with the teacher of a session you’re booked for, so they can reach you. Never shown to students."
            >
              <Input id="phone" type="tel" value={extra.phone} onChange={(e) => setX('phone', e.target.value)} maxLength={20} autoComplete="tel" />
            </Field>
            <Field
              label="Anything that would help you on the day? (optional)"
              htmlFor="access"
              hint="Tick anything that helps. No need to say why. Shared only with the teacher and school staff for sessions you book."
            >
              <div className="space-y-3">
                <CheckList options={ACCESS_NEEDS} value={needs.picked} onChange={(picked) => setNeeds((n) => ({ ...n, picked }))} />
                <Input id="access" aria-label="Anything else" value={needs.other} onChange={(e) => setNeeds((n) => ({ ...n, other: e.target.value }))} maxLength={150} placeholder="Anything else (optional)" />
              </div>
            </Field>

            {me.signedIn ? (
            <fieldset className="space-y-3 rounded-md border border-border p-4">
              <legend className="px-1 text-sm font-semibold">Schools you’d like to visit (optional)</legend>
              <p className="text-xs text-muted-foreground">Their sessions show first for you, and the program admin sees your choice when assigning.</p>
              <SchoolPicker
                district={prefDistrict}
                onDistrict={(d) => setPrefDistrict(d)}
                value={prefSchools}
                onChange={setPrefSchools}
                max={MAX_PREFERRED_SCHOOLS}
              />
            </fieldset>
            ) : (
              <p className="rounded-md border border-dashed border-border p-4 text-sm text-muted-foreground">
                After you create your account you can pick the schools you’d like to visit and upload license documents.
              </p>
            )}

            <fieldset className="space-y-4 rounded-md border border-border p-4">
              <legend className="px-1 text-sm font-semibold">Professional license (if your field has one)</legend>
              <div className="grid gap-4 sm:grid-cols-[1fr_1fr_7rem]">
                <Field label="License type" htmlFor="lic-type">
                  <PickOrOther id="lic-type" options={LICENSE_TYPES} value={extra.licenseType} onChange={(v) => setX('licenseType', v)} noneLabel="No license" placeholder="No license" otherPlaceholder="License type" />
                </Field>
                <Field label="License number" htmlFor="lic-num">
                  <Input id="lic-num" value={extra.licenseNumber} onChange={(e) => setX('licenseNumber', e.target.value)} maxLength={40} />
                </Field>
                <Field label="State" htmlFor="lic-state">
                  <PickList id="lic-state" options={US_STATES} value={extra.licenseState} onChange={(v) => setX('licenseState', v)} placeholder="CA" />
                </Field>
              </div>
              <p className="text-xs text-muted-foreground">The program admin checks this on the state’s public license lookup.</p>
            </fieldset>

            {willReset && (
              <p role="note" className="rounded-md border border-warning/50 bg-warning/10 p-3 text-sm">
                Changing your profession, employer or license details sends your application back for review.
              </p>
            )}

            <Button type="submit" loading={saving} disabled={!displayName.trim() || !profession.trim()}>
              {status ? 'Save profile' : me.signedIn ? 'Submit application' : 'Create account and submit'}
            </Button>
          </form>
        </Panel>
      </Section>

      {signIn && !me.signedIn && (
        <AuthOverlay
          onClose={() => setSignIn(false)}
          title={signInCopy('volunteer').title}
          description="Your answers are saved on this device. Continue with Google or GitHub to create your account, and we’ll submit your application."
        />
      )}

      {me.userId && (
        <Section title="License documents">
          <Panel>
            <LicenseUploader volunteerId={me.userId} />
          </Panel>
        </Section>
      )}
    </Page>
  )
}

/**
 * Thank-you perks for a booked volunteer (D20): a meal (Uber Eats or Grubhub), a ride
 * to a restaurant, and for volunteers travelling in, a ride to the airport.
 *
 * The program pays through vouchers it creates with the vendor. The app only stores
 * the voucher links on the session's private row and shows them to the booked
 * volunteer; it never handles money. `setSessionPerks` re-checks who may add a link
 * and that each one is on the vendor's own site.
 */
import { useEffect, useState } from 'react'
import { Button, buttonVariants, Input, Modal, useToast } from '@/components/ui'
import { Field } from './Page'
import { callAction } from '../lib/actions'
import { AIRPORT_RIDE_CAP_USD, MEAL_CAP_USD, PERKS, type Perk } from '../schemas/shared'

export type PerkLinks = Partial<Record<Perk, string>>

/** Only https links are ever rendered, whatever the row holds. */
const safe = (links: PerkLinks | null | undefined, p: Perk): string => {
  const v = links?.[p]
  return typeof v === 'string' && v.startsWith('https://') ? v : ''
}

export const hasPerks = (links: PerkLinks | null | undefined): boolean => PERKS.some((p) => safe(links, p))

function PerkLink({ href, children }: { href: string; children: string }) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className={buttonVariants({ variant: 'outline', size: 'sm' })}>
      {children}
    </a>
  )
}

/** The booked volunteer's view (My sessions). Shown once they've confirmed they're coming. */
export function PerksView({ perks, confirmed }: { perks: PerkLinks | null | undefined; confirmed: boolean }) {
  if (!hasPerks(perks)) return null
  const eats = safe(perks, 'mealUberEats')
  const grubhub = safe(perks, 'mealGrubhub')
  const dining = safe(perks, 'rideDining')
  const airport = safe(perks, 'rideAirport')
  return (
    <div className="mt-5 rounded-md border border-border p-4">
      <h4 className="text-sm font-semibold">A thank-you from the program</h4>
      {!confirmed ? (
        <p className="mt-1 text-sm text-muted-foreground">Confirm you’re coming to see your meal and ride options.</p>
      ) : (
        <>
        <dl className="mt-3 space-y-3 text-sm">
          {(eats || grubhub) && (
            <div>
              <dt className="font-medium">Lunch or dinner, up to ${MEAL_CAP_USD}</dt>
              <dd className="mt-1.5 flex flex-wrap items-center gap-2">
                {eats && <PerkLink href={eats}>Order with Uber Eats</PerkLink>}
                {grubhub && <PerkLink href={grubhub}>Order with Grubhub</PerkLink>}
                {eats && grubhub && <span className="text-muted-foreground">Pick one.</span>}
              </dd>
            </div>
          )}
          {dining && (
            <div>
              <dt className="font-medium">Ride to a restaurant, if you’d rather dine in</dt>
              <dd className="mt-1.5">
                <PerkLink href={dining}>Get your Uber ride</PerkLink>
              </dd>
            </div>
          )}
          {airport && (
            <div>
              <dt className="font-medium">Ride to the airport, up to ${AIRPORT_RIDE_CAP_USD}</dt>
              <dd className="mt-1.5">
                <PerkLink href={airport}>Get your Uber ride</PerkLink>
              </dd>
            </div>
          )}
        </dl>
        <p className="mt-3 text-xs text-muted-foreground">Each link opens Uber or Grubhub and is paid by the program up to its limit.</p>
        </>
      )}
    </div>
  )
}

const EMPTY: Record<Perk, string> = { mealUberEats: '', mealGrubhub: '', rideDining: '', rideAirport: '' }

const FIELDS: { key: Perk; label: string; hint: string; placeholder: string }[] = [
  { key: 'mealUberEats', label: 'Meal · Uber Eats voucher link', hint: `Set the voucher limit to $${MEAL_CAP_USD} when you create it.`, placeholder: 'https://r.uber.com/…' },
  { key: 'mealGrubhub', label: 'Meal · Grubhub credit link', hint: `Set the credit to $${MEAL_CAP_USD}. The volunteer picks Uber Eats or Grubhub.`, placeholder: 'https://www.grubhub.com/…' },
  { key: 'rideDining', label: 'Ride to a restaurant · Uber voucher link', hint: 'For volunteers who would rather dine in.', placeholder: 'https://r.uber.com/…' },
  { key: 'rideAirport', label: 'Ride to the airport · Uber voucher link', hint: `Only for volunteers travelling in. Set the voucher limit to $${AIRPORT_RIDE_CAP_USD}.`, placeholder: 'https://r.uber.com/…' },
]

/** The program admin's / school staff's side (School view): paste the voucher links for a booked session. */
export function PerksButton({ sessionId, label, volunteerName, perks }: { sessionId: string; label: string; volunteerName?: string; perks: PerkLinks | null | undefined }) {
  const toast = useToast()
  const [open, setOpen] = useState(false)
  const [form, setForm] = useState(EMPTY)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (open) setForm({ ...EMPTY, ...(perks ?? {}) })
  }, [open, perks])

  async function save() {
    setBusy(true)
    const res = await callAction<{ perks: string[]; changed: boolean }>('setSessionPerks', { sessionId, ...form })
    setBusy(false)
    if (!res.success) {
      toast.error('Could not save', res.error)
      return
    }
    toast.success(res.data.changed ? 'Perks saved' : 'Nothing changed', res.data.changed && res.data.perks.length ? 'The volunteer has been told.' : undefined)
    setOpen(false)
  }

  return (
    <>
      <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
        {hasPerks(perks) ? 'Edit perks' : 'Add perks'}
      </Button>
      <Modal open={open} onClose={() => !busy && setOpen(false)} size="lg">
        <Modal.Header>
          <Modal.Title>Thank-you perks</Modal.Title>
          <Modal.Description>
            {label}
            {volunteerName ? ` · ${volunteerName}` : ''}. Create each voucher in Uber for Business or Grubhub, then paste its link. Only the booked volunteer sees them, after confirming.
          </Modal.Description>
        </Modal.Header>
        <Modal.Body>
          <div className="space-y-4">
            {FIELDS.map((f) => (
              <Field key={f.key} label={f.label} htmlFor={`perk-${f.key}-${sessionId}`} hint={f.hint}>
                <Input
                  id={`perk-${f.key}-${sessionId}`}
                  type="url"
                  inputMode="url"
                  value={form[f.key]}
                  onChange={(e) => setForm((v) => ({ ...v, [f.key]: e.target.value }))}
                  maxLength={300}
                  placeholder={f.placeholder}
                />
              </Field>
            ))}
            <p className="text-xs text-muted-foreground">
              The spending limit lives on the voucher, not here. Leave a field empty to offer nothing, or clear it to take a perk back. Links are removed if the volunteer withdraws or the session is cancelled.
            </p>
          </div>
        </Modal.Body>
        <Modal.Footer>
          <Button variant="ghost" onClick={() => setOpen(false)} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={() => void save()} loading={busy}>
            Save perks
          </Button>
        </Modal.Footer>
      </Modal>
    </>
  )
}

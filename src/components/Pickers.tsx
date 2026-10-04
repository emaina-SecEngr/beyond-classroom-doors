/**
 * Dropdown controls for profile and admin forms (D17).
 *
 *   <PickList>     a plain dropdown (state, years, district…)
 *   <PickOrOther>  a dropdown with "Other…" that reveals a short text box
 *   <CheckList>    tick any number of options
 *   <SchoolPicker> district → schools in it, from the program's school list
 *
 * They hold no data of their own: values are plain strings, so saved profiles from
 * before D17 (free text) still show — as "Other" with their text.
 */
import { useState } from 'react'
import { Checkbox, Input, Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui'
import { OTHER } from '../lib/options'
import { useSchools } from '../lib/schools'

type Opt = string | { value: string; label: string }
const val = (o: Opt) => (typeof o === 'string' ? o : o.value)
const lab = (o: Opt) => (typeof o === 'string' ? o : o.label)
const NONE = '__none__'

export function PickList({
  id,
  options,
  value,
  onChange,
  placeholder = 'Choose…',
  noneLabel,
  className,
}: {
  id: string
  options: readonly Opt[]
  value: string
  onChange: (v: string) => void
  placeholder?: string
  /** Adds a first choice that clears the value (e.g. "No license"). */
  noneLabel?: string
  className?: string
}) {
  return (
    <Select value={value === '' && noneLabel ? NONE : value} onValueChange={(v) => onChange(!v || v === NONE ? '' : String(v))}>
      <SelectTrigger id={id} className={className}>
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        {noneLabel ? <SelectItem value={NONE}>{noneLabel}</SelectItem> : null}
        {options.map((o) => (
          <SelectItem key={val(o)} value={val(o)}>
            {lab(o)}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

export function PickOrOther({
  id,
  options,
  value,
  onChange,
  placeholder,
  noneLabel,
  otherLabel = 'Other…',
  otherPlaceholder = 'Type it here',
  maxLength = 80,
}: {
  id: string
  options: readonly string[]
  value: string
  onChange: (v: string) => void
  placeholder?: string
  noneLabel?: string
  otherLabel?: string
  otherPlaceholder?: string
  maxLength?: number
}) {
  const [otherMode, setOtherMode] = useState(false)
  const isOther = otherMode || (value !== '' && !options.includes(value))
  return (
    <div className="space-y-2">
      <PickList
        id={id}
        options={[...options, { value: OTHER, label: otherLabel }]}
        value={isOther ? OTHER : value}
        placeholder={placeholder}
        noneLabel={noneLabel}
        onChange={(v) => {
          if (v === OTHER) {
            setOtherMode(true)
            if (options.includes(value)) onChange('')
          } else {
            setOtherMode(false)
            onChange(v)
          }
        }}
      />
      {isOther && <Input id={`${id}-other`} aria-label={`${otherLabel} ${id}`} value={value} onChange={(e) => onChange(e.target.value)} maxLength={maxLength} placeholder={otherPlaceholder} autoFocus={otherMode} />}
    </div>
  )
}

export function CheckList({ options, value, onChange, columns = 2 }: { options: readonly Opt[]; value: string[]; onChange: (v: string[]) => void; columns?: 1 | 2 }) {
  return (
    <div className={columns === 2 ? 'grid gap-2 sm:grid-cols-2' : 'grid gap-2'}>
      {options.map((o) => (
        <label key={val(o)} className="flex items-center gap-3 text-sm">
          <Checkbox checked={value.includes(val(o))} onCheckedChange={(c) => onChange(c ? [...new Set([...value, val(o)])] : value.filter((x) => x !== val(o)))} />
          <span>{lab(o)}</span>
        </label>
      ))}
    </div>
  )
}

/** District dropdown, then tick up to `max` active schools in it. */
export function SchoolPicker({
  district,
  onDistrict,
  value,
  onChange,
  max,
}: {
  district: string
  onDistrict: (d: string) => void
  value: string[]
  onChange: (ids: string[]) => void
  max: number
}) {
  const { schools, status } = useSchools()
  const active = schools.filter((s) => s.active)
  const districts = [...new Set(active.map((s) => s.district || 'Other schools'))].sort()
  const shown = active.filter((s) => !district || (s.district || 'Other schools') === district).sort((a, b) => a.name.localeCompare(b.name))
  if (status === 'loading') return <p className="text-sm text-muted-foreground">Loading schools…</p>
  if (active.length === 0) return <p className="text-sm text-muted-foreground">No schools have been added yet.</p>
  return (
    <div className="space-y-3">
      <PickList id="pref-district" options={districts} value={district} onChange={onDistrict} noneLabel="Any district" />
      <div className="grid gap-2 sm:grid-cols-2">
        {shown.map((s) => {
          const on = value.includes(s.id)
          return (
            <label key={s.id} className="flex items-start gap-3 text-sm">
              <Checkbox
                checked={on}
                disabled={!on && value.length >= max}
                onCheckedChange={(c) => onChange(c ? [...new Set([...value, s.id])] : value.filter((x) => x !== s.id))}
              />
              <span>
                {s.name}
                {s.address ? <span className="block text-xs text-muted-foreground">{s.address}</span> : null}
              </span>
            </label>
          )
        })}
      </div>
      <p className="text-xs text-muted-foreground">
        {value.length} of {max} chosen.
      </p>
    </div>
  )
}

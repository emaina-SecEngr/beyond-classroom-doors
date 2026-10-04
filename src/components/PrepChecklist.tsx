/**
 * The teacher's prep checklist for a volunteer's visit (D18).
 *
 *   <PrepChecklistEditor>  teacher / staff: add suggested or own items, tick them off
 *   <PrepChecklistView>    booked volunteer: read-only progress
 *
 * Every change saves through updatePrepChecklist, which re-checks who may edit.
 */
import { useState } from 'react'
import { Badge, Button, Checkbox, Input, useToast } from '@/components/ui'
import { callAction } from '../lib/actions'
import { PREP_ITEMS } from '../lib/options'
import { PickList } from './Pickers'

export interface PrepItem {
  label: string
  done: boolean
}

export const prepItems = (raw: unknown): PrepItem[] =>
  Array.isArray(raw) ? raw.filter((i): i is PrepItem => !!i && typeof (i as PrepItem).label === 'string').map((i) => ({ label: i.label, done: !!i.done })) : []

export function PrepProgress({ items }: { items: PrepItem[] }) {
  if (items.length === 0) return null
  const done = items.filter((i) => i.done).length
  return (
    <Badge variant={done === items.length ? 'success' : 'warning'} size="sm">
      Prep {done}/{items.length}
    </Badge>
  )
}

export function PrepChecklistEditor({ sessionId, items, idPrefix = 'prep' }: { sessionId: string; items: PrepItem[]; idPrefix?: string }) {
  const toast = useToast()
  const [busy, setBusy] = useState(false)
  const [custom, setCustom] = useState('')
  const has = new Set(items.map((i) => i.label.toLowerCase()))
  const suggestions = PREP_ITEMS.filter((p) => !has.has(p.toLowerCase()))

  async function save(next: PrepItem[]) {
    setBusy(true)
    const res = await callAction('updatePrepChecklist', { sessionId, items: next })
    setBusy(false)
    if (!res.success) toast.error('Could not save the checklist', res.error)
    return res.success
  }

  async function addCustom() {
    const label = custom.trim()
    if (!label) return
    if (await save([...items, { label, done: false }])) setCustom('')
  }

  return (
    <div className="space-y-3">
      {items.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nothing on the list yet. Add what this volunteer will need on the day.</p>
      ) : (
        <ul className="space-y-2">
          {items.map((it, i) => (
            <li key={it.label} className="flex items-center gap-3 text-sm">
              <Checkbox
                aria-label={it.label}
                checked={it.done}
                disabled={busy}
                onCheckedChange={(c) => void save(items.map((x, j) => (j === i ? { ...x, done: c } : x)))}
              />
              <span className={it.done ? 'text-muted-foreground line-through' : ''}>{it.label}</span>
              <button
                type="button"
                className="ml-auto text-xs text-muted-foreground underline-offset-4 hover:underline"
                disabled={busy}
                onClick={() => void save(items.filter((_, j) => j !== i))}
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="grid gap-2 sm:grid-cols-2">
        {suggestions.length > 0 && (
          <PickList
            id={`${idPrefix}-suggest-${sessionId}`}
            options={suggestions}
            value=""
            placeholder="Add a suggested item…"
            onChange={(v) => v && void save([...items, { label: v, done: false }])}
          />
        )}
        <div className="flex gap-2">
          <Input
            aria-label="Add your own item"
            value={custom}
            maxLength={80}
            placeholder="Add your own item"
            onChange={(e) => setCustom(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                void addCustom()
              }
            }}
          />
          <Button variant="outline" onClick={() => void addCustom()} disabled={busy || !custom.trim()}>
            Add
          </Button>
        </div>
      </div>
    </div>
  )
}

export function PrepChecklistView({ items }: { items: PrepItem[] }) {
  if (items.length === 0) return null
  return (
    <div>
      <p className="text-sm font-medium">
        What the school is preparing <PrepProgress items={items} />
      </p>
      <ul className="mt-1 space-y-1 text-sm">
        {items.map((it) => (
          <li key={it.label} className="flex items-center gap-2">
            <span aria-hidden className={it.done ? 'text-success' : 'text-muted-foreground'}>
              {it.done ? '✓' : '○'}
            </span>
            <span className={it.done ? '' : 'text-muted-foreground'}>{it.label}</span>
            <span className="sr-only">{it.done ? '(done)' : '(not yet)'}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

/**
 * Shared page frame and small building blocks used across the app's pages.
 * No backgrounds on page wrappers: pages inherit the (app) layout's surface.
 */
import type { ReactNode } from 'react'
import { cn } from '@/components/ui'

export function Page({ title, intro, actions, children, wide }: { title: string; intro?: ReactNode; actions?: ReactNode; children: ReactNode; wide?: boolean }) {
  return (
    <div className="min-h-full text-foreground">
      <div className={cn('mx-auto px-4 py-10 sm:px-6 sm:py-14', wide ? 'max-w-5xl' : 'max-w-3xl')}>
        <header className="mb-8 flex flex-wrap items-end justify-between gap-4">
          <div className="min-w-0">
            <h1 className="text-3xl font-semibold tracking-tight">{title}</h1>
            {intro && <p className="mt-2 max-w-prose text-sm text-muted-foreground">{intro}</p>}
          </div>
          {actions && <div className="flex shrink-0 flex-wrap gap-2">{actions}</div>}
        </header>
        {children}
      </div>
    </div>
  )
}

export function Section({ title, description, children, className }: { title: string; description?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={cn('mb-10', className)}>
      <h2 className="text-lg font-semibold">{title}</h2>
      {description && <p className="mt-1 text-sm text-muted-foreground">{description}</p>}
      <div className="mt-4">{children}</div>
    </section>
  )
}

export function Panel({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn('rounded-md border border-border bg-card p-5', className)}>{children}</div>
}

export function Loading({ label = 'Loading…' }: { label?: string }) {
  return (
    <div role="status" aria-live="polite" className="py-10 text-center text-sm text-muted-foreground">
      {label}
    </div>
  )
}

export function ErrorNote({ message }: { message: string }) {
  return (
    <div role="alert" className="rounded-md border border-destructive/40 bg-destructive/5 p-4 text-sm text-destructive">
      {message}
    </div>
  )
}

export function Field({ label, htmlFor, hint, children }: { label: string; htmlFor: string; hint?: string; children: ReactNode }) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={htmlFor} className="text-sm font-medium">
        {label}
      </label>
      {children}
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  )
}

/** A definition row: "Room · 214". */
export function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex gap-2 text-sm">
      <dt className="w-28 shrink-0 text-muted-foreground">{label}</dt>
      <dd className="min-w-0 break-words">{children}</dd>
    </div>
  )
}

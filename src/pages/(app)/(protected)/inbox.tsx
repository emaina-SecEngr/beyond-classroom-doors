/**
 * In-app notifications (M8, decision I1 — replaces email).
 *
 * Each person reads only their own notifications. The one thing anyone can
 * change is `readAt` on their own (schema writableFields), so "Mark read" is a
 * direct, confirmed write; the toast appears only after the server accepts it.
 * Calendar links are plain Google Calendar URLs — no calendar access (I3).
 */
import { useState } from 'react'
import { useMutations, useQuery } from 'deepspace'
import { Badge, Button, EmptyState, useToast } from '@/components/ui'
import { ErrorNote, Loading, Page } from '../../../components/Page'
import { formatInstant } from '../../../lib/labels'
import { useMe } from '../../../lib/me'

interface NotificationRow {
  recipientId: string
  kind: string
  title: string
  body: string
  link: string
  readAt: number | null
}

const isSafeLink = (url: string) => url.startsWith('https://calendar.google.com/')

export default function InboxPage() {
  const me = useMe()
  const toast = useToast()
  const { records, status, error } = useQuery<NotificationRow>('notifications', { where: { recipientId: me.userId ?? '__none__' }, limit: 200 })
  const { putConfirmed, ready } = useMutations<NotificationRow>('notifications')
  const [busy, setBusy] = useState<string | null>(null)

  if (!me.ready || status === 'loading') return <Loading />

  const rows = [...records].sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  const unread = rows.filter((r) => !r.data.readAt)

  async function markRead(ids: string[]) {
    setBusy(ids.length > 1 ? 'all' : ids[0])
    try {
      const now = Math.floor(Date.now() / 1000)
      for (const id of ids) await putConfirmed(id, { readAt: now })
    } catch (e) {
      toast.error('Could not update', e instanceof Error ? e.message : 'Please try again.')
    } finally {
      setBusy(null)
    }
  }

  return (
    <Page
      title="Inbox"
      intro="Bookings, confirmations and changes to your sessions."
      actions={
        unread.length > 1 ? (
          <Button size="sm" variant="outline" disabled={!ready} loading={busy === 'all'} onClick={() => void markRead(unread.map((r) => r.recordId))}>
            Mark all read
          </Button>
        ) : undefined
      }
    >
      {status === 'error' && <ErrorNote message={error || 'Could not load your inbox.'} />}
      {status === 'ready' && rows.length === 0 && <EmptyState title="Nothing here yet" description="When something happens to your sessions or application, it shows up here." />}
      {rows.length > 0 && (
        <ul className="divide-y divide-border rounded-md border border-border bg-card">
          {rows.map((r) => {
            const isUnread = !r.data.readAt
            return (
              <li key={r.recordId} className="flex flex-wrap items-start gap-x-4 gap-y-2 px-4 py-4">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    {isUnread && <Badge variant="info" size="sm">New</Badge>}
                    <p className={isUnread ? 'font-semibold' : 'font-medium text-muted-foreground'}>{r.data.title}</p>
                  </div>
                  {r.data.body && <p className="mt-1 text-sm">{r.data.body}</p>}
                  <p className="mt-1 text-xs text-muted-foreground">{formatInstant(r.createdAt)}</p>
                  {r.data.link && isSafeLink(r.data.link) && (
                    <a href={r.data.link} target="_blank" rel="noopener noreferrer" className="mt-2 inline-block text-sm font-medium text-primary underline-offset-4 hover:underline">
                      Add to Google Calendar
                    </a>
                  )}
                </div>
                {isUnread && (
                  <Button size="sm" variant="ghost" disabled={!ready} loading={busy === r.recordId} onClick={() => void markRead([r.recordId])}>
                    Mark read
                  </Button>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </Page>
  )
}

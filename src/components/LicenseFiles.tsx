/**
 * License documents (D12).
 *
 *   <LicenseUploader />   on the volunteer's profile: upload to their private file
 *                         space, register it, open or remove it
 *   <LicenseFileList />   for approvers: open a volunteer's files
 *
 * Opening always goes through the openLicenseFile action, which checks who's asking
 * and fetches the file from the volunteer's own private space. Files open in an
 * in-app viewer from a temporary blob URL — no public links.
 */
import { useEffect, useRef, useState } from 'react'
import { useQuery, useR2Files } from 'deepspace'
import { Badge, Button, Modal, useToast } from '@/components/ui'
import { callAction } from '../lib/actions'
import { formatInstant } from '../lib/labels'

const MAX_BYTES = 5 * 1024 * 1024
const MIMES = ['application/pdf', 'image/jpeg', 'image/png']

interface LicenseFileRow {
  volunteerId: string
  path: string
  name: string
  mime: string
  size: number
  removed?: boolean | number
}

function useLicenseFiles(volunteerId: string | null) {
  const { records, status } = useQuery<LicenseFileRow>('license_files', { where: { volunteerId: volunteerId ?? '__none__' }, limit: 20 })
  return { files: records.filter((r) => !r.data.removed).sort((a, b) => b.createdAt.localeCompare(a.createdAt)), status }
}

const sizeText = (n: number) => (n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`)

/** Fetch a license file through the server and show it in a modal. */
function useLicenseViewer() {
  const toast = useToast()
  const [view, setView] = useState<{ name: string; mime: string; url: string } | null>(null)
  const [loadingId, setLoadingId] = useState<string | null>(null)

  useEffect(() => () => (view ? URL.revokeObjectURL(view.url) : undefined), [view])

  async function open(fileId: string) {
    setLoadingId(fileId)
    const res = await callAction<{ name: string; mime: string; base64: string }>('openLicenseFile', { fileId })
    setLoadingId(null)
    if (!res.success) {
      toast.error('Could not open the file', res.error)
      return
    }
    const bin = atob(res.data.base64)
    const bytes = new Uint8Array(bin.length)
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
    const url = URL.createObjectURL(new Blob([bytes], { type: res.data.mime }))
    setView({ name: res.data.name, mime: res.data.mime, url })
  }

  const viewer = (
    <Modal open={!!view} onClose={() => setView(null)} size="xl">
      <Modal.Header>
        <Modal.Title>{view?.name}</Modal.Title>
        <Modal.Description>Opened through the program. Please don’t forward or store copies.</Modal.Description>
      </Modal.Header>
      <Modal.Body>
        {view && view.mime.startsWith('image/') ? (
          <img src={view.url} alt={view.name} className="mx-auto max-h-[65vh] w-auto rounded-sm border border-border" />
        ) : view ? (
          <iframe title={view.name} src={view.url} className="h-[65vh] w-full rounded-sm border border-border" />
        ) : null}
      </Modal.Body>
      <Modal.Footer>
        {view && (
          <a href={view.url} download={view.name} className="inline-flex h-10 items-center rounded-md border border-input px-4 text-sm font-medium hover:bg-accent">
            Download
          </a>
        )}
        <Button onClick={() => setView(null)}>Close</Button>
      </Modal.Footer>
    </Modal>
  )
  return { open, loadingId, viewer }
}

/** For approvers: a volunteer's license documents. */
export function LicenseFileList({ volunteerId }: { volunteerId: string }) {
  const { files, status } = useLicenseFiles(volunteerId)
  const { open, loadingId, viewer } = useLicenseViewer()
  if (status === 'loading') return null
  return (
    <>
      {files.length === 0 ? (
        <p className="text-sm text-muted-foreground">No license documents uploaded.</p>
      ) : (
        <ul className="space-y-1">
          {files.map((f) => (
            <li key={f.recordId} className="flex flex-wrap items-center gap-2 text-sm">
              <span className="min-w-0 truncate">{f.data.name}</span>
              <span className="text-xs text-muted-foreground">
                {sizeText(f.data.size)} · {formatInstant(f.createdAt)}
              </span>
              <Button size="sm" variant="outline" onClick={() => void open(f.recordId)} loading={loadingId === f.recordId}>
                Open
              </Button>
            </li>
          ))}
        </ul>
      )}
      {viewer}
    </>
  )
}

/** For the volunteer: upload, open and remove their own license documents. */
export function LicenseUploader({ volunteerId }: { volunteerId: string }) {
  const toast = useToast()
  const { upload } = useR2Files({ scope: 'self' })
  const { files } = useLicenseFiles(volunteerId)
  const { open, loadingId, viewer } = useLicenseViewer()
  const input = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)

  async function onPick(file: File | undefined) {
    if (!file) return
    if (!MIMES.includes(file.type)) {
      toast.error('Use a PDF, JPG or PNG', `${file.name} is a different kind of file.`)
      return
    }
    if (file.size > MAX_BYTES) {
      toast.error('File too large', 'Keep it under 5 MB. A phone photo or a scan works.')
      return
    }
    setBusy(true)
    try {
      const up = await upload(file, file.name)
      if (!up.success || !up.url) throw new Error(up.error || 'Upload failed')
      const u = new URL(up.url, window.location.origin)
      const res = await callAction('addLicenseFile', { path: u.pathname + u.search, name: file.name, mime: file.type, size: file.size })
      if (!res.success) throw new Error(res.error)
      toast.success('License uploaded', 'Only you and the program admin can open it.')
    } catch (e) {
      toast.error('Could not upload', e instanceof Error ? e.message : 'Please try again.')
    } finally {
      setBusy(false)
      if (input.current) input.current.value = ''
    }
  }

  async function remove(fileId: string, name: string) {
    const res = await callAction('removeLicenseFile', { fileId })
    if (res.success) toast.success(`${name} removed`)
    else toast.error('Could not remove', res.error)
  }

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">
        Optional. Upload a photo or PDF of your professional license (PDF, JPG or PNG, up to 5 MB). Only you and the program admin can open it.
      </p>
      {files.length > 0 && (
        <ul className="space-y-1">
          {files.map((f) => (
            <li key={f.recordId} className="flex flex-wrap items-center gap-2 text-sm">
              <Badge variant="secondary" size="sm">
                Uploaded
              </Badge>
              <span className="min-w-0 truncate">{f.data.name}</span>
              <span className="text-xs text-muted-foreground">{sizeText(f.data.size)}</span>
              <Button size="sm" variant="ghost" onClick={() => void open(f.recordId)} loading={loadingId === f.recordId}>
                Open
              </Button>
              <Button size="sm" variant="ghost" onClick={() => void remove(f.recordId, f.data.name)}>
                Remove
              </Button>
            </li>
          ))}
        </ul>
      )}
      <input ref={input} type="file" accept="application/pdf,image/jpeg,image/png" className="sr-only" id="license-upload" onChange={(e) => void onPick(e.target.files?.[0])} />
      <Button type="button" variant="outline" loading={busy} onClick={() => input.current?.click()} disabled={files.length >= 5}>
        Upload a license
      </Button>
      {viewer}
    </div>
  )
}

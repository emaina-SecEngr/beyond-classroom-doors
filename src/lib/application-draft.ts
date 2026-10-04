/**
 * A volunteer's application, kept in THIS browser tab while they create their account
 * (D22). Filled in signed out → saved here → after Google/GitHub sign-in the apply page
 * submits it with the normal saveProfile action, as the signed-in user.
 *
 * sessionStorage: survives the sign-in redirect in the same tab, gone when the tab
 * closes, never sent to the server until submit. If storage is blocked, the draft is
 * simply lost and the person fills the form in again — nothing breaks.
 */
const KEY = 'bcd.applicationDraft.v1'
const MAX_AGE_MS = 2 * 60 * 60 * 1000 // a stale draft (2 h+) is dropped

export interface ApplicationDraft {
  displayName: string
  profession: string
  employer: string
  skills: string
  yearsExperience: string
  hobbies: string
  phone: string
  accessNeeds: string
  licenseType: string
  licenseNumber: string
  licenseState: string
}

export function saveDraft(d: ApplicationDraft): boolean {
  try {
    sessionStorage.setItem(KEY, JSON.stringify({ at: Date.now(), d }))
    return true
  } catch {
    return false
  }
}

export function loadDraft(): ApplicationDraft | null {
  try {
    const raw = sessionStorage.getItem(KEY)
    if (!raw) return null
    const { at, d } = JSON.parse(raw) as { at: number; d: ApplicationDraft }
    if (typeof at !== 'number' || Date.now() - at > MAX_AGE_MS || !d || typeof d.displayName !== 'string') {
      clearDraft()
      return null
    }
    return d
  } catch {
    return null
  }
}

export function clearDraft(): void {
  try {
    sessionStorage.removeItem(KEY)
  } catch {
    /* storage blocked: nothing to clear */
  }
}

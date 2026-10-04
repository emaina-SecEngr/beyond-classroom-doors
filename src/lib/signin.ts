/**
 * Words for the DeepSpace sign-in box (D22). The box offers Google or GitHub; the first
 * time someone continues, their account is created — there's no separate sign-up form.
 * The SDK's defaults ("Sign in to DeepSpace", "Sync your data across devices") don't
 * say that, so every place that opens it passes these instead.
 */
import { APP_NAME } from '../constants'

export type SignInFor = 'volunteer' | 'teacher' | 'staff' | 'admin' | null

const NEW_HERE = 'New here? Continuing with Google or GitHub creates your account.'

export function signInCopy(forWho: SignInFor = null): { title: string; description: string } {
  switch (forWho) {
    case 'volunteer':
      return { title: 'Create your volunteer account', description: 'Continue with Google or GitHub. Your account is created the first time; then you fill in a short application.' }
    case 'teacher':
      return { title: 'Teacher sign in', description: 'Use the school email the program invited. First time? Continuing creates your account.' }
    case 'staff':
      return { title: 'Program staff sign in', description: NEW_HERE }
    case 'admin':
      return { title: 'Program admin sign in', description: 'Sign in with the nonprofit’s admin account.' }
    default:
      return { title: `Sign in to ${APP_NAME}`, description: NEW_HERE }
  }
}

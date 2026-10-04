/** "Directions" link to a school in Google Maps (D20). Opens in a new tab. */
import { directionsUrl, type School } from '../lib/schools'

export function Directions({ school, label = 'Directions', className }: { school: Pick<School, 'name' | 'address' | 'city'> | undefined | null; label?: string; className?: string }) {
  const href = directionsUrl(school)
  if (!href) return null
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={`${label} to ${school!.name} in Google Maps (opens in a new tab)`}
      className={className ?? 'whitespace-nowrap font-medium text-primary underline-offset-4 hover:underline'}
    >
      {label}
    </a>
  )
}

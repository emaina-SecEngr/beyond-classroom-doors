import { describe, expect, it } from 'vitest'
import { directionsUrl, fullAddress } from './schools'

describe('D20 · school directions', () => {
  const lincoln = { name: 'Lincoln High', address: '4777 Imperial Ave., San Diego, CA 92113', city: 'San Diego' }
  it('links to Google Maps directions with only the public name and address', () => {
    const url = directionsUrl(lincoln)
    expect(url.startsWith('https://www.google.com/maps/dir/?api=1&destination=')).toBe(true)
    expect(decodeURIComponent(url.split('destination=')[1])).toBe('Lincoln High, 4777 Imperial Ave., San Diego, CA 92113')
  })
  it('encodes special characters and adds the city only when missing', () => {
    expect(fullAddress({ address: '1 Main St', city: 'Chula Vista' })).toBe('1 Main St, Chula Vista')
    const dest = directionsUrl({ name: 'A & B High', address: '1 Main St #2', city: '' }).split('destination=')[1]
    expect(dest).not.toMatch(/[ &#]/) // encoded, so it can't break out of the parameter
    expect(decodeURIComponent(dest)).toBe('A & B High, 1 Main St #2')
  })
  it('is empty without a school', () => {
    expect(directionsUrl(null)).toBe('')
  })
})

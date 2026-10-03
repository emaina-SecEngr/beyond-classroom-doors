import { describe, expect, it } from 'vitest'
import { isFilePath, toBase64 } from './user-files'

describe('license file locations (D12)', () => {
  it('accepts only the app’s own file route', () => {
    expect(isFilePath('/api/files/self/u1/license.pdf')).toBe(true)
    expect(isFilePath('/api/files/self/u1/license.pdf?scope=self')).toBe(true)
    for (const bad of ['https://evil.example/a.pdf', '/api/other/x', '/api/files/../x', '/api/files//x', '/api/files/', 'api/files/x', '/api/files/x#frag']) {
      expect(isFilePath(bad), bad).toBe(false)
    }
  })
  it('encodes bytes as base64', () => {
    expect(toBase64(new Uint8Array([37, 80, 68, 70]))).toBe('JVBERg==')
  })
})

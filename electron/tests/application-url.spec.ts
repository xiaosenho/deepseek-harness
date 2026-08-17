import { describe, expect, it } from 'vitest'
import { resolveApplicationUrl } from '../src/application-url.ts'

describe('resolveApplicationUrl', () => {
  it('accepts an HTTP URL', () => {
    expect(resolveApplicationUrl('http://127.0.0.1:43127').href).toBe('http://127.0.0.1:43127/')
  })

  it('rejects non-HTTP protocols', () => {
    expect(() => resolveApplicationUrl('file:///tmp/app')).toThrow('HTTP or HTTPS')
  })
})

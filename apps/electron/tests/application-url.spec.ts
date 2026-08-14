import { describe, expect, it } from 'vitest'
import { resolveApplicationUrl } from '../src/application-url.ts'

describe('Electron WebUI URL', () => {
  it('accepts HTTP and HTTPS overrides', () => {
    expect(resolveApplicationUrl('http://127.0.0.1:8080/ui').href)
      .toBe('http://127.0.0.1:8080/ui')
    expect(resolveApplicationUrl('https://harness.example/').href)
      .toBe('https://harness.example/')
  })

  it('rejects non-Web protocols and invalid URLs', () => {
    expect(() => resolveApplicationUrl('file:///tmp/index.html')).toThrow(/http:\/\//)
    expect(() => resolveApplicationUrl('not a URL')).toThrow()
    expect(() => resolveApplicationUrl('  ')).toThrow()
  })
})

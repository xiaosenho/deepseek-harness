import { describe, expect, it } from 'vitest'
import { LineBuffer, parseReadyUrls } from '../src/readiness.ts'

describe('WebUI readiness', () => {
  it('accepts the exact loopback readiness line', () => {
    expect(parseReadyUrls('dsh web: http://127.0.0.1:43127')?.loopbackUrl.href)
      .toBe('http://127.0.0.1:43127/')
    expect(parseReadyUrls('dsh web: http://127.0.0.1:43127/')?.loopbackUrl.href)
      .toBe('http://127.0.0.1:43127/')
  })

  it('accepts the exact same-port LAN decoration', () => {
    const urls = parseReadyUrls('dsh web: http://127.0.0.1:43127 (LAN: http://10.0.0.1:43127)')
    expect(urls?.loopbackUrl.href).toBe('http://127.0.0.1:43127/')
    expect(urls?.lanUrl?.href).toBe('http://10.0.0.1:43127/')
  })

  it('rejects non-loopback, non-IPv4, different-port, and decorated output', () => {
    expect(parseReadyUrls('dsh web: http://localhost:43127/')).toBeUndefined()
    expect(parseReadyUrls('dsh web: http://127.0.0.1:43127 (LAN: http://host.local:43127)')).toBeUndefined()
    expect(parseReadyUrls('dsh web: http://127.0.0.1:43127 (LAN: http://10.0.0.1:43128)')).toBeUndefined()
    expect(parseReadyUrls('dsh web: http://127.0.0.1:43127 (LAN: http://256.0.0.1:43127)')).toBeUndefined()
    expect(parseReadyUrls('dsh web: http://127.0.0.1:43127 (LAN: http://0.0.0.0:43127)')).toBeUndefined()
    expect(parseReadyUrls('dsh web: http://127.0.0.1:43127 (LAN: http://127.1.2.3:43127)')).toBeUndefined()
    expect(parseReadyUrls('dsh web: http://127.0.0.1:65536')).toBeUndefined()
    expect(parseReadyUrls('dsh web: http://127.0.0.1:43127 trailing')).toBeUndefined()
    expect(parseReadyUrls('other output')).toBeUndefined()
  })

  it('preserves partial process lines', () => {
    const lines = new LineBuffer()
    expect(lines.push('dsh web: http://127.0.')).toEqual([])
    expect(lines.push('0.1:43127\nnext\r\n')).toEqual([
      'dsh web: http://127.0.0.1:43127',
      'next',
    ])
  })
})

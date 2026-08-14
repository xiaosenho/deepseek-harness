import { describe, expect, it } from 'vitest'
import { LineBuffer, parseReadyUrl } from '../src/readiness.ts'

describe('WebUI readiness', () => {
  it('accepts the exact loopback readiness line', () => {
    expect(parseReadyUrl('dsh web: http://127.0.0.1:43127')?.href)
      .toBe('http://127.0.0.1:43127/')
    expect(parseReadyUrl('dsh web: http://127.0.0.1:43127/')?.href)
      .toBe('http://127.0.0.1:43127/')
  })

  it('rejects non-loopback and decorated output', () => {
    expect(parseReadyUrl('dsh web: http://localhost:43127/')).toBeUndefined()
    expect(parseReadyUrl('dsh web: http://127.0.0.1:43127/ (LAN: http://10.0.0.1:43127)')).toBeUndefined()
    expect(parseReadyUrl('other output')).toBeUndefined()
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

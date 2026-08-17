import { describe, expect, it } from 'vitest'
import { LineBuffer, parseReadyUrls } from '../src/readiness.ts'

describe('readiness', () => {
  it('parses loopback readiness with an optional LAN URL', () => {
    expect(parseReadyUrls('dsh web: http://127.0.0.1:43127')).toEqual({
      loopbackUrl: new URL('http://127.0.0.1:43127/'),
    })
    expect(parseReadyUrls('dsh web: http://127.0.0.1:43127 (LAN: http://192.168.1.5:43127)')).toEqual({
      loopbackUrl: new URL('http://127.0.0.1:43127/'),
      lanUrl: new URL('http://192.168.1.5:43127/'),
    })
  })

  it('ignores unrelated or unsafe lines', () => {
    expect(parseReadyUrls('listening on 43127')).toBeUndefined()
    expect(parseReadyUrls('dsh web: http://127.0.0.1:0')).toBeUndefined()
    expect(parseReadyUrls('dsh web: http://127.0.0.1:43127 (LAN: http://0.0.0.0:43127)')).toBeUndefined()
  })

  it('splits output without losing partial lines', () => {
    const lines = new LineBuffer()
    expect(lines.push('one\ntwo\nth')).toEqual(['one', 'two'])
    expect(lines.push('ree\n')).toEqual(['three'])
  })
})

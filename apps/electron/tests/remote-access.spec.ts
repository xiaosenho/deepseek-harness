import { describe, expect, it } from 'vitest'
import { formatRemoteAccessUrl } from '../src/remote-access.ts'

describe('Electron remote-access presentation', () => {
  it('adds an encoded access token without changing the announced LAN URL', () => {
    const lanUrl = new URL('http://192.168.1.5:43127')

    expect(formatRemoteAccessUrl(lanUrl, 'abc_DEF-1234').href)
      .toBe('http://192.168.1.5:43127/#dsh-access=abc_DEF-1234')
    expect(lanUrl.href).toBe('http://192.168.1.5:43127/')
  })
})

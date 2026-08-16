/** Browser transfer of a fragment token into an API cookie and origin session marker. */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { consumeRemoteAccessFragment } from '../src/client/remote-access.ts'
import {
  REMOTE_ACCESS_COOKIE_NAME,
  REMOTE_ACCESS_FRAGMENT_PARAM,
} from '../src/remote-access.ts'

interface BrowserFixture {
  cookieWrites: string[]
  navigations: string[]
  replacements: Array<{ state: unknown; url: string | URL | null | undefined }>
  storageWrites: Array<{ key: string; value: string }>
}

function browser(hash: string, protocol = 'http:'): BrowserFixture {
  const cookieWrites: string[] = []
  const navigations: string[] = []
  const replacements: BrowserFixture['replacements'] = []
  const storageWrites: BrowserFixture['storageWrites'] = []
  const storage = new Map<string, string>()
  vi.stubGlobal('location', {
    hash,
    pathname: '/session/current',
    protocol,
    replace(url: string) {
      navigations.push(url)
    },
    search: '?view=chat',
  })
  vi.stubGlobal('document', {
    set cookie(value: string) {
      cookieWrites.push(value)
    },
  })
  vi.stubGlobal('history', {
    state: { retained: true },
    replaceState(state: unknown, _unused: string, url?: string | URL | null) {
      replacements.push({ state, url })
    },
  })
  vi.stubGlobal('sessionStorage', {
    getItem(key: string) {
      return storage.get(key) ?? null
    },
    setItem(key: string, value: string) {
      storageWrites.push({ key, value })
      storage.set(key, value)
    },
  })
  return { cookieWrites, navigations, replacements, storageWrites }
}

afterEach(() => { vi.unstubAllGlobals() })

describe('consumeRemoteAccessFragment', () => {
  it('stores one decoded fragment token and removes only its parameter', () => {
    const fixture = browser(`#panel=details&${REMOTE_ACCESS_FRAGMENT_PARAM}=remote%20token%2F123&mode=compact`)
    expect(consumeRemoteAccessFragment()).toBe(true)
    expect(fixture.cookieWrites).toEqual([
      `${REMOTE_ACCESS_COOKIE_NAME}=; Max-Age=0; Path=/; SameSite=Strict`,
      `${REMOTE_ACCESS_COOKIE_NAME}=remote%20token%2F123; Path=/api; SameSite=Strict`,
    ])
    expect(fixture.storageWrites).toEqual([
      { key: `${REMOTE_ACCESS_COOKIE_NAME}_present`, value: '1' },
    ])
    expect(fixture.navigations).toEqual([
      '/session/current?view=chat#panel=details&mode=compact',
    ])
    expect(fixture.replacements).toEqual([])
  })

  it('marks the remote-access cookie Secure on an HTTPS origin', () => {
    const fixture = browser(`#${REMOTE_ACCESS_FRAGMENT_PARAM}=remote-token-1234`, 'https:')
    expect(consumeRemoteAccessFragment()).toBe(true)
    expect(fixture.cookieWrites).toEqual([
      `${REMOTE_ACCESS_COOKIE_NAME}=; Max-Age=0; Path=/; SameSite=Strict; Secure`,
      `${REMOTE_ACCESS_COOKIE_NAME}=remote-token-1234; Path=/api; SameSite=Strict; Secure`,
    ])
  })

  it('removes a sole token without leaving an empty fragment', () => {
    const fixture = browser(`#${REMOTE_ACCESS_FRAGMENT_PARAM}=remote-token-1234`)
    expect(consumeRemoteAccessFragment()).toBe(true)
    expect(fixture.navigations).toEqual(['/session/current?view=chat'])
  })

  it('does nothing when browser globals or the token parameter are absent', () => {
    expect(consumeRemoteAccessFragment()).toBe(false)
    const fixture = browser('#panel=details')
    expect(consumeRemoteAccessFragment()).toBe(false)
    expect(fixture.cookieWrites).toEqual([])
    expect(fixture.navigations).toEqual([])
    expect(fixture.replacements).toEqual([])
  })

  it('removes duplicate token parameters without selecting a credential', () => {
    const fixture = browser(
      `#${REMOTE_ACCESS_FRAGMENT_PARAM}=remote-token-1234&panel=details&${REMOTE_ACCESS_FRAGMENT_PARAM}=other-token-1234`,
    )
    expect(consumeRemoteAccessFragment()).toBe(false)
    expect(fixture.cookieWrites).toEqual([])
    expect(fixture.storageWrites).toEqual([])
    expect(fixture.replacements[0]?.url).toBe('/session/current?view=chat#panel=details')
  })

  it('recognizes the origin session marker after the fragment is gone', () => {
    const fixture = browser(`#${REMOTE_ACCESS_FRAGMENT_PARAM}=remote-token-1234`)
    expect(consumeRemoteAccessFragment()).toBe(true)
    vi.stubGlobal('location', {
      hash: '#panel=details',
      pathname: '/session/current',
      search: '?view=chat',
    })
    expect(consumeRemoteAccessFragment()).toBe(true)
    expect(fixture.storageWrites).toHaveLength(1)
    expect(fixture.navigations).toHaveLength(1)
  })

  it('removes an empty token without granting host authority', () => {
    const fixture = browser(`#panel=details&${REMOTE_ACCESS_FRAGMENT_PARAM}=`)
    expect(consumeRemoteAccessFragment()).toBe(false)
    expect(fixture.cookieWrites).toEqual([])
    expect(fixture.storageWrites).toEqual([])
    expect(fixture.replacements[0]?.url).toBe('/session/current?view=chat#panel=details')
  })

  it('uses the current fragment without session storage and forgets it on reload', () => {
    const fixture = browser(`#${REMOTE_ACCESS_FRAGMENT_PARAM}=remote-token-1234`)
    vi.stubGlobal('sessionStorage', undefined)
    expect(consumeRemoteAccessFragment()).toBe(true)
    expect(fixture.cookieWrites).toHaveLength(2)
    expect(fixture.navigations).toEqual([])
    expect(fixture.replacements).toHaveLength(1)

    vi.stubGlobal('location', {
      hash: '',
      pathname: '/session/current',
      search: '?view=chat',
    })
    expect(consumeRemoteAccessFragment()).toBe(false)
  })

  it('treats session storage failures as an absent reload marker', () => {
    const fixture = browser(`#${REMOTE_ACCESS_FRAGMENT_PARAM}=remote-token-1234`)
    vi.stubGlobal('sessionStorage', {
      getItem() { throw new Error('storage read denied') },
      setItem() { throw new Error('storage write denied') },
    })
    expect(consumeRemoteAccessFragment()).toBe(true)
    expect(fixture.cookieWrites).toHaveLength(2)
    expect(fixture.navigations).toEqual([])
    expect(fixture.replacements).toHaveLength(1)
    expect(fixture.storageWrites).toEqual([])

    vi.stubGlobal('location', {
      hash: '',
      pathname: '/session/current',
      search: '?view=chat',
    })
    expect(consumeRemoteAccessFragment()).toBe(false)
  })
})

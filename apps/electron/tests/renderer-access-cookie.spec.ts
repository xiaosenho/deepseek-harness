/** Authentication cookie owned by Electron main for the FRP loopback renderer. */

import { REMOTE_ACCESS_COOKIE_NAME } from '@deepseek-ai/dsh-client-connection/remote-access'
import { describe, expect, it, vi } from 'vitest'
import {
  synchronizeRendererAccessCookie,
  type RendererCookieStore,
} from '../src/renderer-access-cookie.ts'

function cookieStore() {
  return {
    remove: vi.fn<RendererCookieStore['remove']>().mockResolvedValue(undefined),
    set: vi.fn<RendererCookieStore['set']>().mockResolvedValue(undefined),
  }
}

describe('synchronizeRendererAccessCookie', () => {
  it('removes stale local proof outside FRP mode', async () => {
    const cookies = cookieStore()

    await synchronizeRendererAccessCookie(cookies, new URL('http://127.0.0.1:43127/'), undefined)

    expect(cookies.remove).toHaveBeenCalledWith(
      'http://127.0.0.1:43127/api',
      REMOTE_ACCESS_COOKIE_NAME,
    )
    expect(cookies.set).not.toHaveBeenCalled()
  })

  it('installs an HttpOnly session bearer after removing the previous value', async () => {
    const cookies = cookieStore()

    await synchronizeRendererAccessCookie(
      cookies,
      new URL('http://127.0.0.1:43128/'),
      'renderer-access-token',
    )

    expect(cookies.remove).toHaveBeenCalledBefore(cookies.set)
    expect(cookies.set).toHaveBeenCalledWith({
      url: 'http://127.0.0.1:43128/api',
      name: REMOTE_ACCESS_COOKIE_NAME,
      value: 'renderer-access-token',
      path: '/api',
      httpOnly: true,
      sameSite: 'strict',
      secure: false,
    })
  })

  it('refuses to place the local bearer on any non-owned origin', async () => {
    const cookies = cookieStore()

    for (const url of ['https://127.0.0.1:43127/', 'http://localhost:43127/', 'http://192.168.1.5:43127/']) {
      await expect(synchronizeRendererAccessCookie(cookies, new URL(url), 'renderer-access-token'))
        .rejects.toThrow('exact HTTP loopback URL')
    }
    expect(cookies.remove).not.toHaveBeenCalled()
    expect(cookies.set).not.toHaveBeenCalled()
  })
})

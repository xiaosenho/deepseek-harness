/** Main-owned authentication cookie for an FRP-protected loopback renderer. */

import { REMOTE_ACCESS_COOKIE_NAME } from '@deepseek-ai/dsh-client-connection/remote-access'
import type { Cookies } from 'electron/main'

/** Cookie operations needed to authenticate the managed renderer. */
export type RendererCookieStore = Pick<Cookies, 'remove' | 'set'>

/**
 * Replace the managed loopback origin's local bearer before loading its renderer.
 * @param cookies - Electron session cookie store used by the managed window.
 * @param applicationUrl - exact loopback WebUI URL returned by readiness.
 * @param token - main-only local bearer, absent outside FRP mode.
 * @returns after any stale cookie is removed and the current token is installed.
 */
export async function synchronizeRendererAccessCookie(
  cookies: RendererCookieStore,
  applicationUrl: URL,
  token: string | undefined,
): Promise<void> {
  if (applicationUrl.protocol !== 'http:' || applicationUrl.hostname !== '127.0.0.1') {
    throw new Error('Electron renderer authentication requires an exact HTTP loopback URL')
  }
  const apiUrl = new URL('/api', applicationUrl).href
  await cookies.remove(apiUrl, REMOTE_ACCESS_COOKIE_NAME)
  if (token === undefined) return
  await cookies.set({
    url: apiUrl,
    name: REMOTE_ACCESS_COOKIE_NAME,
    value: token,
    path: '/api',
    httpOnly: true,
    sameSite: 'strict',
    secure: false,
  })
}

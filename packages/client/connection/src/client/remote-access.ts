/** Browser bootstrap for moving a remote-access token out of the address bar. */

import {
  REMOTE_ACCESS_COOKIE_NAME,
  REMOTE_ACCESS_FRAGMENT_PARAM,
} from '../remote-access.ts'
import { API_PATH } from '../api-path.ts'

const REMOTE_ACCESS_SESSION_MARKER = `${REMOTE_ACCESS_COOKIE_NAME}_present`

interface BrowserGlobals {
  document?: Pick<Document, 'cookie'>
  history?: Pick<History, 'replaceState' | 'state'>
  location?: Pick<Location, 'hash' | 'pathname' | 'replace' | 'search'>
  sessionStorage?: Pick<Storage, 'getItem' | 'setItem'>
}

function hasSessionMarker(browser: BrowserGlobals): boolean {
  try {
    return browser.sessionStorage?.getItem(REMOTE_ACCESS_SESSION_MARKER) === '1'
  } catch {
    return false
  }
}

function writeSessionMarker(browser: BrowserGlobals): boolean {
  try {
    if (browser.sessionStorage === undefined) return false
    browser.sessionStorage.setItem(REMOTE_ACCESS_SESSION_MARKER, '1')
    return true
  } catch {
    return false
  }
}

/**
 * Move one fragment token into an API-path Strict session cookie, mark this
 * tab's origin as credential-bearing, then replace the current history entry
 * without that token. Other fragment parameters keep their order. Duplicate
 * token parameters are removed without choosing one. When session storage is
 * available, a newly stored token uses a same-origin replacement navigation
 * so the network stack observes the cookie before the WebUI opens its API and
 * WebSocket connections.
 * @returns Whether this load received a credential or its session marker exists.
 */
export function consumeRemoteAccessFragment(): boolean {
  const browser = globalThis as BrowserGlobals
  const pageLocation = browser.location
  const pageDocument = browser.document
  const pageHistory = browser.history
  const existingMarker = hasSessionMarker(browser)
  if (pageLocation === undefined || pageDocument === undefined || pageHistory === undefined) {
    return existingMarker
  }

  const fragment = new URLSearchParams(pageLocation.hash.startsWith('#')
    ? pageLocation.hash.slice(1)
    : pageLocation.hash)
  const tokens = fragment.getAll(REMOTE_ACCESS_FRAGMENT_PARAM)
  if (tokens.length === 0) return existingMarker

  fragment.delete(REMOTE_ACCESS_FRAGMENT_PARAM)
  const [token] = tokens
  const storedToken = tokens.length === 1 && token !== undefined && token !== ''
  let markerWritten = false
  if (storedToken) {
    pageDocument.cookie = `${REMOTE_ACCESS_COOKIE_NAME}=; Max-Age=0; Path=/; SameSite=Strict`
    pageDocument.cookie = `${REMOTE_ACCESS_COOKIE_NAME}=${encodeURIComponent(token)}; Path=${API_PATH}; SameSite=Strict`
    markerWritten = writeSessionMarker(browser)
  }
  const remaining = fragment.toString()
  const cleanUrl = `${pageLocation.pathname}${pageLocation.search}${remaining === '' ? '' : `#${remaining}`}`
  if (storedToken && markerWritten) pageLocation.replace(cleanUrl)
  else pageHistory.replaceState(pageHistory.state, '', cleanUrl)
  return existingMarker || storedToken
}

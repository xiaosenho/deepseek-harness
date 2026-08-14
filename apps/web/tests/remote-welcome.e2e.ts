// A paired non-loopback browser receives the same Host authority as loopback:
// durable settings, persisted sessions, and Host filesystem browsing.
import type { Browser, Page } from 'playwright'
import { chromium } from 'playwright'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  acknowledgeReloadConnectionLoss, launchWebScaffold, seedBlankSession,
  watchConsole, webSnapshotMode,
  type WebScaffold,
} from './scaffold.ts'
import { ZH_BROWSER_LOCALE } from './support.ts'

const MODE = webSnapshotMode()
const REMOTE_ACCESS_TOKEN = 'remote-test-token'
const REMOTE_ACCESS_COOKIE = 'dsh_remote_access'
const REMOTE_SESSION_ID = 'remote-host-visible-session'

async function rpc<T>(page: Page, method: string, payload: unknown): Promise<T> {
  const response = await page.evaluate(async ({ method: requestMethod, payload: requestPayload }) => {
    const result = await fetch(`/api/${requestMethod}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        type: 'client-request',
        rpcId: `remote-${requestMethod}`,
        method: requestMethod,
        payload: requestPayload,
      }),
    })
    return { body: await result.json() as unknown, status: result.status }
  }, { method, payload })
  expect(response.status).toBe(200)
  const body = response.body as {
    result: { ok: true; value: T } | { ok: false; error: { code: string; message: string } }
  }
  if (!body.result.ok) {
    throw new Error(`${method} failed: ${body.result.error.code}: ${body.result.error.message}`)
  }
  return body.result.value
}

describe.skipIf(MODE === 'record')('web e2e: remote Host access', () => {
  let scaffold: WebScaffold
  let browser: Browser
  let page: Page
  let tripwire: ReturnType<typeof watchConsole>

  beforeAll(async () => {
    scaffold = await launchWebScaffold({
      remoteAuthority: 'dsh-lan.test',
      remoteAccessToken: REMOTE_ACCESS_TOKEN,
    })
    await seedBlankSession(scaffold, REMOTE_SESSION_ID, scaffold.workspaceCwd)
    browser = await chromium.launch({
      args: [
        '--host-resolver-rules=MAP dsh-lan.test 127.0.0.1',
        '--no-proxy-server',
      ],
    })
    page = await browser.newPage({
      viewport: { width: 1440, height: 960 },
      locale: ZH_BROWSER_LOCALE,
    })
    await page.goto(`${scaffold.baseUrl}/#dsh-access=${REMOTE_ACCESS_TOKEN}`, { waitUntil: 'load' })
    await page.waitForURL(url => url.hash === '', { waitUntil: 'load' })
    await page.waitForSelector('#root', { timeout: 30_000 })
    expect(await page.evaluate(() => ({
      getRandomValues: typeof globalThis.crypto.getRandomValues,
      randomUUID: typeof globalThis.crypto.randomUUID,
      secureContext: globalThis.isSecureContext,
    }))).toEqual({
      getRandomValues: 'function',
      randomUUID: 'undefined',
      secureContext: false,
    })
    expect(new URL(page.url()).hash).toBe('')
    expect(await page.context().cookies(`${scaffold.baseUrl}/api/`)).toEqual(expect.arrayContaining([
      expect.objectContaining({
        name: REMOTE_ACCESS_COOKIE,
        path: '/api',
        sameSite: 'Strict',
        value: REMOTE_ACCESS_TOKEN,
      }),
    ]))
    await page.waitForSelector('[class*="frame"]', { timeout: 15_000 })
    tripwire = watchConsole(page)
  }, 120_000)

  afterAll(async () => {
    await browser?.close()
    await scaffold?.close()
  })

  it('uses Host sessions, settings, and filesystem across reload', async () => {
    const sessions = await rpc<{ items: { sessionId: string }[] }>(
      page, 'session.list', {},
    )
    expect(sessions.items.map(item => item.sessionId)).toContain(REMOTE_SESSION_ID)

    const settings = await rpc<{ writable: boolean }>(
      page, 'settings.describe', {},
    )
    expect(settings.writable).toBe(true)

    const listing = await rpc<{ path: string; home: string }>(
      page, 'host.listDirectory', { path: scaffold.workspaceCwd },
    )
    expect(listing.path).toBe(scaffold.workspaceCwd)
    expect(listing.home).not.toBe('')
    expect(tripwire.warnings).toEqual([])

    const reloadWarnings = tripwire.warnings.length
    await page.reload({ waitUntil: 'load' })
    await page.waitForSelector('[class*="frame"]', { timeout: 15_000 })
    acknowledgeReloadConnectionLoss(tripwire, reloadWarnings)
    const reloadedSessions = await rpc<{ items: { sessionId: string }[] }>(
      page, 'session.list', {},
    )
    expect(reloadedSessions.items.map(item => item.sessionId)).toContain(REMOTE_SESSION_ID)
    expect(tripwire.warnings).toEqual([])
    expect(tripwire.pageErrors).toEqual([])
  }, 60_000)
})

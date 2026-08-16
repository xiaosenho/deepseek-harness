// Electron desktop settings through the real Web Host, client catalog, built
// plugin bundle, and Settings slots. The init script substitutes only the
// sandboxed preload transport because Playwright does not run Electron main.
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Browser, Page } from 'playwright'
import { chromium } from 'playwright'
import { afterAll, beforeAll, describe, expect, it, onTestFailed } from 'vitest'
import {
  assertFixtureInventory,
  captureStableAria,
  compareOrRefreshGolden,
  launchWebScaffold,
  watchConsole,
  webSnapshotMode,
  type WebScaffold,
} from './scaffold.ts'
import { saveFailureShot, ZH_BROWSER_LOCALE } from './support.ts'

const SNAPSHOT_DIR = fileURLToPath(new URL('./snapshots/electron-desktop', import.meta.url))
const CONFIGURED_EXPECTED = join(SNAPSHOT_DIR, 'frp-configured.expected.md')
const ENABLED_EXPECTED = join(SNAPSHOT_DIR, 'frp-enabled.expected.md')
const MODE = webSnapshotMode()

async function installDesktopFixture(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const fixture = {
      copied: 0,
      saved: [] as unknown[],
      state: {
        currentVersion: '0.1.0-fixture',
        remoteAccess: {
          enabled: false,
          preferredMode: 'lan',
          transitioning: false,
          frp: {
            serverAddress: '',
            serverPort: 7_000,
            remotePort: 0,
            publicOrigin: '',
            executablePath: 'frpc',
            tlsTrustedCaFile: '',
            tlsServerName: '',
            authTokenConfigured: false,
            allowInsecureHttp: false,
          },
        },
        update: { status: 'current' },
      },
    }
    const cloneState = () => structuredClone(fixture.state)
    const target = window as unknown as {
      __dshElectronFixture: typeof fixture
      dshElectron: unknown
    }
    target.__dshElectronFixture = fixture
    target.dshElectron = {
      getDesktopState: async () => cloneState(),
      saveRemoteAccessConfiguration: async (raw: unknown) => {
        const input = raw as {
          mode: 'lan' | 'frp'
          frp: typeof fixture.state.remoteAccess.frp & {
            authToken: { action: 'keep' | 'clear' | 'replace'; value?: string }
          }
        }
        fixture.saved.push(structuredClone(input))
        fixture.state.remoteAccess.preferredMode = input.mode
        fixture.state.remoteAccess.frp = {
          serverAddress: input.frp.serverAddress,
          serverPort: input.frp.serverPort,
          remotePort: input.frp.remotePort,
          publicOrigin: input.frp.publicOrigin,
          executablePath: input.frp.executablePath,
          tlsTrustedCaFile: input.frp.tlsTrustedCaFile,
          tlsServerName: input.frp.tlsServerName,
          allowInsecureHttp: input.frp.allowInsecureHttp,
          authTokenConfigured: input.frp.authToken.action === 'replace'
            ? true
            : input.frp.authToken.action === 'clear'
              ? false
              : fixture.state.remoteAccess.frp.authTokenConfigured,
        }
        return cloneState()
      },
      selectRemoteAccessFile: async (kind: 'frpc-executable' | 'trusted-ca') => kind === 'frpc-executable'
        ? '/opt/homebrew/bin/frpc'
        : '/etc/frp/ca.crt',
      setRemoteAccessEnabled: async (enabled: boolean) => {
        if (enabled) {
          Object.assign(fixture.state.remoteAccess, {
            activeMode: fixture.state.remoteAccess.preferredMode,
            enabled: true,
            publicEndpoint: 'http://203.0.113.9:32100/',
          })
        } else {
          fixture.state.remoteAccess.enabled = false
          Reflect.deleteProperty(fixture.state.remoteAccess, 'activeMode')
          Reflect.deleteProperty(fixture.state.remoteAccess, 'publicEndpoint')
        }
        return true
      },
      copyRemoteAccessUrl: async () => { fixture.copied += 1; return true },
      checkForUpdates: async () => cloneState(),
      installUpdate: async () => false,
    }
  })
}

describe('web e2e: Electron FRP remote access settings', () => {
  let scaffold: WebScaffold
  let browser: Browser
  let page: Page
  let tripwire: ReturnType<typeof watchConsole>

  beforeAll(async () => {
    scaffold = await launchWebScaffold({})
    browser = await chromium.launch()
    page = await browser.newPage({ viewport: { width: 1440, height: 920 }, locale: ZH_BROWSER_LOCALE })
    await installDesktopFixture(page)
    tripwire = watchConsole(page)
    await page.goto(scaffold.baseUrl, { waitUntil: 'load' })
    await page.waitForSelector('[class*="frame"]', { timeout: 30_000 })
  }, 120_000)

  afterAll(async () => {
    await browser?.close()
    await scaffold?.close()
  })

  it('configures, confirms, and publishes a redacted FRP endpoint', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-electron-frp'))
    await page.getByRole('button', { name: '设置', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: '设置' })
    await dialog.getByRole('button', { name: '远程连接', exact: true }).click()
    const section = dialog.locator('[data-electron-remote-access]')
    await section.getByRole('button', { name: '公网 FRP', exact: true }).click()
    await section.getByLabel('公网服务器地址', { exact: true }).fill('203.0.113.9')
    await section.getByRole('button', { name: '选择文件', exact: true }).nth(1).click()
    await section.getByLabel('frps 认证令牌（可选）', { exact: true }).fill('frps-auth-secret')
    await section.getByRole('checkbox').check()
    await section.getByRole('button', { name: '保存配置', exact: true }).click()
    await expect.poll(() => section.getByText('先保存配置，再开启远程连接。').count(), {
      timeout: 5_000,
    }).toBe(0)

    await compareOrRefreshGolden(
      CONFIGURED_EXPECTED,
      await captureStableAria(page, '[data-electron-remote-access]', scaffold.workspaceCwd),
      MODE,
    )
    const saved = await page.evaluate(() => {
      return (window as unknown as { __dshElectronFixture: { saved: unknown[] } })
        .__dshElectronFixture.saved
    })
    expect(saved).toEqual([expect.objectContaining({
      mode: 'frp',
      frp: expect.objectContaining({
        serverAddress: '203.0.113.9',
        serverPort: 7_000,
        remotePort: 0,
        tlsTrustedCaFile: '/etc/frp/ca.crt',
        authToken: { action: 'replace', value: 'frps-auth-secret' },
      }),
    })])

    await section.getByRole('switch', { name: '开启远程连接' }).click()
    const confirmation = page.getByRole('dialog', { name: '开启远程连接' })
    await confirmation.getByRole('button', { name: '确认开启', exact: true }).click()
    await section.getByText('http://203.0.113.9:32100/', { exact: true }).waitFor({ timeout: 5_000 })
    await section.getByRole('button', { name: '复制完整链接', exact: true }).click()

    await compareOrRefreshGolden(
      ENABLED_EXPECTED,
      await captureStableAria(page, '[data-electron-remote-access]', scaffold.workspaceCwd),
      MODE,
    )
    const state = await page.evaluate(() => {
      const fixture = (window as unknown as {
        __dshElectronFixture: { copied: number }
      }).__dshElectronFixture
      return { copied: fixture.copied, text: document.body.innerText }
    })
    expect(state.copied).toBe(1)
    expect(state.text).not.toContain('frps-auth-secret')
    expect(state.text).not.toContain('#dsh-access=')
    expect(tripwire.pageErrors).toEqual([])
    expect(tripwire.warnings).toEqual([])
  }, 60_000)

  it.skipIf(MODE === 'record')('keeps the fixture inventory closed', async () => {
    await assertFixtureInventory(SNAPSHOT_DIR, [
      'frp-configured.expected.md',
      'frp-enabled.expected.md',
    ])
  })
})

import { describe, expect, it, vi } from 'vitest'
import {
  installUpdateAfterShutdown,
  OtaUpdateController,
  startOtaUpdate,
  type InstallDownloadedUpdate,
  type StartOtaUpdateOptions,
} from '../src/updater.ts'

const SHA512 = Buffer.alloc(64, 7).toString('base64')
const OTA_BASE_URL = 'https://ota.example/'
const ARTIFACT_BASE_URL = 'https://application-1305333896.cos.ap-guangzhou.myqcloud.com/releases/'

function release(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    changelog: 'Fixes and stability improvements',
    file_url: `${ARTIFACT_BASE_URL}deepseek-harness-0.2.0-mac-arm64.dmg`,
    id: 'a9x8k1m3q2w7e4r',
    is_force: false,
    platform: 'macos',
    version: '0.2.0',
    version_code: 2,
    ...overrides,
  }
}

function response(items: unknown[]): Response {
  return Response.json({ items, page: 1, perPage: 1, totalItems: -1, totalPages: -1 })
}

function updateInfo(overrides: Record<string, unknown> = {}) {
  return {
    files: [
      { sha512: SHA512, url: 'deepseek-harness-0.2.0-mac-arm64.dmg' },
      { sha512: SHA512, url: 'deepseek-harness-0.2.0-mac-arm64.zip' },
    ],
    version: '0.2.0',
    ...overrides,
  }
}

function fakeUpdater(result = { isUpdateAvailable: true, updateInfo: updateInfo() }) {
  return {
    allowDowngrade: true,
    autoDownload: true,
    autoInstallOnAppQuit: false,
    disableDifferentialDownload: true,
    checkForUpdates: vi.fn().mockResolvedValue(result),
    downloadUpdate: vi.fn().mockResolvedValue(['/cache/update.zip']),
    on: vi.fn(),
    once: vi.fn(),
    quitAndInstall: vi.fn(),
    removeListener: vi.fn(),
    setFeedURL: vi.fn(),
  }
}

function options(overrides: Partial<StartOtaUpdateOptions> = {}): StartOtaUpdateOptions {
  return {
    baseUrl: OTA_BASE_URL,
    currentVersion: '0.1.0',
    fetch: vi.fn().mockResolvedValue(response([release()])),
    isPackaged: true,
    onForceUpdateReady: vi.fn(),
    platform: 'darwin',
    updater: fakeUpdater(),
    ...overrides,
  }
}

describe('Electron PocketBase OTA updater', () => {
  it('skips source runs without loading update dependencies or making a request', async () => {
    const fetch = vi.fn()
    const updater = fakeUpdater()

    await expect(startOtaUpdate(options({ fetch, isPackaged: false, updater })))
      .resolves.toEqual({ status: 'disabled' })

    expect(fetch).not.toHaveBeenCalled()
    expect(updater.checkForUpdates).not.toHaveBeenCalled()
  })

  it('queries the newest record for the mapped platform and skips the current version', async () => {
    const fetch = vi.fn().mockResolvedValue(response([release({ version: '0.1.0' })]))
    const updater = fakeUpdater()

    await expect(startOtaUpdate(options({ fetch, updater }))).resolves.toEqual({ status: 'current' })

    expect(fetch).toHaveBeenCalledOnce()
    const [requestValue, init] = fetch.mock.calls[0] as [string, RequestInit]
    const request = new URL(requestValue)
    expect(request.origin).toBe('https://ota.example')
    expect(request.pathname).toBe('/api/collections/app_releases/records')
    expect(request.searchParams.get('filter')).toBe('platform="macos"')
    expect(request.searchParams.get('sort')).toBe('-version_code')
    expect(request.searchParams.get('perPage')).toBe('1')
    expect(request.searchParams.get('skipTotal')).toBe('1')
    expect(init.headers).toEqual({ accept: 'application/json' })
    expect(init.signal).toBeInstanceOf(AbortSignal)
    expect(updater.checkForUpdates).not.toHaveBeenCalled()
  })

  it('validates metadata, reports progress, and downloads optional updates in the background', async () => {
    const updater = fakeUpdater()
    const onDownloadStart = vi.fn()
    const onDownloadProgress = vi.fn()

    await expect(startOtaUpdate(options({ onDownloadProgress, onDownloadStart, updater })))
      .resolves.toEqual({
        status: 'ready',
        version: '0.2.0',
        changelog: 'Fixes and stability improvements',
      })

    const [, progressListener] = updater.on.mock.calls.find(([event]) => event === 'download-progress') as [
      'download-progress',
      (progress: { percent: number }) => void,
    ]
    progressListener({ percent: 42.5 })
    expect(onDownloadProgress).toHaveBeenCalledWith({ percent: 42.5 })
    expect(updater.removeListener).toHaveBeenCalledWith('download-progress', progressListener)
    expect(onDownloadStart).toHaveBeenCalledWith(false)
    expect(updater.setFeedURL).toHaveBeenCalledWith({ provider: 'generic', url: ARTIFACT_BASE_URL })
    expect(updater.allowDowngrade).toBe(false)
    expect(updater.autoDownload).toBe(false)
    expect(updater.autoInstallOnAppQuit).toBe(true)
    expect(updater.disableDifferentialDownload).toBe(false)
    expect(updater.downloadUpdate).toHaveBeenCalledOnce()
    expect(updater.quitAndInstall).not.toHaveBeenCalled()
  })

  it('requests an orderly restart after a forced update finishes downloading', async () => {
    const updater = fakeUpdater()
    const onDownloadStart = vi.fn()
    const onInstallError = vi.fn()
    const onForceUpdateReady = vi.fn(async (install: InstallDownloadedUpdate) => { install(onInstallError) })
    const fetch = vi.fn().mockResolvedValue(response([release({ is_force: true })]))

    await expect(startOtaUpdate(options({ fetch, onDownloadStart, onForceUpdateReady, updater })))
      .resolves.toEqual({
        status: 'ready',
        version: '0.2.0',
        changelog: 'Fixes and stability improvements',
      })

    expect(onDownloadStart).toHaveBeenCalledWith(true)
    expect(onForceUpdateReady).toHaveBeenCalledOnce()
    expect(updater.once).toHaveBeenCalledWith('error', onInstallError)
    expect(updater.quitAndInstall).toHaveBeenCalledWith(false, true)
    const [, reportInstallError] = updater.once.mock.calls[0] as ['error', (error: Error) => void]
    const failure = new Error('installer failed')
    reportInstallError(failure)
    expect(onInstallError).toHaveBeenCalledWith(failure)
  })

  it('reports a synchronous forced-install failure and removes its error listener', async () => {
    const updater = fakeUpdater()
    updater.quitAndInstall.mockImplementation(() => { throw new Error('installer failed') })
    const logger = { error: vi.fn(), info: vi.fn(), warn: vi.fn() }
    const onForceUpdateReady = vi.fn(async (install: InstallDownloadedUpdate) => { install(vi.fn()) })
    const fetch = vi.fn().mockResolvedValue(response([release({ is_force: true })]))

    await expect(startOtaUpdate(options({ fetch, logger, onForceUpdateReady, updater })))
      .resolves.toEqual({ status: 'failed', detail: 'installer failed' })

    expect(updater.removeListener).toHaveBeenCalledWith('error', expect.any(Function))
    expect(logger.error).toHaveBeenCalledWith('[OTA] Update check failed: installer failed')
  })

  it.each([
    ['a mismatched metadata version', updateInfo({ version: '0.3.0' })],
    ['a missing release artifact', updateInfo({ files: [{ sha512: SHA512, url: 'other.zip' }] })],
    ['an invalid checksum', updateInfo({ files: [{ sha512: 'not-a-sha512', url: 'deepseek-harness-0.2.0-mac-arm64.dmg' }] })],
    ['a foreign download origin', updateInfo({ files: [{ sha512: SHA512, url: 'https://foreign.example/update.dmg' }] })],
  ])('rejects %s before download', async (_name, metadata) => {
    const updater = fakeUpdater({ isUpdateAvailable: true, updateInfo: metadata })
    const logger = { error: vi.fn(), info: vi.fn(), warn: vi.fn() }

    await startOtaUpdate(options({ logger, updater }))

    expect(updater.downloadUpdate).not.toHaveBeenCalled()
    expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('[OTA] Update check failed:'))
  })

  it.each(['win32', 'linux'] as const)('does not enable unsigned automatic installation on %s', async (platform) => {
    const fetch = vi.fn()
    const logger = { error: vi.fn(), info: vi.fn(), warn: vi.fn() }

    await expect(startOtaUpdate(options({ fetch, logger, platform })))
      .resolves.toEqual({ status: 'unsupported' })

    expect(fetch).not.toHaveBeenCalled()
    expect(logger.warn).toHaveBeenCalledWith(`[OTA] Unsupported Electron platform: ${platform}`)
  })

  it('does not download when the app runs from a read-only volume', async () => {
    const fetch = vi.fn()
    const logger = { error: vi.fn(), info: vi.fn(), warn: vi.fn() }

    await expect(startOtaUpdate(options({
      applicationExecPath: '/Volumes/DeepSeek Harness/DeepSeek Harness.app/Contents/MacOS/DeepSeek Harness',
      fetch,
      logger,
    }))).resolves.toEqual({ status: 'readonly' })

    expect(fetch).not.toHaveBeenCalled()
    expect(logger.warn).toHaveBeenCalledWith('[OTA] Application runs from a read-only volume')
  })

  it('does not download when the macOS app is unsigned', async () => {
    const fetch = vi.fn()
    const logger = { error: vi.fn(), info: vi.fn(), warn: vi.fn() }

    await expect(startOtaUpdate(options({
      applicationExecPath: '/tmp/Unsigned.app/Contents/MacOS/Unsigned',
      fetch,
      logger,
      platform: 'darwin',
    }))).resolves.toEqual({ status: 'unsigned' })

    expect(fetch).not.toHaveBeenCalled()
    expect(logger.warn).toHaveBeenCalledWith('[OTA] macOS application is not signed; Squirrel.Mac cannot replace it')
  })

  it('contains HTTP, schema, and configured-origin failures without blocking startup', async () => {
    const logger = { error: vi.fn(), info: vi.fn(), warn: vi.fn() }
    const invalidResponses = [
      vi.fn().mockResolvedValue(new Response('unavailable', { status: 503 })),
      vi.fn().mockResolvedValue(Response.json({ items: [release({ version_code: 1.5 })] })),
      vi.fn().mockResolvedValue(Response.json({ items: [release({ file_url: 'https://attacker.example/update.dmg' })] })),
      vi.fn().mockResolvedValue(new Response('x'.repeat(65 * 1024))),
    ]

    for (const fetch of invalidResponses) {
      await expect(startOtaUpdate(options({ fetch, logger })))
        .resolves.toMatchObject({ status: 'failed' })
    }
    await expect(startOtaUpdate(options({ baseUrl: 'http://ota.example', logger })))
      .resolves.toMatchObject({ status: 'failed' })

    expect(logger.error).toHaveBeenCalledTimes(5)
  })

  it('reports an empty release collection to the native caller', async () => {
    await expect(startOtaUpdate(options({
      fetch: vi.fn().mockResolvedValue(response([])),
    }))).resolves.toEqual({ status: 'no-release' })
  })

  it('coalesces an active check and retains a downloaded update', async () => {
    let resolveFetch: ((value: Response) => void) | undefined
    const fetch = vi.fn(() => new Promise<Response>((resolve) => { resolveFetch = resolve }))
    const updater = fakeUpdater()
    const controller = new OtaUpdateController(options({ fetch, updater }))

    const first = controller.check()
    const second = controller.check()
    expect(second).toBe(first)
    expect(fetch).toHaveBeenCalledOnce()
    resolveFetch?.(response([release()]))
    await expect(first).resolves.toEqual({
      status: 'ready',
      version: '0.2.0',
      changelog: 'Fixes and stability improvements',
    })

    await expect(controller.check()).resolves.toEqual({
      status: 'ready',
      version: '0.2.0',
      changelog: 'Fixes and stability improvements',
    })
    expect(fetch).toHaveBeenCalledOnce()
    expect(updater.downloadUpdate).toHaveBeenCalledOnce()
  })
})

describe('forced-update shutdown', () => {
  it('waits for owned processes before invoking the installer', async () => {
    let finishStopping: (() => void) | undefined
    const stop = vi.fn(() => new Promise<void>((resolve) => { finishStopping = resolve }))
    const install = vi.fn()
    const operation = installUpdateAfterShutdown(stop, install)

    await vi.waitFor(() => { expect(stop).toHaveBeenCalledOnce() })
    expect(install).not.toHaveBeenCalled()
    finishStopping?.()
    await operation

    expect(install).toHaveBeenCalledOnce()
  })

  it('does not install when process shutdown fails', async () => {
    const install = vi.fn()

    await expect(installUpdateAfterShutdown(
      () => Promise.reject(new Error('tree still running')),
      install,
    )).rejects.toThrow('tree still running')

    expect(install).not.toHaveBeenCalled()
  })
})

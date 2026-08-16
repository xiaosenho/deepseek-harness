import { expect, it, vi } from 'vitest'

const updater = vi.hoisted(() => ({
  allowDowngrade: true,
  autoDownload: true,
  autoInstallOnAppQuit: false,
  disableDifferentialDownload: true,
  checkForUpdates: vi.fn(async () => ({
    isUpdateAvailable: true,
    updateInfo: {
      files: [{
        sha512: Buffer.alloc(64, 7).toString('base64'),
        url: 'deepseek-harness-0.2.0-mac-arm64.dmg',
      }],
      version: '0.2.0',
    },
  })),
  downloadUpdate: vi.fn(async () => ['/cache/update.dmg']),
  once: vi.fn(),
  quitAndInstall: vi.fn(),
  removeListener: vi.fn(),
  setFeedURL: vi.fn(),
}))

vi.mock('electron-updater', () => ({ default: { autoUpdater: updater } }))

import { startOtaUpdate } from '../src/updater.ts'

it('loads autoUpdater from the CommonJS default export', async () => {
  const release = {
    changelog: 'Release notes',
    file_url: 'https://application-1305333896.cos.ap-guangzhou.myqcloud.com/releases/deepseek-harness-0.2.0-mac-arm64.dmg',
    id: 'a9x8k1m3q2w7e4r',
    is_force: false,
    platform: 'macos',
    version: '0.2.0',
    version_code: 2,
  }

  await expect(startOtaUpdate({
    baseUrl: 'https://ota.example/',
    currentVersion: '0.1.0',
    fetch: vi.fn(async () => Response.json({ items: [release] })),
    isPackaged: true,
    onForceUpdateReady: vi.fn(),
    platform: 'darwin',
  })).resolves.toEqual({ status: 'ready', version: '0.2.0', changelog: 'Release notes' })
  expect(updater.allowDowngrade).toBe(false)
  expect(updater.downloadUpdate).toHaveBeenCalledOnce()
})

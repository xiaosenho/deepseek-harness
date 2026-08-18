import { describe, expect, it, vi } from 'vitest'
import {
  createApplicationMenuTemplate,
  runManualUpdateCheck,
  type ApplicationMenuOptions,
} from '../src/application-menu.ts'

function options(overrides: Partial<ApplicationMenuOptions> = {}): ApplicationMenuOptions {
  return {
    applicationName: 'DeepSeek Harness',
    checkForUpdates: vi.fn().mockResolvedValue({ status: 'current' }),
    currentVersion: '0.1.0',
    installCommandLine: vi.fn().mockResolvedValue({ status: 'installed', message: '安装完成', path: '/tmp/dsh' }),
    installUpdate: vi.fn().mockResolvedValue(true),
    platform: 'darwin',
    showMessageBox: vi.fn().mockResolvedValue({ checkboxChecked: false, response: 0 }),
    ...overrides,
  }
}

function updateItem(template: ReturnType<typeof createApplicationMenuTemplate>) {
  const candidates = template.flatMap(entry => Array.isArray(entry.submenu) ? entry.submenu : [])
  return candidates.find(entry => entry.id === 'check-for-updates')
}

describe('Electron application menu', () => {
  it('keeps About and update checks in the macOS application menu', () => {
    const template = createApplicationMenuTemplate(options())
    const applicationMenu = template[0]

    expect(applicationMenu?.label).toBe('DeepSeek Harness')
    expect(applicationMenu?.submenu).toContainEqual({ label: '关于 DeepSeek Harness', role: 'about' })
    expect(updateItem(template)).toMatchObject({
      id: 'check-for-updates',
      label: '检查更新...',
    })
  })

  it('keeps About and update checks in Help on other platforms', () => {
    const template = createApplicationMenuTemplate(options({ platform: 'win32' }))
    const help = template.find(entry => entry.role === 'help')

    expect(help?.label).toBe('帮助')
    expect(help?.submenu).toContainEqual({ label: '关于 DeepSeek Harness', role: 'about' })
    expect(updateItem(template)).toMatchObject({ id: 'check-for-updates', label: '检查更新...' })
  })

  it('keeps an install-dsh command in the macOS application menu and Help elsewhere', () => {
    const macTemplate = createApplicationMenuTemplate(options())
    const macEntries = macTemplate.flatMap(entry => Array.isArray(entry.submenu) ? entry.submenu : [])
    expect(macEntries.find(entry => entry.id === 'install-dsh')).toMatchObject({ label: '安装 dsh 命令行...' })

    const helpTemplate = createApplicationMenuTemplate(options({ platform: 'linux' }))
    const help = helpTemplate.find(entry => entry.role === 'help')
    const helpEntries = Array.isArray(help?.submenu) ? help.submenu : []
    expect(helpEntries.find(entry => entry.id === 'install-dsh')).toMatchObject({ label: '安装 dsh 命令行...' })
  })

  it('does not add remote access commands', () => {
    for (const platform of ['darwin', 'win32'] as const) {
      const template = createApplicationMenuTemplate(options({ platform }))
      const entries = template.flatMap(entry => Array.isArray(entry.submenu) ? entry.submenu : [])
      expect(entries.find(entry => entry.label === 'Remote Access')).toBeUndefined()
    }
  })

  it.each([
    [{ status: 'disabled' } as const, '更新仅适用于已安装的应用。'],
    [{ status: 'unsupported' } as const, '当前平台暂不支持自动更新。'],
    [{ status: 'readonly' } as const, '当前应用运行在只读卷（如 DMG）上，无法自动更新。'],
    [{ status: 'unsigned' } as const, '当前应用未签名，无法通过 macOS 自动更新安装。'],
    [{ status: 'no-release' } as const, '当前没有已发布的更新。'],
    [{ status: 'current' } as const, 'DeepSeek Harness 0.1.0 已是最新版本。'],
    [{ status: 'ready', version: '0.2.0', changelog: '新版本。' } as const, 'DeepSeek Harness 0.2.0 已准备好安装。'],
    [{ status: 'failed', detail: '网络不可用' } as const, '更新检查失败。'],
  ])('presents the %s result and restores the menu item', async (result, message) => {
    const showMessageBox = vi.fn().mockResolvedValue({ checkboxChecked: false, response: 0 })
    const item = { enabled: true, label: '检查更新...' }
    const operation = runManualUpdateCheck(item, options({
      checkForUpdates: vi.fn().mockResolvedValue(result),
      showMessageBox,
    }))

    expect(item).toEqual({ enabled: false, label: '正在检查更新...' })
    await operation
    expect(showMessageBox).toHaveBeenCalledWith(expect.objectContaining({ message }))
    expect(item).toEqual({ enabled: true, label: '检查更新...' })
  })
})

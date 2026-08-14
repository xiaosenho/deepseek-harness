import { describe, expect, it, vi } from 'vitest'
import {
  createApplicationMenuTemplate,
  refreshRemoteAccessMenu,
  runManualUpdateCheck,
  type ApplicationMenuOptions,
  type RemoteAccessMenuOptions,
} from '../src/application-menu.ts'

function options(overrides: Partial<ApplicationMenuOptions> = {}): ApplicationMenuOptions {
  return {
    applicationName: 'DeepSeek Harness',
    checkForUpdates: vi.fn().mockResolvedValue({ status: 'current' }),
    currentVersion: '0.1.0',
    platform: 'darwin',
    showMessageBox: vi.fn().mockResolvedValue({ checkboxChecked: false, response: 0 }),
    ...overrides,
  }
}

function updateItem(template: ReturnType<typeof createApplicationMenuTemplate>) {
  const candidates = template.flatMap(entry => Array.isArray(entry.submenu) ? entry.submenu : [])
  return candidates.find(entry => entry.id === 'check-for-updates')
}

function remoteOptions(
  overrides: Partial<RemoteAccessMenuOptions> = {},
): RemoteAccessMenuOptions {
  return {
    state: { enabled: false, transitioning: false },
    commands: {
      start: vi.fn(),
      stop: vi.fn(),
      showDetails: vi.fn(),
      copyUrl: vi.fn(),
    },
    ...overrides,
  }
}

function remoteItems(template: ReturnType<typeof createApplicationMenuTemplate>) {
  const parents = template.flatMap(entry => Array.isArray(entry.submenu) ? entry.submenu : [])
  const remote = parents.find(entry => entry.label === 'Remote Access')
  return Array.isArray(remote?.submenu) ? remote.submenu : []
}

describe('Electron application menu', () => {
  it('keeps About and manual updates in the macOS application menu', () => {
    const template = createApplicationMenuTemplate(options())
    const applicationMenu = template[0]

    expect(applicationMenu?.label).toBe('DeepSeek Harness')
    expect(applicationMenu?.submenu).toContainEqual({ role: 'about' })
    expect(updateItem(template)).toMatchObject({
      id: 'check-for-updates',
      label: 'Check for Updates...',
    })
  })

  it('keeps About and manual updates in Help on other platforms', () => {
    const template = createApplicationMenuTemplate(options({ platform: 'win32' }))
    const help = template.find(entry => entry.role === 'help')

    expect(help?.submenu).toContainEqual({ role: 'about' })
    expect(updateItem(template)).toMatchObject({ id: 'check-for-updates' })
  })

  it('omits remote access when Electron does not own the Web backend', () => {
    expect(remoteItems(createApplicationMenuTemplate(options()))).toEqual([])
  })

  it.each(['darwin', 'win32'] as const)(
    'places native remote access beside update operations on %s',
    (platform) => {
      const commands = remoteOptions().commands
      const template = createApplicationMenuTemplate(options({
        platform,
        remoteAccess: remoteOptions({ commands }),
      }))
      const items = remoteItems(template)

      expect(items).toEqual(expect.arrayContaining([
        expect.objectContaining({ id: 'remote-access-status', label: 'Status: Off', enabled: false }),
        expect.objectContaining({ id: 'remote-access-start', enabled: true }),
        expect.objectContaining({ id: 'remote-access-details', enabled: false }),
        expect.objectContaining({ id: 'remote-access-copy', enabled: false }),
        expect.objectContaining({ id: 'remote-access-stop', enabled: false }),
      ]))
      const start = items.find(item => item.id === 'remote-access-start')
      if (typeof start?.click !== 'function') throw new Error('remote start command missing')
      expect(start.click).toBe(commands.start)
      commands.start()
      expect(commands.start).toHaveBeenCalledTimes(1)
    },
  )

  it('projects enabled and changing controller states without putting the URL in labels', () => {
    const url = 'http://192.168.1.5:43127/#dsh-access=secret-token'
    const enabled = remoteItems(createApplicationMenuTemplate(options({
      remoteAccess: remoteOptions({ state: { enabled: true, transitioning: false, url } }),
    })))
    expect(enabled.find(item => item.id === 'remote-access-status')).toMatchObject({ label: 'Status: On' })
    expect(enabled.find(item => item.id === 'remote-access-details')).toMatchObject({ enabled: true })
    expect(enabled.find(item => item.id === 'remote-access-copy')).toMatchObject({ enabled: true })
    expect(enabled.find(item => item.id === 'remote-access-stop')).toMatchObject({ enabled: true })
    expect(JSON.stringify(enabled)).not.toContain(url)

    const changing = remoteItems(createApplicationMenuTemplate(options({
      remoteAccess: remoteOptions({ state: { enabled: true, transitioning: true, url } }),
    })))
    expect(changing.find(item => item.id === 'remote-access-status')).toMatchObject({
      label: 'Status: Changing...',
    })
    expect(changing.filter(item => item.id?.startsWith('remote-access-') && item.enabled === true))
      .toEqual([])
  })

  it('refreshes installed remote items without rebuilding the update menu', () => {
    const items = new Map<string, { enabled: boolean; label: string }>([
      ['remote-access-status', { enabled: false, label: 'Status: Off' }],
      ['remote-access-start', { enabled: true, label: 'Start Remote Access...' }],
      ['remote-access-details', { enabled: false, label: 'Show Connection Details...' }],
      ['remote-access-copy', { enabled: false, label: 'Copy Connection URL' }],
      ['remote-access-stop', { enabled: false, label: 'Stop Remote Access...' }],
    ])
    refreshRemoteAccessMenu({
      getMenuItemById: (id) => {
        return (items.get(id) ?? null) as never
      },
    }, {
      enabled: true,
      transitioning: false,
      url: 'http://192.168.1.5:43127/#dsh-access=secret-token',
    })

    expect(items.get('remote-access-status')?.label).toBe('Status: On')
    expect(items.get('remote-access-start')?.enabled).toBe(false)
    expect(items.get('remote-access-details')?.enabled).toBe(true)
    expect(items.get('remote-access-copy')?.enabled).toBe(true)
    expect(items.get('remote-access-stop')?.enabled).toBe(true)
  })

  it('fails loud when an installed remote menu item is missing', () => {
    expect(() => {
      refreshRemoteAccessMenu({ getMenuItemById: () => null }, {
        enabled: false,
        transitioning: false,
      })
    }).toThrow('remote-access-status')
  })

  it.each([
    [{ status: 'disabled' } as const, 'Updates are available only in an installed application.'],
    [{ status: 'unsupported' } as const, 'Automatic updates are not available on this platform.'],
    [{ status: 'no-release' } as const, 'No update is currently published.'],
    [{ status: 'current' } as const, 'DeepSeek Harness 0.1.0 is up to date.'],
    [{ status: 'ready', version: '0.2.0' } as const, 'DeepSeek Harness 0.2.0 is ready to install.'],
    [{ status: 'failed', detail: 'network unavailable' } as const, 'The update check failed.'],
  ])('presents the %s result and restores the menu item', async (result, message) => {
    const showMessageBox = vi.fn().mockResolvedValue({ checkboxChecked: false, response: 0 })
    const item = { enabled: true, label: 'Check for Updates...' }
    const operation = runManualUpdateCheck(item, options({
      checkForUpdates: vi.fn().mockResolvedValue(result),
      showMessageBox,
    }))

    expect(item).toEqual({ enabled: false, label: 'Checking for Updates...' })
    await operation
    expect(showMessageBox).toHaveBeenCalledWith(expect.objectContaining({ message }))
    expect(item).toEqual({ enabled: true, label: 'Check for Updates...' })
  })

  it('ignores re-entry while the native command is disabled', async () => {
    const checkForUpdates = vi.fn()
    await runManualUpdateCheck(
      { enabled: false, label: 'Checking for Updates...' },
      options({ checkForUpdates }),
    )
    expect(checkForUpdates).not.toHaveBeenCalled()
  })
})

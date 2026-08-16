// @vitest-environment jsdom

import { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { SlotRegistry } from '@deepseek-ai/dsh-client-runtime/client'
import { resolveSlotLabel } from '@deepseek-ai/dsh-client-ui-slots'
import type { ElectronDesktopBridge, ElectronDesktopState } from '../src/bridge-contract.ts'
import type { DesktopControlInjected } from '../src/client/contract.ts'
import { apply, inject } from '../src/client/index.ts'
import { RemoteAccessSection } from '../src/client/RemoteAccessSection.tsx'
import { SoftwareInfoItem } from '../src/client/SoftwareInfoItem.tsx'
import { UpdateBadge } from '../src/client/UpdateBadge.tsx'

afterEach(() => {
  delete window.dshElectron
})

function state(): ElectronDesktopState {
  return {
    currentVersion: '0.1.0',
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
  }
}

function bridge(overrides: Partial<ElectronDesktopBridge> = {}): ElectronDesktopBridge {
  return {
    getDesktopState: vi.fn(() => Promise.resolve(state())),
    setRemoteAccessEnabled: vi.fn(() => Promise.resolve(true)),
    saveRemoteAccessConfiguration: vi.fn(() => Promise.resolve(state())),
    selectRemoteAccessFile: vi.fn(() => Promise.resolve('/usr/local/bin/frpc')),
    copyRemoteAccessUrl: vi.fn(() => Promise.resolve(true)),
    checkForUpdates: vi.fn(() => Promise.resolve(state())),
    installUpdate: vi.fn(() => Promise.resolve(true)),
    ...overrides,
  }
}

async function bench() {
  const ctx = new Context()
  await ctx.plugin(SlotRegistry).await()
  const slots = ctx.get('slots') as SlotRegistry
  const locale = new LocaleRuntime(ctx)
  ctx.provide('locale', locale)
  slots.register({
    name: 'root',
    children: {
      'settings.section': { kind: 'list', scope: 'root' },
      'settings.general.item': { kind: 'list', scope: 'root' },
      'sidebar.brand.badge': { kind: 'list', scope: 'root' },
    },
  } as never, () => null)
  return { ctx, locale, slots }
}

describe('desktop Electron browser plugin', () => {
  it('declares only the services used for its slot contributions', () => {
    expect(inject).toEqual(['slots', 'locale'])
  })

  it('does nothing when the Electron preload is absent', () => {
    expect(() => { apply({} as never) }).not.toThrow()
  })

  it('registers all seats, delegates every command, and tears down cleanly', async () => {
    const b = await bench()
    const setRemoteAccessEnabled = vi.fn(() => Promise.resolve(true))
    const saveRemoteAccessConfiguration = vi.fn(() => Promise.resolve(state()))
    const copyRemoteAccessUrl = vi.fn(() => Promise.resolve(true))
    const selectRemoteAccessFile = vi.fn(() => Promise.resolve('/usr/local/bin/frpc'))
    const checkForUpdates = vi.fn(() => Promise.resolve(state()))
    const installUpdate = vi.fn(() => Promise.resolve(true))
    const desktopBridge = bridge({
      setRemoteAccessEnabled,
      saveRemoteAccessConfiguration,
      selectRemoteAccessFile,
      copyRemoteAccessUrl,
      checkForUpdates,
      installUpdate,
    })
    window.dshElectron = desktopBridge
    const fiber = b.ctx.plugin({ inject: [...inject], apply })
    await fiber.await()

    const section = b.slots.entries('settings.section')[0]!
    const software = b.slots.entries('settings.general.item')[0]!
    const badge = b.slots.entries('sidebar.brand.badge')[0]!
    expect(section.component).toBe(RemoteAccessSection)
    expect(section.options).toMatchObject({ id: 'remote-access', order: 30 })
    expect(software.component).toBe(SoftwareInfoItem)
    expect(software.options).toMatchObject({ id: 'software-information', order: 100 })
    expect(badge.component).toBe(UpdateBadge)
    expect(badge.options).toMatchObject({ id: 'desktop-update', order: 0 })
    expect(section.locale).toBe('desktop.electron')
    expect(software.locale).toBe('desktop.electron')
    expect(badge.locale).toBe('desktop.electron')

    b.locale.setLocale('en')
    expect(resolveSlotLabel(section.options.label)).toBe('Remote Access')
    const controls = (section.inject as unknown as () => DesktopControlInjected)()
    await vi.waitFor(() => {
      expect(controls.hooks.desktopControl.getSnapshot().phase).toBe('ready')
    })
    const listener = vi.fn()
    const unsubscribe = controls.hooks.desktopControl.subscribe(listener)

    await expect(controls.setRemoteAccessEnabled(true)).resolves.toBe(true)
    await controls.saveRemoteAccessConfiguration({
      mode: 'frp',
      frp: {
        serverAddress: '203.0.113.8',
        serverPort: 7_000,
        remotePort: 0,
        publicOrigin: '',
        executablePath: 'frpc',
        tlsTrustedCaFile: '/etc/frp/ca.crt',
        tlsServerName: '',
        allowInsecureHttp: true,
        authToken: { action: 'keep' },
      },
    })
    await expect(controls.copyRemoteAccessUrl()).resolves.toBe(true)
    await expect(controls.selectRemoteAccessFile('frpc-executable'))
      .resolves.toBe('/usr/local/bin/frpc')
    await expect(controls.checkForUpdates()).resolves.toBeUndefined()
    await expect(controls.installUpdate()).resolves.toBe(true)
    expect(listener).toHaveBeenCalled()
    unsubscribe()

    expect(setRemoteAccessEnabled).toHaveBeenCalledWith(true)
    expect(saveRemoteAccessConfiguration).toHaveBeenCalledOnce()
    expect(copyRemoteAccessUrl).toHaveBeenCalledOnce()
    expect(checkForUpdates).toHaveBeenCalledOnce()
    expect(installUpdate).toHaveBeenCalledOnce()

    await fiber.dispose()
    expect(b.slots.entries('settings.section')).toEqual([])
    expect(b.slots.entries('settings.general.item')).toEqual([])
    expect(b.slots.entries('sidebar.brand.badge')).toEqual([])
    expect(() => b.locale.register('desktop.electron', 'zh', {})).not.toThrow()
    expect(() => b.locale.register('desktop.electron', 'en', {})).not.toThrow()
  })
})

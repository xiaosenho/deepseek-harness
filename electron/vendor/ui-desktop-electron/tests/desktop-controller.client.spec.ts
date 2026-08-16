// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest'
import type {
  ElectronDesktopBridge,
  ElectronDesktopState,
  ElectronRemoteAccessConfigurationInput,
} from '../src/bridge-contract.ts'
import {
  DesktopControlController,
  parseElectronDesktopState,
  resolveElectronDesktopBridge,
} from '../src/client/desktop-controller.ts'

afterEach(() => {
  vi.useRealTimers()
})

const FRP_INPUT: ElectronRemoteAccessConfigurationInput = {
  mode: 'frp',
  frp: {
    serverAddress: 'frps.example.com',
    serverPort: 7_000,
    remotePort: 7_400,
    publicOrigin: 'https://harness.example.com',
    executablePath: 'frpc',
    tlsTrustedCaFile: '/etc/frp/ca.crt',
    tlsServerName: '',
    allowInsecureHttp: false,
    authToken: { action: 'keep' },
  },
}

function state(overrides: Partial<ElectronDesktopState['remoteAccess']> = {}): ElectronDesktopState {
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
      ...overrides,
    },
    update: { status: 'current' },
  }
}

function bridge(overrides: Partial<ElectronDesktopBridge> = {}): ElectronDesktopBridge {
  return {
    getDesktopState: vi.fn(() => Promise.resolve(state())),
    setRemoteAccessEnabled: vi.fn(() => Promise.resolve(true)),
    saveRemoteAccessConfiguration: vi.fn(() => Promise.resolve(state({ preferredMode: 'frp' }))),
    selectRemoteAccessFile: vi.fn(() => Promise.resolve('/usr/local/bin/frpc')),
    copyRemoteAccessUrl: vi.fn(() => Promise.resolve(true)),
    checkForUpdates: vi.fn(() => Promise.resolve(state())),
    installUpdate: vi.fn(() => Promise.resolve(true)),
    ...overrides,
  }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((done, fail) => {
    resolve = done
    reject = fail
  })
  return { promise, reject, resolve }
}

describe('Electron desktop state wire validation', () => {
  it('accepts a redacted public endpoint and normalizes its origin URL', () => {
    const parsed = parseElectronDesktopState(state({
      activeMode: 'frp',
      enabled: true,
      preferredMode: 'frp',
      publicEndpoint: 'https://harness.example.com',
    }))

    expect(parsed.remoteAccess.publicEndpoint).toBe('https://harness.example.com/')
    expect(parsed.remoteAccess.frp.authTokenConfigured).toBe(false)
  })

  it.each([
    ['a query-bearing endpoint', (value: Record<string, unknown>) => {
      const remote = value['remoteAccess'] as Record<string, unknown>
      remote['activeMode'] = 'frp'
      remote['enabled'] = true
      remote['publicEndpoint'] = 'https://harness.example.com/?dsh-access=secret'
    }],
    ['an inconsistent active mode', (value: Record<string, unknown>) => {
      const remote = value['remoteAccess'] as Record<string, unknown>
      remote['enabled'] = true
    }],
    ['an out-of-range control port', (value: Record<string, unknown>) => {
      const remote = value['remoteAccess'] as Record<string, unknown>
      const frp = remote['frp'] as Record<string, unknown>
      frp['serverPort'] = 0
    }],
    ['an undeclared secret field', (value: Record<string, unknown>) => {
      const remote = value['remoteAccess'] as Record<string, unknown>
      const frp = remote['frp'] as Record<string, unknown>
      frp['authToken'] = 'must-not-cross-ipc'
    }],
    ['fields from another update variant', (value: Record<string, unknown>) => {
      value['update'] = { status: 'current', detail: 'must not be accepted' }
    }],
  ] as const)('rejects %s', (_label, mutate) => {
    const value = structuredClone(state()) as unknown as Record<string, unknown>
    mutate(value)

    expect(() => parseElectronDesktopState(value)).toThrow()
  })

  it('requires the complete preload API before activating desktop controls', () => {
    const complete = bridge()
    expect(resolveElectronDesktopBridge(complete)).toBe(complete)
    const partial = { ...complete, saveRemoteAccessConfiguration: undefined }
    expect(resolveElectronDesktopBridge(partial)).toBeUndefined()
  })
})

describe('DesktopControlController', () => {
  it('publishes failed when the initial IPC state is invalid', async () => {
    const invalid = structuredClone(state()) as unknown as Record<string, unknown>
    const remote = invalid['remoteAccess'] as Record<string, unknown>
    remote['publicEndpoint'] = 'https://harness.example.com/#dsh-access=secret'
    const controller = new DesktopControlController(bridge({
      getDesktopState: vi.fn(() => Promise.resolve(invalid as unknown as ElectronDesktopState)),
    }))

    await controller.start()

    expect(controller.getSnapshot()).toEqual({ phase: 'failed' })
    controller.dispose()
  })

  it('serializes configuration saves before exposure changes', async () => {
    const saving = deferred<ElectronDesktopState>()
    const saved = state({ preferredMode: 'frp' })
    const active = state({
      activeMode: 'frp',
      enabled: true,
      preferredMode: 'frp',
      publicEndpoint: 'https://harness.example.com/',
    })
    const saveRemoteAccessConfiguration = vi.fn(() => saving.promise)
    const setRemoteAccessEnabled = vi.fn(() => Promise.resolve(true))
    const getDesktopState = vi.fn(() => Promise.resolve(active))
    const controller = new DesktopControlController(bridge({
      getDesktopState,
      saveRemoteAccessConfiguration,
      setRemoteAccessEnabled,
    }))

    const saveTask = controller.saveRemoteAccessConfiguration(FRP_INPUT)
    const enableTask = controller.setRemoteAccessEnabled(true)
    await Promise.resolve()

    expect(saveRemoteAccessConfiguration).toHaveBeenCalledOnce()
    expect(setRemoteAccessEnabled).not.toHaveBeenCalled()

    saving.resolve(saved)
    await saveTask
    expect(setRemoteAccessEnabled).toHaveBeenCalledWith(true)
    await expect(enableTask).resolves.toBe(true)
    expect(controller.getSnapshot()).toEqual({ phase: 'ready', value: active })
    controller.dispose()
  })

  it('does not let an older read failure replace a newer command result', async () => {
    const initialRead = deferred<ElectronDesktopState>()
    const saved = state({ preferredMode: 'frp' })
    const controller = new DesktopControlController(bridge({
      getDesktopState: vi.fn(() => initialRead.promise),
      saveRemoteAccessConfiguration: vi.fn(() => Promise.resolve(saved)),
    }))

    const startTask = controller.start()
    await controller.saveRemoteAccessConfiguration(FRP_INPUT)
    initialRead.reject(new Error('stale read failed'))
    await startTask

    expect(controller.getSnapshot()).toEqual({ phase: 'ready', value: saved })
    controller.dispose()
  })
})

// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ElectronDesktopBridge, ElectronDesktopState } from '../src/bridge-contract.ts'
import {
  DesktopControlController,
  parseElectronDesktopState,
  resolveElectronDesktopBridge,
} from '../src/client/desktop-controller.ts'

afterEach(() => {
  vi.useRealTimers()
})

function state(
  remoteAccess: Partial<ElectronDesktopState['remoteAccess']> = {},
  update: ElectronDesktopState['update'] = { status: 'current' },
): ElectronDesktopState {
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
      ...remoteAccess,
    },
    update,
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

function invalid(mutate: (value: Record<string, unknown>) => void): void {
  const value = structuredClone(state()) as unknown as Record<string, unknown>
  mutate(value)
  expect(() => parseElectronDesktopState(value)).toThrow()
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => { resolve = done })
  return { promise, resolve }
}

describe('Electron desktop IPC parser defensive cases', () => {
  it.each([undefined, null, []])('rejects a non-record root: %j', (value) => {
    expect(() => parseElectronDesktopState(value)).toThrow('Electron desktop state is invalid')
  })

  it.each([
    ['an extra root field', (value: Record<string, unknown>) => { value['secret'] = true }],
    ['a non-string version', (value: Record<string, unknown>) => { value['currentVersion'] = 1 }],
    ['a non-record remote state', (value: Record<string, unknown>) => { value['remoteAccess'] = null }],
    ['an extra remote field', (value: Record<string, unknown>) => {
      (value['remoteAccess'] as Record<string, unknown>)['secret'] = true
    }],
    ['a non-boolean enabled flag', (value: Record<string, unknown>) => {
      (value['remoteAccess'] as Record<string, unknown>)['enabled'] = 'yes'
    }],
    ['a non-boolean transition flag', (value: Record<string, unknown>) => {
      (value['remoteAccess'] as Record<string, unknown>)['transitioning'] = 'yes'
    }],
    ['an unknown preferred mode', (value: Record<string, unknown>) => {
      (value['remoteAccess'] as Record<string, unknown>)['preferredMode'] = 'public'
    }],
    ['an unknown active mode', (value: Record<string, unknown>) => {
      (value['remoteAccess'] as Record<string, unknown>)['activeMode'] = 'public'
    }],
    ['an active mode while disabled', (value: Record<string, unknown>) => {
      (value['remoteAccess'] as Record<string, unknown>)['activeMode'] = 'lan'
    }],
    ['a public endpoint while disabled', (value: Record<string, unknown>) => {
      (value['remoteAccess'] as Record<string, unknown>)['publicEndpoint'] = 'http://203.0.113.8:7400'
    }],
    ['a non-record FRP state', (value: Record<string, unknown>) => {
      (value['remoteAccess'] as Record<string, unknown>)['frp'] = null
    }],
    ['an extra FRP field', (value: Record<string, unknown>) => {
      const remote = value['remoteAccess'] as Record<string, unknown>
      (remote['frp'] as Record<string, unknown>)['authToken'] = 'secret'
    }],
    ['a non-boolean token flag', (value: Record<string, unknown>) => {
      const remote = value['remoteAccess'] as Record<string, unknown>
      (remote['frp'] as Record<string, unknown>)['authTokenConfigured'] = 'yes'
    }],
    ['a non-boolean plaintext flag', (value: Record<string, unknown>) => {
      const remote = value['remoteAccess'] as Record<string, unknown>
      (remote['frp'] as Record<string, unknown>)['allowInsecureHttp'] = 'yes'
    }],
    ['a non-string FRP field', (value: Record<string, unknown>) => {
      const remote = value['remoteAccess'] as Record<string, unknown>
      (remote['frp'] as Record<string, unknown>)['serverAddress'] = 1
    }],
    ['a non-numeric port', (value: Record<string, unknown>) => {
      const remote = value['remoteAccess'] as Record<string, unknown>
      (remote['frp'] as Record<string, unknown>)['serverPort'] = '7000'
    }],
    ['a fractional port', (value: Record<string, unknown>) => {
      const remote = value['remoteAccess'] as Record<string, unknown>
      (remote['frp'] as Record<string, unknown>)['serverPort'] = 7_000.5
    }],
    ['a zero control port', (value: Record<string, unknown>) => {
      const remote = value['remoteAccess'] as Record<string, unknown>
      (remote['frp'] as Record<string, unknown>)['serverPort'] = 0
    }],
    ['a negative public port', (value: Record<string, unknown>) => {
      const remote = value['remoteAccess'] as Record<string, unknown>
      (remote['frp'] as Record<string, unknown>)['remotePort'] = -1
    }],
    ['a port above 65535', (value: Record<string, unknown>) => {
      const remote = value['remoteAccess'] as Record<string, unknown>
      (remote['frp'] as Record<string, unknown>)['serverPort'] = 65_536
    }],
    ['a non-record update', (value: Record<string, unknown>) => { value['update'] = null }],
    ['a non-string update status', (value: Record<string, unknown>) => { value['update'] = { status: 1 } }],
    ['an unknown update status', (value: Record<string, unknown>) => { value['update'] = { status: 'future' } }],
    ['an extra ready-update field', (value: Record<string, unknown>) => {
      value['update'] = { status: 'ready', version: '0.2.0', changelog: 'notes', detail: 'extra' }
    }],
    ['a non-string ready version', (value: Record<string, unknown>) => {
      value['update'] = { status: 'ready', version: 2, changelog: 'notes' }
    }],
    ['a non-string ready changelog', (value: Record<string, unknown>) => {
      value['update'] = { status: 'ready', version: '0.2.0', changelog: 2 }
    }],
    ['an extra failed-update field', (value: Record<string, unknown>) => {
      value['update'] = { status: 'failed', detail: 'offline', version: '0.2.0' }
    }],
    ['a non-string failure detail', (value: Record<string, unknown>) => {
      value['update'] = { status: 'failed', detail: 2 }
    }],
    ['an extra simple-update field', (value: Record<string, unknown>) => {
      value['update'] = { status: 'idle', detail: 'extra' }
    }],
  ] as const)('rejects %s', (_label, mutate) => { invalid(mutate) })

  it.each([
    42,
    'not a URL',
    'ftp://example.com',
    'http://example.com/path?query=yes',
    'http://example.com/path#fragment',
    'http://user@example.com',
    'http://:password@example.com',
  ])('rejects unsafe public endpoint %j', (endpoint) => {
    invalid((value) => {
      const remote = value['remoteAccess'] as Record<string, unknown>
      remote['enabled'] = true
      remote['activeMode'] = 'frp'
      remote['publicEndpoint'] = endpoint
    })
  })

  it('accepts both HTTP and HTTPS endpoints plus variant-specific update fields', () => {
    const ready = parseElectronDesktopState(state({
      enabled: true,
      activeMode: 'frp',
      preferredMode: 'frp',
      publicEndpoint: 'http://203.0.113.8:7400',
    }, { status: 'ready', version: '0.2.0', changelog: 'notes' }))
    expect(ready.remoteAccess.publicEndpoint).toBe('http://203.0.113.8:7400/')
    expect(ready.update).toEqual({ status: 'ready', version: '0.2.0', changelog: 'notes' })

    const failed = parseElectronDesktopState(state({
      enabled: true,
      activeMode: 'lan',
      publicEndpoint: 'https://harness.example.com',
    }, { status: 'failed', detail: 'offline' }))
    expect(failed.remoteAccess.publicEndpoint).toBe('https://harness.example.com/')
    expect(failed.update).toEqual({ status: 'failed', detail: 'offline' })
  })
})

describe('Electron preload bridge resolution', () => {
  it.each([undefined, null, 'bridge'])('ignores non-object bridge value %j', (value) => {
    expect(resolveElectronDesktopBridge(value)).toBeUndefined()
  })

  it('requires every method in the preload capability', () => {
    const complete = bridge()
    expect(resolveElectronDesktopBridge(complete)).toBe(complete)
    for (const key of [
      'getDesktopState',
      'setRemoteAccessEnabled',
      'saveRemoteAccessConfiguration',
      'copyRemoteAccessUrl',
      'checkForUpdates',
      'installUpdate',
    ] as const) {
      const candidate = { ...complete, [key]: undefined }
      expect(resolveElectronDesktopBridge(candidate)).toBeUndefined()
    }
  })
})

describe('DesktopControlController lifecycle tails', () => {
  it('notifies active subscribers and releases removed subscribers', async () => {
    const controller = new DesktopControlController(bridge())
    const active = vi.fn()
    const removed = vi.fn()
    controller.subscribe(active)
    const unsubscribe = controller.subscribe(removed)
    unsubscribe()

    await controller.start()

    expect(active).toHaveBeenCalledOnce()
    expect(removed).not.toHaveBeenCalled()
    controller.dispose()
  })

  it('suppresses a late read after disposal and leaves polling stopped', async () => {
    const pending = deferred<ElectronDesktopState>()
    const controller = new DesktopControlController(bridge({ getDesktopState: vi.fn(() => pending.promise) }))
    const start = controller.start()
    controller.dispose()
    pending.resolve(state({ enabled: true, activeMode: 'lan' }))
    await start

    expect(controller.getSnapshot()).toEqual({ phase: 'loading' })
  })

  it('does not let an older successful read replace a saved command result', async () => {
    const pending = deferred<ElectronDesktopState>()
    const saved = state({ preferredMode: 'frp' })
    const controller = new DesktopControlController(bridge({
      getDesktopState: vi.fn(() => pending.promise),
      saveRemoteAccessConfiguration: vi.fn(() => Promise.resolve(saved)),
    }))
    const start = controller.start()
    await controller.saveRemoteAccessConfiguration({
      mode: 'lan',
      frp: {
        ...saved.remoteAccess.frp,
        authToken: { action: 'keep' },
      },
    })
    pending.resolve(state())
    await start

    expect(controller.getSnapshot()).toEqual({ phase: 'ready', value: saved })
    controller.dispose()
  })

  it('continues the command queue after a rejected operation', async () => {
    const setRemoteAccessEnabled = vi.fn()
      .mockRejectedValueOnce(new Error('first failed'))
      .mockResolvedValueOnce(true)
    const controller = new DesktopControlController(bridge({ setRemoteAccessEnabled }))

    await expect(controller.setRemoteAccessEnabled(true)).rejects.toThrow('first failed')
    await expect(controller.setRemoteAccessEnabled(false)).resolves.toBe(true)
    expect(setRemoteAccessEnabled).toHaveBeenCalledTimes(2)
    controller.dispose()
  })

  it('delegates copy, update check, and installation', async () => {
    const copyRemoteAccessUrl = vi.fn(() => Promise.resolve(true))
    const checkForUpdates = vi.fn(() => Promise.resolve(state()))
    const installUpdate = vi.fn(() => Promise.resolve(true))
    const desktopBridge = bridge({ copyRemoteAccessUrl, checkForUpdates, installUpdate })
    const controller = new DesktopControlController(desktopBridge)

    await expect(controller.copyRemoteAccessUrl()).resolves.toBe(true)
    await expect(controller.checkForUpdates()).resolves.toBeUndefined()
    await expect(controller.installUpdate()).resolves.toBe(true)
    expect(copyRemoteAccessUrl).toHaveBeenCalledOnce()
    expect(checkForUpdates).toHaveBeenCalledOnce()
    expect(installUpdate).toHaveBeenCalledOnce()
    controller.dispose()
  })

  it('keeps a disposed controller inert while a save completes', async () => {
    const controller = new DesktopControlController(bridge())
    controller.dispose()

    await controller.saveRemoteAccessConfiguration({
      mode: 'lan',
      frp: {
        ...state().remoteAccess.frp,
        authToken: { action: 'keep' },
      },
    })

    expect(controller.getSnapshot()).toEqual({ phase: 'loading' })
  })

  it.each([
    ['enabled access', state({ enabled: true, activeMode: 'lan' })],
    ['a remote transition', state({ transitioning: true })],
    ['an update check', state({}, { status: 'checking' })],
  ])('polls while %s and stops when the state settles', async (_label, active) => {
    vi.useFakeTimers()
    const getDesktopState = vi.fn()
      .mockResolvedValueOnce(active)
      .mockResolvedValueOnce(state())
    const controller = new DesktopControlController(bridge({ getDesktopState }))

    await controller.start()
    expect(getDesktopState).toHaveBeenCalledOnce()
    await vi.advanceTimersByTimeAsync(1_000)
    expect(getDesktopState).toHaveBeenCalledTimes(2)
    expect(controller.getSnapshot()).toEqual({ phase: 'ready', value: state() })
    await vi.advanceTimersByTimeAsync(1_000)
    expect(getDesktopState).toHaveBeenCalledTimes(2)
    controller.dispose()
  })
})

import type { IpcMainInvokeEvent, WebContents } from 'electron/main'
import { describe, expect, it, vi } from 'vitest'
import {
  DESKTOP_BRIDGE_CHANNELS,
  installDesktopBridge,
  type DesktopBridgeOperations,
} from '../src/desktop-bridge.ts'

type Handler = (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown

function fixture() {
  const handlers = new Map<string, Handler>()
  const removed: string[] = []
  const frame = { url: 'http://127.0.0.1:43127/settings' }
  const contents = { mainFrame: frame } as unknown as WebContents
  const state = {
    currentVersion: '0.1.0',
    remoteAccess: {
      enabled: false,
      preferredMode: 'lan' as const,
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
    update: { status: 'idle' as const },
  }
  const operations: DesktopBridgeOperations = {
    webContents: () => contents,
    applicationUrl: () => new URL('http://127.0.0.1:43127/'),
    getState: vi.fn(() => state),
    setRemoteAccessEnabled: vi.fn(async () => true),
    saveRemoteAccessConfiguration: vi.fn(async () => state),
    selectRemoteAccessFile: vi.fn(async () => '/opt/homebrew/bin/frpc'),
    copyRemoteAccessUrl: vi.fn(async () => true),
    checkForUpdates: vi.fn(async () => state),
    installUpdate: vi.fn(async () => true),
  }
  const dispose = installDesktopBridge({
    handle: (channel, handler) => { handlers.set(channel, handler as Handler) },
    removeHandler: (channel) => { removed.push(channel); handlers.delete(channel) },
  }, operations)
  const event = { sender: contents, senderFrame: frame } as unknown as IpcMainInvokeEvent
  return { contents, dispose, event, frame, handlers, operations, removed, state }
}

describe('Electron desktop bridge', () => {
  it('installs every operation and removes the exact channel set', async () => {
    const { dispose, event, handlers, operations, removed, state } = fixture()

    expect(handlers.get(DESKTOP_BRIDGE_CHANNELS.state)?.(event)).toEqual(state)
    await expect(handlers.get(DESKTOP_BRIDGE_CHANNELS.remoteAccess)?.(event, true)).resolves.toBe(true)
    const configuration = { mode: 'lan', frp: {} }
    await expect(handlers.get(DESKTOP_BRIDGE_CHANNELS.remoteAccessConfiguration)?.(event, configuration))
      .resolves.toEqual(state)
    await expect(handlers.get(DESKTOP_BRIDGE_CHANNELS.remoteAccessFile)?.(event, 'frpc-executable'))
      .resolves.toBe('/opt/homebrew/bin/frpc')
    await expect(handlers.get(DESKTOP_BRIDGE_CHANNELS.copyRemoteAccess)?.(event)).resolves.toBe(true)
    await expect(handlers.get(DESKTOP_BRIDGE_CHANNELS.checkUpdates)?.(event)).resolves.toEqual(state)
    await expect(handlers.get(DESKTOP_BRIDGE_CHANNELS.installUpdate)?.(event)).resolves.toBe(true)
    expect(operations.saveRemoteAccessConfiguration).toHaveBeenCalledWith(configuration)
    expect(operations.selectRemoteAccessFile).toHaveBeenCalledWith('frpc-executable')

    dispose()
    expect(new Set(removed)).toEqual(new Set(Object.values(DESKTOP_BRIDGE_CHANNELS)))
    expect(handlers.size).toBe(0)
  })

  it('rejects malformed commands before calling main-process operations', () => {
    const { event, handlers, operations } = fixture()
    expect(() => handlers.get(DESKTOP_BRIDGE_CHANNELS.remoteAccess)?.(event, 'yes'))
      .toThrow('must be boolean')
    expect(operations.setRemoteAccessEnabled).not.toHaveBeenCalled()
    expect(() => handlers.get(DESKTOP_BRIDGE_CHANNELS.remoteAccessFile)?.(event, 'directory'))
      .toThrow('file kind is invalid')
    expect(operations.selectRemoteAccessFile).not.toHaveBeenCalled()
  })

  it.each([
    ['foreign sender', (current: ReturnType<typeof fixture>) => ({
      sender: {} as WebContents,
      senderFrame: current.frame,
    })],
    ['subframe', (current: ReturnType<typeof fixture>) => ({
      sender: current.contents,
      senderFrame: { url: current.frame.url },
    })],
    ['foreign origin', (current: ReturnType<typeof fixture>) => ({
      sender: current.contents,
      senderFrame: Object.assign(current.frame, { url: 'https://attacker.example/' }),
    })],
    ['missing frame', (current: ReturnType<typeof fixture>) => ({
      sender: current.contents,
      senderFrame: null,
    })],
  ])('rejects a request from a %s', (_label, createEvent) => {
    const current = fixture()
    const event = createEvent(current) as unknown as IpcMainInvokeEvent
    expect(() => current.handlers.get(DESKTOP_BRIDGE_CHANNELS.state)?.(event))
      .toThrow('not authorized')
    expect(current.operations.getState).not.toHaveBeenCalled()
  })
})

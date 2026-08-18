import type { ChildProcess, SpawnOptions } from 'node:child_process'
import { EventEmitter } from 'node:events'
import { basename } from 'node:path'
import { PassThrough } from 'node:stream'
import { electronDirectoryPickerRequestId } from '@deepseek-ai/dsh-host-directory-picker-electron/protocol'
import { afterEach, describe, expect, it, vi } from 'vitest'

interface SpawnCall {
  args: string[]
  command: string
  options: SpawnOptions
}

const processMocks = vi.hoisted(() => ({
  calls: [] as SpawnCall[],
  children: [] as ChildProcess[],
}))

vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>()
  return {
    ...actual,
    spawn: (command: string, args: string[], options: SpawnOptions) => {
      processMocks.calls.push({ args, command, options })
      const child = processMocks.children.shift()
      if (child === undefined) throw new Error('missing fake Electron backend child')
      return child
    },
  }
})

import { buildBackendArgs, createRemoteAccessToken, WebBackend } from '../src/backend.ts'

class FakeBackendChild extends EventEmitter {
  readonly pid = 2_000_000
  readonly stdout = new PassThrough()
  readonly stderr = new PassThrough()
  connected = true
  exitCode: number | null = null
  signalCode: NodeJS.Signals | null = null

  send(_message: unknown, callback?: (error: Error | null) => void): boolean {
    callback?.(null)
    return true
  }
}

function asChild(child: FakeBackendChild): ChildProcess {
  return child as unknown as ChildProcess
}

function finish(child: FakeBackendChild): void {
  child.connected = false
  child.exitCode = 0
  child.emit('exit', 0, null)
}

afterEach(() => {
  processMocks.calls.length = 0
  processMocks.children.length = 0
})

describe('buildBackendArgs', () => {
  it('places the loopback network policy after the Electron picker overlay', () => {
    const args = buildBackendArgs('win32', 'loopback', 'dsh.js')

    expect(args).toEqual([
      '--expose-internals', 'dsh.js', 'web',
      '--patch', expect.stringContaining('electron-directory-picker.cordis.patch.yml'),
      '--patch', expect.stringContaining('loopback-access.cordis.patch.yml'),
      '--patch', expect.stringContaining('desktop-ui.cordis.patch.yml'),
      '--port', '0',
    ])
    expect(basename(args[4] ?? '')).toBe('electron-directory-picker.cordis.patch.yml')
    expect(basename(args[6] ?? '')).toBe('loopback-access.cordis.patch.yml')
  })

  it('selects one final network overlay for every supported mode', () => {
    expect(buildBackendArgs('darwin', 'loopback', 'dsh.js')).toEqual([
      '--expose-internals', 'dsh.js', 'web',
      '--patch', expect.stringContaining('electron-directory-picker.cordis.patch.yml'),
      '--patch', expect.stringContaining('loopback-access.cordis.patch.yml'),
      '--patch', expect.stringContaining('desktop-ui.cordis.patch.yml'),
      '--port', '0',
    ])
    expect(buildBackendArgs('linux', 'lan', 'dsh.js')).toEqual([
      '--expose-internals', 'dsh.js', 'web',
      '--patch', expect.stringContaining('electron-directory-picker.cordis.patch.yml'),
      '--patch', expect.stringContaining('lan-access.cordis.patch.yml'),
      '--patch', expect.stringContaining('desktop-ui.cordis.patch.yml'),
      '--port', '0',
    ])
    expect(buildBackendArgs('darwin', 'frp', 'dsh.js')).toEqual([
      '--expose-internals', 'dsh.js', 'web',
      '--patch', expect.stringContaining('electron-directory-picker.cordis.patch.yml'),
      '--patch', expect.stringContaining('reverse-access.cordis.patch.yml'),
      '--patch', expect.stringContaining('desktop-ui.cordis.patch.yml'),
      '--port', '0',
    ])
  })

  it('generates one 12-character base64url token per launch', () => {
    expect(createRemoteAccessToken()).toMatch(/^[A-Za-z0-9_-]{12}$/)
  })
})

describe('WebBackend exposure', () => {
  it('starts loopback without a token or remote URL', async () => {
    const inheritedToken = process.env.DSH_ELECTRON_REMOTE_ACCESS_TOKEN
    const inheritedLoopbackToken = process.env.DSH_ELECTRON_LOOPBACK_ACCESS_TOKEN
    process.env.DSH_ELECTRON_REMOTE_ACCESS_TOKEN = 'inherited-secret'
    process.env.DSH_ELECTRON_LOOPBACK_ACCESS_TOKEN = 'inherited-local-secret'
    try {
      const child = new FakeBackendChild()
      processMocks.children.push(asChild(child))
      const started = new WebBackend({ linkPlugins: () => {} }).start('loopback', '/work', () => {}, async () => null)
      child.stdout.write('dsh web: http://127.0.0.1:43127 (LAN: http://192.168.1.5:43127)\n')

      await expect(started).resolves.toEqual({
        loopbackUrl: new URL('http://127.0.0.1:43127/'),
      })
      expect(processMocks.calls[0]?.options.env?.DSH_ELECTRON_REMOTE_ACCESS_TOKEN).toBeUndefined()
      expect(processMocks.calls[0]?.options.env?.DSH_ELECTRON_LOOPBACK_ACCESS_TOKEN).toBeUndefined()
      finish(child)
    } finally {
      if (inheritedToken === undefined) delete process.env.DSH_ELECTRON_REMOTE_ACCESS_TOKEN
      else process.env.DSH_ELECTRON_REMOTE_ACCESS_TOKEN = inheritedToken
      if (inheritedLoopbackToken === undefined) delete process.env.DSH_ELECTRON_LOOPBACK_ACCESS_TOKEN
      else process.env.DSH_ELECTRON_LOOPBACK_ACCESS_TOKEN = inheritedLoopbackToken
    }
  })

  it('creates a token-bearing URL only for LAN mode', async () => {
    const child = new FakeBackendChild()
    processMocks.children.push(asChild(child))
    const started = new WebBackend({ linkPlugins: () => {} }).start('lan', '/work', () => {}, async () => null)
    child.stdout.write('dsh web: http://127.0.0.1:43127 (LAN: http://192.168.1.5:43127)\n')

    const location = await started
    const token = processMocks.calls[0]?.options.env?.DSH_ELECTRON_REMOTE_ACCESS_TOKEN
    expect(token).toMatch(/^[A-Za-z0-9_-]{12}$/)
    expect(location.remoteAccessUrl?.href)
      .toBe(`http://192.168.1.5:43127/#dsh-access=${String(token)}`)
    expect(location.rendererAccessToken).toBeUndefined()
    expect(processMocks.calls[0]?.options.env?.DSH_ELECTRON_LOOPBACK_ACCESS_TOKEN).toBeUndefined()
    finish(child)
  })

  it('keeps FRP on loopback and returns its bearer only to Electron main', async () => {
    const inheritedAuthority = process.env.DSH_ELECTRON_REMOTE_ACCESS_AUTHORITY
    process.env.DSH_ELECTRON_REMOTE_ACCESS_AUTHORITY = 'inherited.example'
    try {
      const child = new FakeBackendChild()
      processMocks.children.push(asChild(child))
      const started = new WebBackend({ linkPlugins: () => {} }).start(
        'frp',
        '/work',
        () => {},
        async () => null,
        'harness.example:8443',
      )
      child.stdout.write('dsh web: http://127.0.0.1:43127\n')

      const location = await started
      expect(location.loopbackUrl.href).toBe('http://127.0.0.1:43127/')
      expect(location.remoteAccessUrl).toBeUndefined()
      expect(location.remoteAccessToken).toMatch(/^[A-Za-z0-9_-]{12}$/)
      expect(location.rendererAccessToken).toMatch(/^[A-Za-z0-9_-]{12}$/)
      expect(location.rendererAccessToken).not.toBe(location.remoteAccessToken)
      expect(processMocks.calls[0]?.options.env?.DSH_ELECTRON_REMOTE_ACCESS_AUTHORITY)
        .toBe('harness.example:8443')
      expect(processMocks.calls[0]?.options.env?.DSH_ELECTRON_REMOTE_ACCESS_TOKEN)
        .toBe(location.remoteAccessToken)
      expect(processMocks.calls[0]?.options.env?.DSH_ELECTRON_LOOPBACK_ACCESS_TOKEN)
        .toBe(location.rendererAccessToken)
      finish(child)
    } finally {
      if (inheritedAuthority === undefined) delete process.env.DSH_ELECTRON_REMOTE_ACCESS_AUTHORITY
      else process.env.DSH_ELECTRON_REMOTE_ACCESS_AUTHORITY = inheritedAuthority
    }
  })

  it('rejects FRP before spawning when no public authority was validated', async () => {
    await expect(new WebBackend({ linkPlugins: () => {} }).start('frp', '/work', () => {}, async () => null))
      .rejects.toThrow('trusted public authority')
    expect(processMocks.calls).toEqual([])
  })
})

describe('WebBackend directory-picker shutdown', () => {
  it('joins the picker and process tree once before reporting an unexpected ready exit', async () => {
    const child = new FakeBackendChild()
    processMocks.children.push(asChild(child))
    const treeCleanup = Promise.withResolvers<undefined>()
    const events: string[] = []
    const stopTree = vi.fn(async () => {
      events.push('tree-stop-started')
      await treeCleanup.promise
      events.push('tree-stop-finished')
    })
    const onUnexpectedExit = vi.fn(() => { events.push('reported') })
    const backend = new WebBackend({ stopTree, linkPlugins: () => {} })
    let pickerSignal: AbortSignal | undefined
    let finishPicker: (() => void) | undefined
    const started = backend.start('loopback', '/work', onUnexpectedExit, signal => new Promise((resolve) => {
      pickerSignal = signal
      signal.addEventListener('abort', () => { events.push('picker-aborted') }, { once: true })
      finishPicker = () => {
        events.push('picker-finished')
        resolve(null)
      }
    }))
    child.stdout.write('dsh web: http://127.0.0.1:43127\n')
    await started

    child.emit('message', {
      type: 'dsh/electron-directory-picker/request',
      requestId: electronDirectoryPickerRequestId('active-picker'),
    })
    await vi.waitFor(() => { expect(pickerSignal).toBeDefined() })
    child.emit('error', new Error('child-process error before exit'))
    child.connected = false
    child.exitCode = 1
    child.emit('exit', 1, null)
    await vi.waitFor(() => { expect(pickerSignal?.aborted).toBe(true) })
    expect(stopTree).not.toHaveBeenCalled()
    expect(onUnexpectedExit).not.toHaveBeenCalled()

    const concurrentStop = backend.stop()
    finishPicker?.()
    await vi.waitFor(() => { expect(stopTree).toHaveBeenCalledOnce() })
    expect(stopTree).toHaveBeenCalledWith(asChild(child), 'WebUI')
    expect(onUnexpectedExit).not.toHaveBeenCalled()

    treeCleanup.resolve(undefined)
    await concurrentStop
    await vi.waitFor(() => { expect(onUnexpectedExit).toHaveBeenCalledOnce() })
    expect(onUnexpectedExit).toHaveBeenCalledWith(1, null)
    expect(events).toEqual([
      'picker-aborted',
      'picker-finished',
      'tree-stop-started',
      'tree-stop-finished',
      'reported',
    ])
    await expect(backend.stop()).resolves.toBeUndefined()
  })

  it('does not report an exit that races after an explicit stop request', async () => {
    const child = new FakeBackendChild()
    processMocks.children.push(asChild(child))
    const treeCleanup = Promise.withResolvers<undefined>()
    const stopTree = vi.fn(async () => { await treeCleanup.promise })
    const onUnexpectedExit = vi.fn()
    const backend = new WebBackend({ stopTree, linkPlugins: () => {} })
    const started = backend.start('loopback', '/work', onUnexpectedExit, async () => null)
    child.stdout.write('dsh web: http://127.0.0.1:43127\n')
    await started

    const firstStop = backend.stop()
    const secondStop = backend.stop()
    expect(secondStop).toBe(firstStop)
    child.connected = false
    child.exitCode = 0
    child.emit('exit', 0, null)
    treeCleanup.resolve(undefined)

    await firstStop
    expect(stopTree).toHaveBeenCalledOnce()
    expect(onUnexpectedExit).not.toHaveBeenCalled()
    await expect(backend.stop()).resolves.toBeUndefined()
  })

  it('reports an unexpected-exit cleanup failure and retains ownership for retry', async () => {
    const child = new FakeBackendChild()
    processMocks.children.push(asChild(child))
    let cleanupAttempts = 0
    const stopTree = vi.fn(async () => {
      cleanupAttempts += 1
      if (cleanupAttempts === 1) throw new Error('tree cleanup failed')
    })
    const reportError = vi.spyOn(console, 'error').mockImplementation(() => {})
    const onUnexpectedExit = vi.fn()
    const backend = new WebBackend({ stopTree, linkPlugins: () => {} })
    try {
      const started = backend.start('loopback', '/work', onUnexpectedExit, async () => null)
      child.stdout.write('dsh web: http://127.0.0.1:43127\n')
      await started

      child.exitCode = 1
      child.emit('exit', 1, null)

      await vi.waitFor(() => { expect(onUnexpectedExit).toHaveBeenCalledOnce() })
      expect(reportError).toHaveBeenCalledWith(
        'WebUI process-tree cleanup failed after an unexpected exit.',
        expect.objectContaining({ message: 'tree cleanup failed' }),
      )
      await expect(backend.start('loopback', '/work', () => {}, async () => null))
        .rejects.toThrow('already running')

      await expect(backend.stop()).resolves.toBeUndefined()
      expect(stopTree).toHaveBeenCalledTimes(2)
      await expect(backend.stop()).resolves.toBeUndefined()
    } finally {
      reportError.mockRestore()
    }
  })

  it('retries bounded process-tree cleanup after a failed stop attempt', async () => {
    const child = new FakeBackendChild()
    processMocks.children.push(asChild(child))
    const stopTree = vi.fn()
      .mockRejectedValueOnce(new Error('WebUI process tree did not stop after SIGKILL'))
      .mockResolvedValue(undefined)
    const backend = new WebBackend({ linkPlugins: () => {}, stopTree })
    const started = backend.start('lan', '/work', () => {}, async () => null)
    child.stdout.write('dsh web: http://127.0.0.1:43127 (LAN: http://192.168.1.5:43127)\n')
    await started

    const first = backend.stop()
    await expect(first).rejects.toThrow('did not stop after SIGKILL')

    const second = backend.stop()
    expect(second).not.toBe(first)
    await expect(second).resolves.toBeUndefined()
    await expect(backend.stop()).resolves.toBeUndefined()
    expect(stopTree).toHaveBeenCalledTimes(2)
  })
})

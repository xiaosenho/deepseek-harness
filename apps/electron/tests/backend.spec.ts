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
  it('places the loopback network policy after the Windows picker overlay', () => {
    const args = buildBackendArgs('win32', 'loopback', 'dsh.js')

    expect(args).toEqual([
      '--expose-internals', 'dsh.js', 'web',
      '--patch', expect.stringContaining('windows-directory-picker.cordis.patch.yml'),
      '--patch', expect.stringContaining('loopback-access.cordis.patch.yml'),
      '--port', '0',
    ])
    expect(basename(args[4] ?? '')).toBe('windows-directory-picker.cordis.patch.yml')
    expect(basename(args[6] ?? '')).toBe('loopback-access.cordis.patch.yml')
  })

  it('selects one final network overlay for every supported mode', () => {
    expect(buildBackendArgs('darwin', 'loopback', 'dsh.js')).toEqual([
      '--expose-internals', 'dsh.js', 'web',
      '--patch', expect.stringContaining('loopback-access.cordis.patch.yml'),
      '--port', '0',
    ])
    expect(buildBackendArgs('linux', 'lan', 'dsh.js')).toEqual([
      '--expose-internals', 'dsh.js', 'web',
      '--patch', expect.stringContaining('lan-access.cordis.patch.yml'),
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
    process.env.DSH_ELECTRON_REMOTE_ACCESS_TOKEN = 'inherited-secret'
    try {
      const child = new FakeBackendChild()
      processMocks.children.push(asChild(child))
      const started = new WebBackend().start('loopback', '/work', () => {}, async () => null)
      child.stdout.write('dsh web: http://127.0.0.1:43127 (LAN: http://192.168.1.5:43127)\n')

      await expect(started).resolves.toEqual({
        loopbackUrl: new URL('http://127.0.0.1:43127/'),
      })
      expect(processMocks.calls[0]?.options.env?.DSH_ELECTRON_REMOTE_ACCESS_TOKEN).toBeUndefined()
      finish(child)
    } finally {
      if (inheritedToken === undefined) delete process.env.DSH_ELECTRON_REMOTE_ACCESS_TOKEN
      else process.env.DSH_ELECTRON_REMOTE_ACCESS_TOKEN = inheritedToken
    }
  })

  it('creates a token-bearing URL only for LAN mode', async () => {
    const child = new FakeBackendChild()
    processMocks.children.push(asChild(child))
    const started = new WebBackend().start('lan', '/work', () => {}, async () => null)
    child.stdout.write('dsh web: http://127.0.0.1:43127 (LAN: http://192.168.1.5:43127)\n')

    const location = await started
    const token = processMocks.calls[0]?.options.env?.DSH_ELECTRON_REMOTE_ACCESS_TOKEN
    expect(token).toMatch(/^[A-Za-z0-9_-]{12}$/)
    expect(location.remoteAccessUrl?.href)
      .toBe(`http://192.168.1.5:43127/#dsh-access=${String(token)}`)
    finish(child)
  })
})

describe('WebBackend directory-picker shutdown', () => {
  it('retains and joins the picker bridge after the backend exits', async () => {
    const child = new FakeBackendChild()
    processMocks.children.push(asChild(child))
    const backend = new WebBackend()
    let pickerSignal: AbortSignal | undefined
    let finishPicker: (() => void) | undefined
    const started = backend.start('loopback', '/work', () => {}, signal => new Promise((resolve) => {
      pickerSignal = signal
      finishPicker = () => { resolve(null) }
    }))
    child.stdout.write('dsh web: http://127.0.0.1:43127\n')
    await started

    child.emit('message', {
      type: 'dsh/electron-directory-picker/request',
      requestId: electronDirectoryPickerRequestId('active-picker'),
    })
    await vi.waitFor(() => { expect(pickerSignal).toBeDefined() })
    child.connected = false
    child.exitCode = 1
    child.emit('exit', 1, null)
    await vi.waitFor(() => { expect(pickerSignal?.aborted).toBe(true) })

    let stopped = false
    const stopping = backend.stop().then(() => { stopped = true })
    await Promise.resolve()
    expect(stopped).toBe(false)
    finishPicker?.()
    await stopping
    expect(stopped).toBe(true)
  })

  it('retries bounded process-tree cleanup after a failed stop attempt', async () => {
    const child = new FakeBackendChild()
    processMocks.children.push(asChild(child))
    const backend = new WebBackend()
    const started = backend.start('lan', '/work', () => {}, async () => null)
    child.stdout.write('dsh web: http://127.0.0.1:43127 (LAN: http://192.168.1.5:43127)\n')
    await started

    let alive = true
    let clock = 0
    let forceAttempts = 0
    const now = vi.spyOn(Date, 'now').mockImplementation(() => {
      clock += 3_000
      return clock
    })
    const kill = vi.spyOn(process, 'kill').mockImplementation((_pid, signal) => {
      if (signal === 0) {
        if (alive) return true
        throw Object.assign(new Error('process group exited'), { code: 'ESRCH' })
      }
      if (signal === 'SIGKILL') {
        forceAttempts += 1
        if (forceAttempts === 2) alive = false
      }
      return true
    })
    try {
      const first = backend.stop()
      await expect(first).rejects.toThrow('did not stop after SIGKILL')

      const second = backend.stop()
      expect(second).not.toBe(first)
      await expect(second).resolves.toBeUndefined()
      await expect(backend.stop()).resolves.toBeUndefined()
      expect(forceAttempts).toBe(2)
    } finally {
      kill.mockRestore()
      now.mockRestore()
    }
  })
})

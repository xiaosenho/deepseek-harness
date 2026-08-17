import type { ChildProcess, SpawnOptions } from 'node:child_process'
import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
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

import { buildBackendArgs, WebBackend } from '../src/backend.ts'

class FakeBackendChild extends EventEmitter {
  readonly pid = 2_000_000
  readonly stdout = new PassThrough()
  readonly stderr = new PassThrough()
  connected = true
  exitCode: number | null = null
  signalCode: NodeJS.Signals | null = null
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
  it('runs dsh web on loopback with an OS-selected port', () => {
    expect(buildBackendArgs('dsh.js')).toEqual([
      '--expose-internals',
      'dsh.js',
      'web',
      '--host', '127.0.0.1',
      '--port', '0',
    ])
  })
})

describe('WebBackend', () => {
  it('starts loopback and returns the renderer URL', async () => {
    const child = new FakeBackendChild()
    processMocks.children.push(asChild(child))
    const started = new WebBackend().start('/work', () => {})
    child.stdout.write('dsh web: http://127.0.0.1:43127 (LAN: http://192.168.1.5:43127)\n')

    await expect(started).resolves.toEqual({
      loopbackUrl: new URL('http://127.0.0.1:43127/'),
    })
    expect(processMocks.calls[0]?.options.env?.ELECTRON_RUN_AS_NODE).toBe('1')
    finish(child)
  })

  it('joins stop attempts and retains ownership for retry', async () => {
    const child = new FakeBackendChild()
    processMocks.children.push(asChild(child))
    const treeCleanup = Promise.withResolvers<undefined>()
    const stopTree = vi.fn(async () => { await treeCleanup.promise })
    const backend = new WebBackend({ stopTree })
    const started = backend.start('/work', () => {})
    child.stdout.write('dsh web: http://127.0.0.1:43127\n')
    await started

    const firstStop = backend.stop()
    const secondStop = backend.stop()
    expect(secondStop).toBe(firstStop)
    finish(child)
    treeCleanup.resolve(undefined)

    await firstStop
    expect(stopTree).toHaveBeenCalledOnce()
    expect(stopTree).toHaveBeenCalledWith(asChild(child), 'WebUI')
    await expect(backend.stop()).resolves.toBeUndefined()
  })

  it('reports an unexpected exit after cleanup succeeds', async () => {
    const child = new FakeBackendChild()
    processMocks.children.push(asChild(child))
    const stopTree = vi.fn(async () => {})
    const onUnexpectedExit = vi.fn()
    const backend = new WebBackend({ stopTree })
    const started = backend.start('/work', onUnexpectedExit)
    child.stdout.write('dsh web: http://127.0.0.1:43127\n')
    await started

    child.exitCode = 1
    child.emit('exit', 1, null)

    await vi.waitFor(() => { expect(onUnexpectedExit).toHaveBeenCalledOnce() })
    expect(onUnexpectedExit).toHaveBeenCalledWith(1, null)
    expect(stopTree).toHaveBeenCalledOnce()
  })
})

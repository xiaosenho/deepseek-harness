import type { ChildProcess, SpawnSyncReturns } from 'node:child_process'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ spawnSync: vi.fn() }))

vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>()
  return { ...actual, spawnSync: mocks.spawnSync }
})

import { stopProcessTree } from '../src/process-tree.ts'

beforeEach(() => { mocks.spawnSync.mockReset() })

function child(exitCode: number | null): ChildProcess {
  return {
    pid: 42,
    exitCode,
    signalCode: null,
  } as unknown as ChildProcess
}

function taskkillResult(status: number | null, error?: Error): SpawnSyncReturns<Buffer> {
  return {
    ...error === undefined ? {} : { error },
    output: [null, Buffer.alloc(0), Buffer.alloc(0)],
    pid: 84,
    signal: null,
    status,
    stderr: Buffer.alloc(0),
    stdout: Buffer.alloc(0),
  }
}

describe('stopProcessTree on Windows', () => {
  it('accepts only a successful tree-wide taskkill result', async () => {
    mocks.spawnSync.mockReturnValue(taskkillResult(0))

    await expect(stopProcessTree(child(null), 'WebUI', 'win32')).resolves.toBeUndefined()

    expect(mocks.spawnSync).toHaveBeenCalledWith(
      'taskkill',
      ['/PID', '42', '/T', '/F'],
      { windowsHide: true },
    )
  })

  it('does not invoke taskkill after the leader exited', async () => {
    mocks.spawnSync.mockReturnValue(taskkillResult(0))

    await expect(stopProcessTree(child(1), 'WebUI', 'win32'))
      .rejects.toThrow('taskkill cannot verify a process tree after its leader has exited')
    expect(mocks.spawnSync).not.toHaveBeenCalled()
  })

  it('reports a nonzero taskkill result for a live leader', async () => {
    mocks.spawnSync.mockReturnValue(taskkillResult(128))

    await expect(stopProcessTree(child(null), 'WebUI', 'win32'))
      .rejects.toThrow('taskkill exited with status 128')
  })

  it('reports failure to start taskkill', async () => {
    mocks.spawnSync.mockReturnValue(taskkillResult(null, new Error('missing executable')))

    await expect(stopProcessTree(child(null), 'WebUI', 'win32'))
      .rejects.toThrow('taskkill could not start: missing executable')
  })
})

import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import type { ChildProcess, SpawnOptions } from 'node:child_process'
import { describe, expect, it, vi } from 'vitest'
import {
  DIRECTORY_PICKER_HELPER_ARGUMENT,
  encodeDirectoryPickerHelperOutcome,
  parseDirectoryPickerHelperOutcome,
  pickElectronDirectory,
  runDirectoryPickerHelper,
} from '../src/directory-picker-helper.ts'
import type { DirectoryPickerHelperOutcome } from '../src/directory-picker-helper.ts'

class FakeHelper extends EventEmitter {
  pid = 1234
  stdout = new PassThrough()
  stderr = new PassThrough()
  kill = vi.fn(() => true)
  unref = vi.fn()
}

function asChild(child: FakeHelper): ChildProcess {
  return child as unknown as ChildProcess
}

function launch(child: FakeHelper, calls: Array<{ command: string; args: readonly string[]; options: SpawnOptions }>) {
  return (command: string, args: readonly string[], options: SpawnOptions): ChildProcess => {
    calls.push({ command, args, options })
    return asChild(child)
  }
}

describe('Electron directory picker helper protocol', () => {
  it('round-trips exact outcomes and rejects malformed lines', () => {
    const outcomes: DirectoryPickerHelperOutcome[] = [
      { kind: 'picked', path: 'C:\\work' },
      { kind: 'cancelled' },
      { kind: 'failed', message: 'unavailable' },
    ]
    for (const outcome of outcomes) {
      expect(parseDirectoryPickerHelperOutcome(encodeDirectoryPickerHelperOutcome(outcome))).toEqual(outcome)
    }
    expect(parseDirectoryPickerHelperOutcome('other output')).toBeUndefined()
    expect(parseDirectoryPickerHelperOutcome('dsh electron directory picker: {')).toBeUndefined()
    expect(parseDirectoryPickerHelperOutcome('dsh electron directory picker: {"kind":"picked","path":""}')).toBeUndefined()
    expect(parseDirectoryPickerHelperOutcome('dsh electron directory picker: {"kind":"cancelled","extra":true}')).toBeUndefined()
  })

  it('emits picked, cancelled, and failed helper outcomes', async () => {
    const written: DirectoryPickerHelperOutcome[] = []
    const write = async (outcome: DirectoryPickerHelperOutcome): Promise<void> => { written.push(outcome) }
    await expect(runDirectoryPickerHelper(async () => '/work', write)).resolves.toBe(0)
    await expect(runDirectoryPickerHelper(async () => null, write)).resolves.toBe(0)
    await expect(runDirectoryPickerHelper(async () => { throw 'failed' }, write)).resolves.toBe(1)
    expect(written).toEqual([
      { kind: 'picked', path: '/work' },
      { kind: 'cancelled' },
      { kind: 'failed', message: 'failed' },
    ])
  })
})

describe('pickElectronDirectory', () => {
  it('launches unpackaged Electron hidden and returns the picked path', async () => {
    const child = new FakeHelper()
    const calls: Array<{ command: string; args: readonly string[]; options: SpawnOptions }> = []
    const pending = pickElectronDirectory(new AbortController().signal, {
      execPath: '/electron', applicationPath: '/app', packaged: false, platform: 'win32',
    }, { spawnProcess: launch(child, calls) })
    child.stdout.write(`${encodeDirectoryPickerHelperOutcome({ kind: 'picked', path: 'C:\\project' })}\n`)
    child.emit('close', 0, null)

    await expect(pending).resolves.toBe('C:\\project')
    expect(calls).toEqual([{
      command: '/electron',
      args: ['/app', DIRECTORY_PICKER_HELPER_ARGUMENT],
      options: { detached: false, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true },
    }])
  })

  it('uses the packaged self-launch form and maps cancellation', async () => {
    const child = new FakeHelper()
    const calls: Array<{ command: string; args: readonly string[]; options: SpawnOptions }> = []
    const pending = pickElectronDirectory(new AbortController().signal, {
      execPath: 'Harness.exe', applicationPath: 'unused', packaged: true, platform: 'win32',
    }, { spawnProcess: launch(child, calls) })
    child.stdout.write(`${encodeDirectoryPickerHelperOutcome({ kind: 'cancelled' })}\n`)
    child.emit('close', 0, null)
    await expect(pending).resolves.toBeNull()
    expect(calls[0]?.args).toEqual([DIRECTORY_PICKER_HELPER_ARGUMENT])
  })

  it('surfaces helper failures and unrecognized exits', async () => {
    const failed = new FakeHelper()
    const failure = pickElectronDirectory(new AbortController().signal, {
      execPath: '/electron', applicationPath: '/app', packaged: false,
    }, { spawnProcess: launch(failed, []) })
    failed.stdout.write(`${encodeDirectoryPickerHelperOutcome({ kind: 'failed', message: 'dialog broke' })}\n`)
    failed.emit('close', 1, null)
    await expect(failure).rejects.toThrow('dialog broke')

    const unknown = new FakeHelper()
    const missing = pickElectronDirectory(new AbortController().signal, {
      execPath: '/electron', applicationPath: '/app', packaged: false,
    }, { spawnProcess: launch(unknown, []) })
    unknown.stderr.write('native startup failed')
    unknown.emit('close', 2, 'SIGTERM')
    await expect(missing).rejects.toThrow('native startup failed')
  })

  it('terminates the helper tree and rejects with the abort reason', async () => {
    const child = new FakeHelper()
    const controller = new AbortController()
    const terminate = vi.fn(() => { child.emit('close', null, 'SIGKILL') })
    const pending = pickElectronDirectory(controller.signal, {
      execPath: '/electron', applicationPath: '/app', packaged: false, platform: 'win32',
    }, {
      spawnProcess: launch(child, []),
      terminateProcessTree: terminate,
    })
    controller.abort(new Error('caller left'))
    await expect(pending).rejects.toThrow('caller left')
    expect(terminate).toHaveBeenCalledWith(asChild(child), 'win32')
  })

  it('falls back to a direct kill when tree termination fails', async () => {
    const child = new FakeHelper()
    child.kill.mockImplementation(() => {
      child.emit('close', null, 'SIGKILL')
      return true
    })
    const controller = new AbortController()
    const pending = pickElectronDirectory(controller.signal, {
      execPath: '/electron', applicationPath: '/app', packaged: false, platform: 'win32',
    }, {
      spawnProcess: launch(child, []),
      terminateProcessTree: () => { throw new Error('taskkill failed') },
    })
    controller.abort(new Error('caller left'))
    await expect(pending).rejects.toThrow('caller left')
    expect(child.kill).toHaveBeenCalledWith('SIGKILL')
  })

  it('bounds cancellation when the helper never reports close', async () => {
    vi.useFakeTimers()
    try {
      const child = new FakeHelper()
      const controller = new AbortController()
      const pending = pickElectronDirectory(controller.signal, {
        execPath: '/electron', applicationPath: '/app', packaged: false, platform: 'win32',
      }, {
        spawnProcess: launch(child, []),
        terminateProcessTree: () => {},
      })
      const rejected = expect(pending).rejects.toThrow('did not exit within 5000 ms')
      controller.abort(new Error('caller left'))
      await vi.advanceTimersByTimeAsync(5_000)
      await rejected
      expect(child.kill).toHaveBeenCalledWith('SIGKILL')
      expect(child.stdout.destroyed).toBe(true)
      expect(child.stderr.destroyed).toBe(true)
      expect(child.unref).toHaveBeenCalledOnce()
    } finally {
      vi.useRealTimers()
    }
  })

  it('keeps bounded cleanup active when direct kill emits an error', async () => {
    vi.useFakeTimers()
    try {
      const child = new FakeHelper()
      child.kill.mockImplementation(() => {
        child.emit('error', new Error('kill EPERM'))
        return false
      })
      const controller = new AbortController()
      const pending = pickElectronDirectory(controller.signal, {
        execPath: '/electron', applicationPath: '/app', packaged: false, platform: 'win32',
      }, {
        spawnProcess: launch(child, []),
        terminateProcessTree: () => { throw new Error('taskkill failed') },
      })
      const rejected = expect(pending).rejects.toThrow('did not exit within 5000 ms')
      controller.abort(new Error('caller left'))
      await vi.advanceTimersByTimeAsync(5_000)
      await rejected
      expect(child.kill).toHaveBeenCalledTimes(2)
      expect(child.unref).toHaveBeenCalledOnce()
    } finally {
      vi.useRealTimers()
    }
  })

  it('rejects before spawning when already aborted and contains spawn errors', async () => {
    const aborted = new AbortController()
    aborted.abort('gone')
    const spawnProcess = vi.fn()
    await expect(pickElectronDirectory(aborted.signal, {
      execPath: '/electron', applicationPath: '/app', packaged: false,
    }, { spawnProcess })).rejects.toThrow('gone')
    expect(spawnProcess).not.toHaveBeenCalled()

    const child = new FakeHelper()
    const pending = pickElectronDirectory(new AbortController().signal, {
      execPath: '/electron', applicationPath: '/app', packaged: false,
    }, { spawnProcess: launch(child, []) })
    child.emit('error', new Error('spawn refused'))
    await expect(pending).rejects.toThrow('spawn refused')
  })
})

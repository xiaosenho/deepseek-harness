import { EventEmitter } from 'node:events'
import type { ChildProcess } from 'node:child_process'
import { describe, expect, it, vi } from 'vitest'
import { electronDirectoryPickerRequestId } from '@deepseek-ai/dsh-host-directory-picker-electron/protocol'
import type { ElectronDirectoryPickerParentMessage } from '@deepseek-ai/dsh-host-directory-picker-electron/protocol'
import { ElectronDirectoryPickerBridge } from '../src/directory-picker-bridge.ts'

class FakeChild extends EventEmitter {
  connected = true
  readonly sent: ElectronDirectoryPickerParentMessage[] = []

  send(message: ElectronDirectoryPickerParentMessage, callback?: (error: Error | null) => void): boolean {
    this.sent.push(message)
    callback?.(null)
    return true
  }
}

function asChild(child: FakeChild): ChildProcess {
  return child as unknown as ChildProcess
}

describe('ElectronDirectoryPickerBridge', () => {
  it('correlates picked, cancelled, and failed outcomes', async () => {
    const child = new FakeChild()
    const outcomes: Array<string | null | Error> = ['/work/project', null, new Error('dialog unavailable')]
    const bridge = new ElectronDirectoryPickerBridge(asChild(child), async () => {
      const outcome = outcomes.shift()
      if (outcome instanceof Error) throw outcome
      return outcome ?? null
    })

    for (const rawId of ['picked', 'cancelled', 'failed']) {
      child.emit('message', {
        type: 'dsh/electron-directory-picker/request',
        requestId: electronDirectoryPickerRequestId(rawId),
      })
    }
    await vi.waitFor(() => { expect(child.sent).toHaveLength(3) })
    expect(child.sent).toEqual([
      {
        type: 'dsh/electron-directory-picker/picked',
        requestId: electronDirectoryPickerRequestId('picked'),
        path: '/work/project',
      },
      {
        type: 'dsh/electron-directory-picker/cancelled',
        requestId: electronDirectoryPickerRequestId('cancelled'),
      },
      {
        type: 'dsh/electron-directory-picker/failed',
        requestId: electronDirectoryPickerRequestId('failed'),
        message: 'dialog unavailable',
      },
    ])
    await bridge.stop()
  })

  it('aborts the matching handler on cancel and sends no late response', async () => {
    const child = new FakeChild()
    let observed: AbortSignal | undefined
    const bridge = new ElectronDirectoryPickerBridge(asChild(child), signal => new Promise((_resolve, reject) => {
      observed = signal
      signal.addEventListener('abort', () => {
        reject(signal.reason instanceof Error ? signal.reason : new Error(String(signal.reason)))
      }, { once: true })
    }))
    const requestId = electronDirectoryPickerRequestId('cancel-me')
    child.emit('message', { type: 'dsh/electron-directory-picker/request', requestId })
    await vi.waitFor(() => { expect(observed).toBeDefined() })
    child.emit('message', { type: 'dsh/electron-directory-picker/cancel', requestId })
    await vi.waitFor(() => { expect(observed?.aborted).toBe(true) })
    expect(child.sent).toEqual([])
    await bridge.stop()
  })

  it('ignores malformed, unknown, cancelled-before-start, and duplicate messages', async () => {
    const child = new FakeChild()
    let resolve!: (path: string | null) => void
    const pick = vi.fn(() => new Promise<string | null>((settle) => { resolve = settle }))
    const bridge = new ElectronDirectoryPickerBridge(asChild(child), pick)
    const requestId = electronDirectoryPickerRequestId('one')

    child.emit('message', { type: 'unrelated', requestId })
    child.emit('message', { type: 'dsh/electron-directory-picker/cancel', requestId })
    child.emit('message', { type: 'dsh/electron-directory-picker/request', requestId })
    child.emit('message', { type: 'dsh/electron-directory-picker/request', requestId })
    await vi.waitFor(() => { expect(pick).toHaveBeenCalledOnce() })
    resolve('/one')
    await vi.waitFor(() => { expect(child.sent).toHaveLength(1) })
    await bridge.stop()
  })

  it('aborts and joins active handlers when the child disconnects or the bridge stops', async () => {
    const child = new FakeChild()
    const signals: AbortSignal[] = []
    const bridge = new ElectronDirectoryPickerBridge(asChild(child), signal => new Promise((_resolve, reject) => {
      signals.push(signal)
      signal.addEventListener('abort', () => {
        reject(signal.reason instanceof Error ? signal.reason : new Error(String(signal.reason)))
      }, { once: true })
    }))
    child.emit('message', {
      type: 'dsh/electron-directory-picker/request',
      requestId: electronDirectoryPickerRequestId('active'),
    })
    await vi.waitFor(() => { expect(signals).toHaveLength(1) })
    child.connected = false
    child.emit('disconnect')
    await vi.waitFor(() => { expect(signals[0]?.aborted).toBe(true) })
    await bridge.stop()
    expect(child.listenerCount('message')).toBe(0)
  })

  it('fails loudly when the backend has no connected IPC channel', () => {
    const child = new FakeChild()
    child.connected = false
    expect(() => new ElectronDirectoryPickerBridge(asChild(child), async () => null))
      .toThrow('connected IPC channel')
  })
})

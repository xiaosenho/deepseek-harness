/** Behavior of the Electron parent-IPC provider and inherited filesystem browser. */

import type { Context as ContextType } from '@deepseek-ai/cordis'
import { Context } from '@deepseek-ai/cordis'
import type { DirectoryPickerNativeCapability } from '@deepseek-ai/dsh-host-directory-picker'
import { afterEach, describe, expect, it } from 'vitest'
import ElectronDirectoryPicker, { createProcessElectronDirectoryPickerPort } from '../src/index.ts'
import type {
  ElectronDirectoryPickerChildMessage, ElectronDirectoryPickerInternals,
  ElectronDirectoryPickerIpcPort, ElectronDirectoryPickerRequestId,
} from '../src/index.ts'
import { electronDirectoryPickerRequestId } from '../src/index.ts'

class FakePort implements ElectronDirectoryPickerIpcPort {
  connected = true
  readonly sent: ElectronDirectoryPickerChildMessage[] = []
  readonly messageListeners = new Set<(message: unknown) => void>()
  readonly disconnectListeners = new Set<() => void>()
  callbackError: Error | null = null
  throwOnSend: unknown
  throwOnCancel: unknown

  send(message: ElectronDirectoryPickerChildMessage, callback: (error: Error | null) => void): void {
    if (message.type === 'dsh/electron-directory-picker/cancel' && this.throwOnCancel !== undefined) {
      const error = this.throwOnCancel
      this.throwOnCancel = undefined
      throw error
    }
    if (this.throwOnSend !== undefined) {
      const error = this.throwOnSend
      this.throwOnSend = undefined
      throw error
    }
    this.sent.push(message)
    callback(this.callbackError)
    this.callbackError = null
  }

  onMessage(listener: (message: unknown) => void): () => void {
    this.messageListeners.add(listener)
    return () => this.messageListeners.delete(listener)
  }

  onDisconnect(listener: () => void): () => void {
    this.disconnectListeners.add(listener)
    return () => this.disconnectListeners.delete(listener)
  }

  message(value: unknown): void {
    for (const listener of this.messageListeners) listener(value)
  }

  disconnect(): void {
    this.connected = false
    for (const listener of this.disconnectListeners) listener()
  }
}

const contexts: Context[] = []

afterEach(async () => {
  await Promise.all(contexts.splice(0).map(ctx => ctx.fiber.dispose()))
})

function installFakeProcessIpc(): { sent: unknown[]; restore: () => void } {
  const sendDescriptor = Object.getOwnPropertyDescriptor(process, 'send')
  const connectedDescriptor = Object.getOwnPropertyDescriptor(process, 'connected')
  const sent: unknown[] = []
  Object.defineProperty(process, 'send', {
    configurable: true,
    value(message: unknown, callback: (error: Error | null) => void) {
      sent.push(message)
      callback(null)
      return true
    },
  })
  Object.defineProperty(process, 'connected', { configurable: true, value: true })
  return {
    sent,
    restore() {
      if (sendDescriptor === undefined) Reflect.deleteProperty(process, 'send')
      else Object.defineProperty(process, 'send', sendDescriptor)
      if (connectedDescriptor === undefined) Reflect.deleteProperty(process, 'connected')
      else Object.defineProperty(process, 'connected', connectedDescriptor)
    },
  }
}

function ids(...values: string[]): () => ElectronDirectoryPickerRequestId {
  const queue = values.map(electronDirectoryPickerRequestId)
  return () => {
    const requestId = queue.shift()
    if (requestId === undefined) throw new Error('test exhausted request ids')
    return requestId
  }
}

async function harness(
  port: FakePort,
  requestId: (() => ElectronDirectoryPickerRequestId) | null = ids('pick-1'),
): Promise<{
  capability: DirectoryPickerNativeCapability
  ctx: Context
  fiber: ReturnType<Context['plugin']>
}> {
  const internals: ElectronDirectoryPickerInternals = requestId === null ? { port } : { port, requestId }
  class TestElectronDirectoryPicker extends ElectronDirectoryPicker {
    constructor(ctx: ContextType) {
      super(ctx, internals)
    }
  }
  const ctx = new Context()
  contexts.push(ctx)
  const fiber = ctx.plugin(TestElectronDirectoryPicker)
  await fiber.await()
  const capability = ctx.get('directoryPicker')!.capability()
  if (capability.kind !== 'native') throw new Error('Electron provider must advertise native')
  return { capability, ctx, fiber }
}

describe('ElectronDirectoryPicker', () => {
  it('adapts a connected Node parent channel and fails loud without one', () => {
    const fakeProcess = installFakeProcessIpc()
    try {
      const port = createProcessElectronDirectoryPickerPort()
      expect(port.connected).toBe(true)
      const requestId = electronDirectoryPickerRequestId('process-port')
      port.send({ type: 'dsh/electron-directory-picker/request', requestId }, (error) => {
        expect(error).toBeNull()
      })
      expect(fakeProcess.sent).toEqual([{ type: 'dsh/electron-directory-picker/request', requestId }])
      const removeMessage = port.onMessage(() => {})
      const removeDisconnect = port.onDisconnect(() => {})
      removeMessage()
      removeDisconnect()

      Object.defineProperty(process, 'send', { configurable: true, value: undefined })
      expect(() => createProcessElectronDirectoryPickerPort()).toThrow('must run as a connected IPC child process')
      Object.defineProperty(process, 'send', { configurable: true, value() { return true } })
      Object.defineProperty(process, 'connected', { configurable: true, value: false })
      expect(() => createProcessElectronDirectoryPickerPort()).toThrow('must run as a connected IPC child process')
    } finally {
      fakeProcess.restore()
    }
  })

  it('uses the owned process IPC adapter when no test port is injected', async () => {
    const fakeProcess = installFakeProcessIpc()
    try {
      class DefaultPortPicker extends ElectronDirectoryPicker {
        constructor(ctx: ContextType) {
          super(ctx, { requestId: ids('default-process-port') })
        }
      }
      const ctx = new Context()
      contexts.push(ctx)
      const fiber = ctx.plugin(DefaultPortPicker)
      await fiber.await()
      expect(ctx.directoryPicker.capability().kind).toBe('native')
      await fiber.dispose()
    } finally {
      fakeProcess.restore()
    }
  })

  it('provides a stable native capability and requests one OS dialog per pick', async () => {
    const port = new FakePort()
    const { capability, ctx } = await harness(port)
    expect(ctx.directoryPicker.capability()).toBe(capability)

    const picked = capability.pick(new AbortController().signal)
    expect(port.sent).toEqual([{
      type: 'dsh/electron-directory-picker/request', requestId: 'pick-1',
    }])
    port.message({
      type: 'dsh/electron-directory-picker/picked', requestId: 'pick-1', path: '/chosen',
    })
    await expect(picked).resolves.toBe('/chosen')
  })

  it('correlates concurrent replies independently and maps cancellation and failure', async () => {
    const port = new FakePort()
    const { capability } = await harness(port, ids('first', 'second', 'third'))
    const first = capability.pick(new AbortController().signal)
    const second = capability.pick(new AbortController().signal)
    const third = capability.pick(new AbortController().signal)

    port.message({ type: 'dsh/electron-directory-picker/cancelled', requestId: 'second' })
    port.message({ type: 'dsh/electron-directory-picker/failed', requestId: 'third', message: 'COM refused' })
    port.message({ type: 'dsh/electron-directory-picker/picked', requestId: 'first', path: '/first' })
    await expect(first).resolves.toBe('/first')
    await expect(second).resolves.toBeNull()
    await expect(third).rejects.toThrow('COM refused')
  })

  it('rejects a correlated picked reply whose directory path is not absolute', async () => {
    const port = new FakePort()
    const { capability } = await harness(port)
    const picked = capability.pick(new AbortController().signal)
    port.message({
      type: 'dsh/electron-directory-picker/picked', requestId: 'pick-1', path: 'relative/workspace',
    })
    await expect(picked).rejects.toThrow('parent returned a non-absolute directory path')
  })

  it('ignores unrelated, malformed, and stale parent traffic', async () => {
    const port = new FakePort()
    const { capability } = await harness(port)
    const picked = capability.pick(new AbortController().signal)
    let settled = false
    void picked.finally(() => { settled = true })
    port.message({ type: 'other/ipc', requestId: 'pick-1' })
    port.message({ type: 'dsh/electron-directory-picker/picked', requestId: 'pick-1', path: '/bad', extra: true })
    port.message({ type: 'dsh/electron-directory-picker/picked', requestId: 'stale', path: '/stale' })
    await Promise.resolve()
    expect(settled).toBe(false)
    port.message({ type: 'dsh/electron-directory-picker/picked', requestId: 'pick-1', path: '/valid' })
    await expect(picked).resolves.toBe('/valid')
  })

  it('aborts immediately, sends best-effort cancellation, and ignores a late reply', async () => {
    const port = new FakePort()
    const { capability } = await harness(port, ids('aborted', 'next'))
    const controller = new AbortController()
    const picked = capability.pick(controller.signal)
    const reason = new Error('caller left')
    controller.abort(reason)
    await expect(picked).rejects.toBe(reason)
    expect(port.sent.at(-1)).toEqual({
      type: 'dsh/electron-directory-picker/cancel', requestId: 'aborted',
    })
    port.message({ type: 'dsh/electron-directory-picker/picked', requestId: 'aborted', path: '/late' })

    const alreadyAborted = new AbortController()
    alreadyAborted.abort('already gone')
    await expect(capability.pick(alreadyAborted.signal)).rejects.toThrow('already gone')
    expect(port.sent).toHaveLength(2)
  })

  it('keeps the abort result when cancellation transport fails or is already disconnected', async () => {
    const port = new FakePort()
    const { capability } = await harness(port, ids('cancel-throws', 'disconnected'))
    const first = new AbortController()
    const firstPick = capability.pick(first.signal)
    port.throwOnCancel = new Error('cancel send failed')
    first.abort(new Error('first caller left'))
    await expect(firstPick).rejects.toThrow('first caller left')

    const second = new AbortController()
    const secondPick = capability.pick(second.signal)
    port.connected = false
    second.abort(new Error('second caller left'))
    await expect(secondPick).rejects.toThrow('second caller left')
  })

  it('uses UUID correlation by default and notices a closed port before the next pick', async () => {
    const port = new FakePort()
    const { capability } = await harness(port, null)
    const picked = capability.pick(new AbortController().signal)
    const request = port.sent[0]
    if (request?.type !== 'dsh/electron-directory-picker/request') throw new Error('expected chooser request')
    expect(request.requestId).toMatch(/^[0-9a-f-]{36}$/)
    port.message({
      type: 'dsh/electron-directory-picker/cancelled', requestId: request.requestId,
    })
    await expect(picked).resolves.toBeNull()

    port.connected = false
    await expect(capability.pick(new AbortController().signal)).rejects.toThrow('IPC channel is disconnected')
    await expect(capability.pick(new AbortController().signal)).rejects.toThrow('IPC channel is disconnected')
  })

  it('surfaces synchronous and asynchronous request-send failures', async () => {
    const port = new FakePort()
    const { capability } = await harness(port, ids('callback-failure', 'throw-failure'))
    port.callbackError = new Error('queue closed')
    await expect(capability.pick(new AbortController().signal)).rejects.toThrow('failed to send chooser request: queue closed')
    port.throwOnSend = new Error('send threw')
    await expect(capability.pick(new AbortController().signal)).rejects.toThrow('send threw')
  })

  it('rejects pending and future requests on disconnect and removes listeners on dispose', async () => {
    const port = new FakePort()
    const { capability, fiber } = await harness(port, ids('one', 'two'))
    const pending = capability.pick(new AbortController().signal)
    port.disconnect()
    await expect(pending).rejects.toThrow('IPC channel disconnected')
    await expect(capability.pick(new AbortController().signal)).rejects.toThrow('IPC channel disconnected')

    await fiber.dispose()
    expect(port.messageListeners.size).toBe(0)
    expect(port.disconnectListeners.size).toBe(0)
  })

  it('rejects pending requests when the provider is disposed', async () => {
    const port = new FakePort()
    const { capability, fiber } = await harness(port)
    const pending = capability.pick(new AbortController().signal)
    await fiber.dispose()
    await expect(pending).rejects.toThrow('provider disposed')
    expect(port.sent.at(-1)).toEqual({
      type: 'dsh/electron-directory-picker/cancel', requestId: 'pick-1',
    })
    await expect(capability.pick(new AbortController().signal)).rejects.toThrow('provider disposed')
  })

  it('does not send disposal cancellation after the parent port is already unreachable', async () => {
    const port = new FakePort()
    const { capability, fiber } = await harness(port)
    const pending = capability.pick(new AbortController().signal)
    port.connected = false
    await fiber.dispose()
    await expect(pending).rejects.toThrow('provider disposed')
    expect(port.sent).toEqual([{
      type: 'dsh/electron-directory-picker/request', requestId: 'pick-1',
    }])
  })

  it('rejects duplicate live request ids', async () => {
    const port = new FakePort()
    const duplicate = electronDirectoryPickerRequestId('duplicate')
    const { capability } = await harness(port, () => duplicate)
    const first = capability.pick(new AbortController().signal)
    await expect(capability.pick(new AbortController().signal)).rejects.toThrow('duplicate request id')
    port.message({ type: 'dsh/electron-directory-picker/cancelled', requestId: duplicate })
    await expect(first).resolves.toBeNull()
  })

  it('fails at plugin load when an injected parent port is disconnected', async () => {
    const port = new FakePort()
    port.connected = false
    const internals: ElectronDirectoryPickerInternals = { port }
    class DisconnectedPicker extends ElectronDirectoryPicker {
      constructor(ctx: ContextType) {
        super(ctx, internals)
      }
    }
    const ctx = new Context()
    contexts.push(ctx)
    await expect(ctx.plugin(DisconnectedPicker).await()).rejects.toThrow('IPC channel is disconnected')
  })
})

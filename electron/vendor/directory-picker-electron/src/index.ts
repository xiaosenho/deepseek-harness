/**
 * Electron-hosted directory-picker backend. Filesystem browsing stays in the
 * web-host child through Node's native filesystem APIs, while native chooser
 * requests cross the child process's owned IPC channel to the Electron main
 * process.
 * @module @deepseek-ai/dsh-host-directory-picker-electron
 */

import { randomUUID } from 'node:crypto'
import { isAbsolute } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import {
  DirectoryPicker,
  type DirectoryPickerCapability,
  type DirectoryPickerNativeCapability,
} from '@deepseek-ai/dsh-host-directory-picker'
import {
  electronDirectoryPickerRequestId, isElectronDirectoryPickerParentMessage,
} from './protocol.ts'
import type {
  ElectronDirectoryPickerChildMessage, ElectronDirectoryPickerRequestId,
} from './protocol.ts'

export type {
  ElectronDirectoryPickerCancelMessage, ElectronDirectoryPickerCancelledMessage,
  ElectronDirectoryPickerChildMessage, ElectronDirectoryPickerFailedMessage,
  ElectronDirectoryPickerParentMessage, ElectronDirectoryPickerPickedMessage,
  ElectronDirectoryPickerRequestId, ElectronDirectoryPickerRequestMessage,
} from './protocol.ts'
export {
  electronDirectoryPickerRequestId, isElectronDirectoryPickerChildMessage,
  isElectronDirectoryPickerParentMessage,
} from './protocol.ts'

/** Minimal child-process IPC operations owned by this provider. */
export interface ElectronDirectoryPickerIpcPort {
  /** Whether the parent IPC channel can currently accept a message. */
  readonly connected: boolean
  /**
   * Send one validated child message.
   * @param message - request or cancellation sent to the Electron parent.
   * @param callback - asynchronous transport result.
   */
  send(message: ElectronDirectoryPickerChildMessage, callback: (error: Error | null) => void): void
  /**
   * Subscribe to untrusted messages from the parent.
   * @param listener - receiver that validates before dispatch.
   * @returns a disposer for this listener.
   */
  onMessage(listener: (message: unknown) => void): () => void
  /**
   * Subscribe to permanent parent-channel disconnection.
   * @param listener - receiver invoked when the channel closes.
   * @returns a disposer for this listener.
   */
  onDisconnect(listener: () => void): () => void
}

/** Non-serializable transport and id hooks used by focused tests. */
export interface ElectronDirectoryPickerInternals {
  /** Replaces the current process's parent IPC adapter. */
  port?: ElectronDirectoryPickerIpcPort
  /** Replaces UUID request-id generation. */
  requestId?: () => ElectronDirectoryPickerRequestId
}

/** One pending native chooser request and its caller-lifetime cleanup. */
interface PendingPick {
  resolve: (path: string | null) => void
  reject: (reason: unknown) => void
  signal: AbortSignal
  onAbort: () => void
}

/** Fail loudly if the closed parent-response union gains an unhandled member. */
/* v8 ignore start -- closed-union backstop; unreachable after protocol validation without a TypeScript violation */
function assertNever(value: never): never {
  throw new TypeError(`directory-picker-electron: unknown parent response ${String(value)}`)
}
/* v8 ignore stop */

/** Preserve Error abort reasons and normalize arbitrary wire-adjacent reasons. */
function abortError(reason: unknown): Error {
  return reason instanceof Error
    ? reason
    : new Error(`directory-picker-electron: request aborted: ${String(reason)}`, { cause: reason })
}

/**
 * Adapt the current Node child process's IPC channel to the provider port.
 * @returns the connected port.
 */
export function createProcessElectronDirectoryPickerPort(): ElectronDirectoryPickerIpcPort {
  if (typeof process.send !== 'function' || !process.connected) {
    throw new Error('directory-picker-electron: the web host must run as a connected IPC child process')
  }
  const send = process.send.bind(process)
  return {
    get connected() {
      return process.connected
    },
    send(message, callback) {
      send(message, callback)
    },
    onMessage(listener) {
      process.on('message', listener)
      return () => process.off('message', listener)
    },
    onDisconnect(listener) {
      process.on('disconnect', listener)
      return () => process.off('disconnect', listener)
    },
  }
}

/** The `ctx.directoryPicker` native implementation for Electron: one OS dialog per pick. */
export default class ElectronDirectoryPicker extends DirectoryPicker {
  private readonly nativeCapability: DirectoryPickerNativeCapability
  private readonly pending = new Map<ElectronDirectoryPickerRequestId, PendingPick>()
  private unavailable: Error | undefined

  /**
   * @param ctx - Cordis context that owns the service and IPC listeners.
   * @param internals - non-serializable IPC and id hooks for tests.
   */
  constructor(ctx: Context, internals: ElectronDirectoryPickerInternals = {}) {
    super(ctx)
    const port = internals.port ?? createProcessElectronDirectoryPickerPort()
    if (!port.connected) {
      throw new Error('directory-picker-electron: the Electron parent IPC channel is disconnected')
    }
    const nextRequestId = internals.requestId
      ?? (() => electronDirectoryPickerRequestId(randomUUID()))
    this.nativeCapability = {
      kind: 'native',
      pick: signal => this.pick(port, nextRequestId, signal),
    }

    ctx.effect(() => {
      const removeMessage = port.onMessage((message) => {
        this.receive(message)
      })
      const removeDisconnect = port.onDisconnect(() => {
        this.rejectAll(new Error('directory-picker-electron: the Electron parent IPC channel disconnected'))
      })
      return () => {
        removeMessage()
        removeDisconnect()
        this.cancelAndRejectAll(port, new Error('directory-picker-electron: provider disposed'))
      }
    }, 'directory-picker-electron: parent IPC')
  }

  /**
   * The Electron interaction capability.
   * @returns the stable native dialog capability object.
   */
  override capability(): DirectoryPickerCapability {
    return this.nativeCapability
  }

  /** Dispatch one strictly validated parent response to its pending request. */
  private receive(value: unknown): void {
    if (!isElectronDirectoryPickerParentMessage(value)) return
    switch (value.type) {
      case 'dsh/electron-directory-picker/picked':
        this.settle(value.requestId, (pending) => {
          if (isAbsolute(value.path)) {
            pending.resolve(value.path)
          } else {
            pending.reject(new Error('directory-picker-electron: parent returned a non-absolute directory path'))
          }
        })
        return
      case 'dsh/electron-directory-picker/cancelled':
        this.settle(value.requestId, (pending) => {
          pending.resolve(null)
        })
        return
      case 'dsh/electron-directory-picker/failed':
        this.settle(value.requestId, (pending) => {
          pending.reject(new Error(value.message))
        })
        return
      /* v8 ignore next 2 -- closed validated union; a new response type becomes a compile error */
      default:
        assertNever(value)
    }
  }

  /** Start one correlated parent chooser request. */
  private pick(
    port: ElectronDirectoryPickerIpcPort,
    nextRequestId: () => ElectronDirectoryPickerRequestId,
    signal: AbortSignal,
  ): Promise<string | null> {
    if (signal.aborted) return Promise.reject(abortError(signal.reason))
    if (this.unavailable !== undefined) return Promise.reject(this.unavailable)
    if (!port.connected) {
      const error = new Error('directory-picker-electron: the Electron parent IPC channel is disconnected')
      this.unavailable = error
      return Promise.reject(error)
    }

    const requestId = nextRequestId()
    if (this.pending.has(requestId)) {
      return Promise.reject(new Error(`directory-picker-electron: duplicate request id ${JSON.stringify(requestId)}`))
    }

    return new Promise<string | null>((resolve, reject) => {
      const onAbort = (): void => {
        // This listener exists only while its map entry does; every other
        // settlement removes the listener before deleting the entry.
        // oxlint-disable-next-line typescript/no-non-null-assertion -- listener ownership proves the correlated entry remains live
        const pending = this.take(requestId)!
        if (port.connected) this.sendCancellation(port, requestId)
        pending.reject(abortError(signal.reason))
      }
      this.pending.set(requestId, { resolve, reject, signal, onAbort })
      signal.addEventListener('abort', onAbort, { once: true })

      try {
        port.send({ type: 'dsh/electron-directory-picker/request', requestId }, (error) => {
          if (error === null) return
          this.settle(requestId, (pending) => {
            pending.reject(new Error(
              `directory-picker-electron: failed to send chooser request: ${error.message}`,
              { cause: error },
            ))
          })
        })
      } catch (error: unknown) {
        this.settle(requestId, (pending) => {
          pending.reject(error)
        })
      }
    })
  }

  /** Send best-effort cancellation after a pending request ceases to be live. */
  private sendCancellation(port: ElectronDirectoryPickerIpcPort, requestId: ElectronDirectoryPickerRequestId): void {
    try {
      port.send({ type: 'dsh/electron-directory-picker/cancel', requestId }, () => {
        // Cancellation transport failures have no observer: abort or provider disposal already owns the outcome.
      })
    } catch {
      // The channel closed between the connected check and send; abort or disposal remains the observable outcome.
    }
  }

  /** Remove one pending request and its abort listener. */
  private take(requestId: ElectronDirectoryPickerRequestId): PendingPick | undefined {
    const pending = this.pending.get(requestId)
    if (pending === undefined) return undefined
    this.pending.delete(requestId)
    pending.signal.removeEventListener('abort', pending.onAbort)
    return pending
  }

  /** Settle one response when its request is still live. */
  private settle(requestId: ElectronDirectoryPickerRequestId, action: (pending: PendingPick) => void): void {
    const pending = this.take(requestId)
    if (pending !== undefined) action(pending)
  }

  /** Make the provider permanently unavailable and reject all live requests. */
  private rejectAll(reason: Error): void {
    this.unavailable ??= reason
    for (const requestId of [...this.pending.keys()]) {
      this.settle(requestId, (pending) => {
        pending.reject(reason)
      })
    }
  }

  /** Cancel every reachable parent chooser before rejecting its local caller. */
  private cancelAndRejectAll(port: ElectronDirectoryPickerIpcPort, reason: Error): void {
    if (port.connected) {
      for (const requestId of this.pending.keys()) this.sendCancellation(port, requestId)
    }
    this.rejectAll(reason)
  }
}

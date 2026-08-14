/** Private IPC bridge from the owned Web backend to Electron's dialog helper. */

import type { ChildProcess } from 'node:child_process'
import {
  isElectronDirectoryPickerChildMessage,
  type ElectronDirectoryPickerParentMessage,
  type ElectronDirectoryPickerRequestId,
} from '@deepseek-ai/dsh-host-directory-picker-electron/protocol'

/** Main-process implementation of one directory pick. */
export type ElectronDirectoryPickerHandler = (signal: AbortSignal) => Promise<string | null>

interface ActiveRequest {
  controller: AbortController
  task: Promise<void>
}

/** Owns correlated directory-picker requests arriving from one exact child process. */
export class ElectronDirectoryPickerBridge {
  private readonly active = new Map<ElectronDirectoryPickerRequestId, ActiveRequest>()
  private accepting = true
  private stopTask: Promise<void> | undefined

  /**
   * @param child - Electron-owned Web backend with a private Node IPC channel.
   * @param pick - abortable native-dialog handler.
   */
  constructor(
    private readonly child: ChildProcess,
    private readonly pick: ElectronDirectoryPickerHandler,
  ) {
    if (!child.connected) {
      throw new Error('Electron WebUI command must have a connected IPC channel')
    }
    child.on('message', this.onMessage)
    child.once('disconnect', this.onDisconnect)
    child.once('exit', this.onDisconnect)
  }

  private readonly onMessage = (value: unknown): void => {
    if (!this.accepting || !isElectronDirectoryPickerChildMessage(value)) return
    if (value.type === 'dsh/electron-directory-picker/cancel') {
      this.active.get(value.requestId)?.controller.abort(new Error('directory picker request cancelled'))
      return
    }
    if (this.active.has(value.requestId)) return

    const controller = new AbortController()
    const task = Promise.resolve()
      .then(() => this.pick(controller.signal))
      .then(
        (path) => {
          if (controller.signal.aborted) return
          this.send(path === null
            ? { type: 'dsh/electron-directory-picker/cancelled', requestId: value.requestId }
            : { type: 'dsh/electron-directory-picker/picked', requestId: value.requestId, path })
        },
        (error: unknown) => {
          if (controller.signal.aborted) return
          this.send({
            type: 'dsh/electron-directory-picker/failed',
            requestId: value.requestId,
            message: error instanceof Error ? error.message : String(error),
          })
        },
      )
      .finally(() => { this.active.delete(value.requestId) })
    this.active.set(value.requestId, { controller, task })
  }

  private readonly onDisconnect = (): void => {
    void this.stop()
  }

  private send(message: ElectronDirectoryPickerParentMessage): void {
    if (!this.accepting || !this.child.connected) return
    this.child.send(message, () => {
      // Child exit/disconnect owns delivery failure; no caller remains to receive it.
    })
  }

  /** Abort all dialogs, detach from the child, and await handler quiescence. */
  stop(): Promise<void> {
    if (this.stopTask !== undefined) return this.stopTask
    this.accepting = false
    this.child.off('message', this.onMessage)
    this.child.off('disconnect', this.onDisconnect)
    this.child.off('exit', this.onDisconnect)
    const tasks = [...this.active.values()].map((request) => {
      request.controller.abort(new Error('Electron directory picker bridge stopped'))
      return request.task
    })
    this.stopTask = Promise.allSettled(tasks).then(() => {})
    return this.stopTask
  }
}

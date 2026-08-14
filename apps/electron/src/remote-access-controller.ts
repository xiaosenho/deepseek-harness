/** Serialized backend restarts for Electron remote-access state changes. */

import type { ElectronDirectoryPickerHandler } from './directory-picker-bridge.ts'
import type { WebBackend, WebBackendLocation, WebBackendMode } from './backend.ts'

/** Main-process remote-access state projected into the native application menu. */
export interface RemoteAccessState {
  /** Whether the active backend accepts authenticated LAN clients. */
  enabled: boolean
  /** Complete token-bearing URL when remote access is enabled. */
  url?: string
  /** Whether one backend mode change is in progress. */
  transitioning: boolean
}

/** Result of one main-process exposure transition. */
export interface RemoteAccessTransitionResult {
  /** Whether the requested mode is active. */
  succeeded: boolean
  /** New loopback URL that the native host must load after the transition. */
  navigationUrl?: URL
}

interface ActiveBackend {
  location: WebBackendLocation
  mode: WebBackendMode
}

interface RemoteAccessControllerOptions {
  backend: Pick<WebBackend, 'start' | 'stop'>
  cwd: string
  onTransitionError: (error: Error, fatal: boolean) => void
  onUnexpectedExit: (code: number | null, signal: NodeJS.Signals | null) => void
  pickDirectory: ElectronDirectoryPickerHandler
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function transitionFailure(
  requested: WebBackendMode,
  failure: unknown,
  recovery: { restored: true } | { restored: false; recoveryFailure?: unknown },
): Error {
  const action = requested === 'lan' ? 'enable' : 'disable'
  const recoveryDetail = recovery.restored
    ? 'The previous mode was restored.'
    : recovery.recoveryFailure === undefined
      ? 'The current WebUI could not be stopped safely. DeepSeek Harness must exit.'
      : `Restoring the previous mode also failed: ${errorMessage(recovery.recoveryFailure)} DeepSeek Harness must exit.`
  return new Error(`Could not ${action} remote access: ${errorMessage(failure)} ${recoveryDetail}`)
}

/** Owns one Electron Web backend and serializes remote-access mode changes. */
export class RemoteAccessController {
  private active: ActiveBackend | undefined
  private shuttingDown = false
  private shutdownTask: Promise<void> | undefined
  private transitionTask: Promise<RemoteAccessTransitionResult> | undefined

  /**
   * @param options - backend ownership, directory picker, and recoverable/fatal failure callbacks.
   */
  constructor(private readonly options: RemoteAccessControllerOptions) {}

  /**
   * Start the initial loopback-only backend.
   * @returns its loopback location after readiness.
   */
  async start(): Promise<WebBackendLocation> {
    if (this.active !== undefined) throw new Error('Electron WebUI controller is already started')
    if (this.shuttingDown) throw new Error('Electron WebUI controller is shutting down')
    const location = await this.startMode('loopback')
    this.active = { location, mode: 'loopback' }
    return location
  }

  /** Return native-menu state without exposing inactive credentials. */
  getState(): RemoteAccessState {
    const active = this.active
    const enabled = active?.mode === 'lan'
    return {
      enabled,
      transitioning: this.transitionTask !== undefined,
      ...enabled && active.location.remoteAccessUrl !== undefined
        ? { url: active.location.remoteAccessUrl.href }
        : {},
    }
  }

  /**
   * Change backend exposure exactly once; concurrent requests are rejected.
   * @param enabled - true for authenticated LAN access, false for loopback-only access.
   * @returns the result and any loopback URL that the desktop window must load.
   */
  async setEnabled(enabled: boolean): Promise<RemoteAccessTransitionResult> {
    if (this.shuttingDown || this.transitionTask !== undefined || this.active === undefined) {
      return { succeeded: false }
    }
    const requested: WebBackendMode = enabled ? 'lan' : 'loopback'
    if (this.active.mode === requested) return { succeeded: true }
    const task = this.switchMode(requested)
    this.transitionTask = task
    try {
      return await task
    } finally {
      if (this.transitionTask === task) this.transitionTask = undefined
    }
  }

  /**
   * Stop after any active transition settles so shutdown never races a restart.
   * @returns the shared shutdown attempt; callers may retry after a stop failure.
   */
  shutdown(): Promise<void> {
    if (this.shutdownTask !== undefined) return this.shutdownTask
    this.shuttingDown = true
    const task = (async () => {
      await this.transitionTask
      await this.options.backend.stop()
      this.active = undefined
    })()
    this.shutdownTask = task
    void task.catch(() => {
      if (this.shutdownTask === task) this.shutdownTask = undefined
    })
    return task
  }

  private async startMode(mode: WebBackendMode): Promise<WebBackendLocation> {
    const location = await this.options.backend.start(
      mode,
      this.options.cwd,
      (code, signal) => {
        this.active = undefined
        this.options.onUnexpectedExit(code, signal)
      },
      this.options.pickDirectory,
    )
    if (mode === 'lan' && location.remoteAccessUrl === undefined) {
      throw new Error('the Host has no reachable external IPv4 address')
    }
    return location
  }

  private reportFailure(error: Error, fatal: boolean): void {
    try {
      this.options.onTransitionError(error, fatal)
    } catch (reportError) {
      console.error('Failed to report an Electron remote-access transition error.', reportError)
    }
  }

  private async switchMode(requested: WebBackendMode): Promise<RemoteAccessTransitionResult> {
    const previous = this.active
    if (previous === undefined) return { succeeded: false }
    try {
      await this.options.backend.stop()
    } catch (error) {
      this.reportFailure(transitionFailure(requested, error, { restored: false }), true)
      return { succeeded: false }
    }

    let failure: unknown
    try {
      const location = await this.startMode(requested)
      this.active = { location, mode: requested }
      return { succeeded: true, navigationUrl: location.loopbackUrl }
    } catch (error) {
      failure = error
    }

    try {
      await this.options.backend.stop()
      const location = await this.startMode(previous.mode)
      this.active = { location, mode: previous.mode }
      this.reportFailure(transitionFailure(requested, failure, { restored: true }), false)
      return { succeeded: false, navigationUrl: location.loopbackUrl }
    } catch (rollbackError) {
      this.active = undefined
      try {
        await this.options.backend.stop()
      } catch (cleanupError) {
        rollbackError = new Error(
          `${errorMessage(rollbackError)}; cleanup also failed: ${errorMessage(cleanupError)}`,
        )
      }
      this.reportFailure(transitionFailure(requested, failure, {
        recoveryFailure: rollbackError,
        restored: false,
      }), true)
      return { succeeded: false }
    }
  }
}

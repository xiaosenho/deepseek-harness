/** Serialized backend restarts for Electron remote-access state changes. */

import type { ElectronDirectoryPickerHandler } from './directory-picker-bridge.ts'
import type { WebBackend, WebBackendLocation, WebBackendMode } from './backend.ts'
import type { FrpcClient } from './frpc.ts'
import {
  frpPublicOrigin,
  frpTrustedAuthority,
  type RemoteAccessConfiguration,
} from './remote-access-config.ts'
import { formatRemoteAccessUrl } from './remote-access.ts'

/** Main-process remote-access state projected into the native application menu. */
export interface RemoteAccessState {
  /** Whether the active backend accepts authenticated remote clients. */
  enabled: boolean
  /** Active remote transport while enabled. */
  mode?: 'lan' | 'frp'
  /** Transport used by the next enable action. */
  preferredMode: 'lan' | 'frp'
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
  frpc: Pick<FrpcClient, 'start' | 'stop'>
  configuration: RemoteAccessConfiguration
  cwd: string
  onTransitionError: (error: Error, fatal: boolean, navigationUrl?: URL) => void
  onUnexpectedExit: (code: number | null, signal: NodeJS.Signals | null) => void
  pickDirectory: ElectronDirectoryPickerHandler
  /** Operating system whose process-tree guarantees constrain FRP enablement. */
  platform?: NodeJS.Platform
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function transitionFailure(
  requested: WebBackendMode,
  failure: unknown,
  recovery: { restored: true } | { restored: false; recoveryFailure?: unknown },
): Error {
  const action = requested === 'loopback'
    ? 'disable'
    : requested === 'frp'
      ? 'enable FRP remote access'
      : 'enable LAN remote access'
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
  private configuration: RemoteAccessConfiguration
  private configurationTask: Promise<boolean> | undefined
  private shuttingDown = false
  private shutdownTask: Promise<void> | undefined
  private transitionTask: Promise<RemoteAccessTransitionResult> | undefined

  /**
   * @param options - backend ownership, directory picker, and recoverable/fatal failure callbacks.
   */
  constructor(private readonly options: RemoteAccessControllerOptions) {
    this.configuration = options.configuration
  }

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
    const enabled = active?.mode === 'lan' || active?.mode === 'frp'
    return {
      enabled,
      preferredMode: this.configuration.mode,
      ...enabled ? { mode: active.mode as 'lan' | 'frp' } : {},
      transitioning: this.transitionTask !== undefined || this.configurationTask !== undefined,
      ...enabled && active.location.remoteAccessUrl !== undefined
        ? { url: active.location.remoteAccessUrl.href }
        : {},
    }
  }

  /** Return the secret-bearing preferences retained only in Electron main. */
  getConfiguration(): RemoteAccessConfiguration {
    return this.configuration
  }

  /** Return the active FRP backend's local-renderer bearer without projecting it into desktop state. */
  getRendererAccessToken(): string | undefined {
    return this.active?.mode === 'frp' ? this.active.location.rendererAccessToken : undefined
  }

  /** Persist and replace preferences only while the owned WebUI is settled and remote access is off. */
  async setConfiguration(
    configuration: RemoteAccessConfiguration,
    persist: () => Promise<void>,
  ): Promise<boolean> {
    if (
      this.shuttingDown
      || this.transitionTask !== undefined
      || this.configurationTask !== undefined
      || this.active === undefined
      || this.active.mode !== 'loopback'
    ) return false
    const task = (async () => {
      await persist()
      this.configuration = configuration
      return true
    })()
    this.configurationTask = task
    try {
      return await task
    } finally {
      if (this.configurationTask === task) this.configurationTask = undefined
    }
  }

  /**
   * Change backend exposure exactly once; concurrent requests are rejected.
   * @param enabled - true for the preferred remote transport, false for loopback-only access.
   * @returns the result and any loopback URL that the desktop window must load.
   */
  async setEnabled(enabled: boolean): Promise<RemoteAccessTransitionResult> {
    if (
      this.shuttingDown
      || this.transitionTask !== undefined
      || this.configurationTask !== undefined
      || this.active === undefined
    ) {
      return { succeeded: false }
    }
    const requested: WebBackendMode = enabled ? this.configuration.mode : 'loopback'
    if (this.active.mode === requested) return { succeeded: true }
    if (requested === 'frp' && (this.options.platform ?? process.platform) === 'win32') {
      this.reportFailure(new Error(
        'FRP remote access is not supported on Windows because complete WebUI and frpc process-tree ownership is not available.',
      ), false)
      return { succeeded: false }
    }
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
      await Promise.allSettled([this.transitionTask, this.configurationTask])
      await this.stopOwnedRuntime()
      this.active = undefined
    })()
    this.shutdownTask = task
    void task.catch(() => {
      if (this.shutdownTask === task) this.shutdownTask = undefined
    })
    return task
  }

  private async startMode(mode: WebBackendMode): Promise<WebBackendLocation> {
    const trustedAuthority = mode === 'frp'
      ? frpTrustedAuthority(this.configuration.frp)
      : undefined
    const location = await this.options.backend.start(
      mode,
      this.options.cwd,
      (code, signal) => {
        this.active = undefined
        this.options.onUnexpectedExit(code, signal)
      },
      this.options.pickDirectory,
      trustedAuthority,
    )
    if (mode === 'lan' && location.remoteAccessUrl === undefined) {
      throw new Error('the Host has no reachable external IPv4 address')
    }
    if (mode === 'frp') {
      const token = location.remoteAccessToken
      const rendererToken = location.rendererAccessToken
      const localPort = Number(location.loopbackUrl.port)
      if (
        token === undefined
        || rendererToken === undefined
        || token === rendererToken
        || !Number.isInteger(localPort)
        || localPort < 1
      ) {
        throw new Error('the FRP WebUI did not publish distinct remote and local access tokens')
      }
      const remotePort = await this.options.frpc.start(
        this.configuration.frp,
        localPort,
        (error) => { this.recoverUnexpectedFrpcExit(error) },
      )
      location.remoteAccessUrl = formatRemoteAccessUrl(
        frpPublicOrigin(this.configuration.frp, remotePort),
        token,
      )
    }
    return location
  }

  private reportFailure(error: Error, fatal: boolean, navigationUrl?: URL): void {
    try {
      this.options.onTransitionError(error, fatal, navigationUrl)
    } catch (reportError) {
      console.error('Failed to report an Electron remote-access transition error.', reportError)
    }
  }

  private async switchMode(requested: WebBackendMode): Promise<RemoteAccessTransitionResult> {
    const previous = this.active
    if (previous === undefined) return { succeeded: false }
    try {
      await this.stopOwnedRuntime()
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
      await this.stopOwnedRuntime()
      const location = await this.startMode(previous.mode)
      this.active = { location, mode: previous.mode }
      this.reportFailure(transitionFailure(requested, failure, { restored: true }), false)
      return { succeeded: false, navigationUrl: location.loopbackUrl }
    } catch (rollbackError) {
      this.active = undefined
      try {
        await this.stopOwnedRuntime()
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

  private async stopOwnedRuntime(): Promise<void> {
    const failures: unknown[] = []
    try {
      await this.options.frpc.stop()
    } catch (error) {
      failures.push(error)
    }
    try {
      await this.options.backend.stop()
    } catch (error) {
      failures.push(error)
    }
    if (failures.length === 1) throw failures[0]
    if (failures.length > 1) throw new AggregateError(failures, 'Electron remote-access cleanup failed')
  }

  private recoverUnexpectedFrpcExit(error: Error): void {
    if (
      this.shuttingDown
      || this.transitionTask !== undefined
      || this.active?.mode !== 'frp'
    ) return
    const task = (async (): Promise<RemoteAccessTransitionResult> => {
      try {
        await this.stopOwnedRuntime()
        const location = await this.startMode('loopback')
        this.active = { location, mode: 'loopback' }
        this.reportFailure(
          new Error(`The FRP tunnel stopped unexpectedly: ${errorMessage(error)} Remote access was disabled.`),
          false,
          location.loopbackUrl,
        )
        return { succeeded: false, navigationUrl: location.loopbackUrl }
      } catch (recoveryError) {
        this.active = undefined
        try {
          await this.stopOwnedRuntime()
        } catch (cleanupError) {
          recoveryError = new AggregateError(
            [recoveryError, cleanupError],
            'FRP recovery and cleanup both failed',
          )
        }
        this.reportFailure(
          new Error(
            `The FRP tunnel stopped unexpectedly: ${errorMessage(error)} `
            + `Restoring loopback mode failed: ${errorMessage(recoveryError)}`,
          ),
          true,
        )
        return { succeeded: false }
      }
    })()
    this.transitionTask = task
    void task.finally(() => {
      if (this.transitionTask === task) this.transitionTask = undefined
    })
  }
}

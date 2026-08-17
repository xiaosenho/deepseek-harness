/** Background WebUI process ownership for the Electron main process. */

import { spawn, type ChildProcess } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ElectronDirectoryPickerBridge, type ElectronDirectoryPickerHandler } from './directory-picker-bridge.ts'
import { linkWebKernelPlugins } from './web-kernel-plugins.ts'
import { formatRemoteAccessUrl } from './remote-access.ts'
import { LineBuffer, parseReadyUrls } from './readiness.ts'
import { signalProcessTree, stopProcessTree } from './process-tree.ts'

const STARTUP_TIMEOUT_MS = 45_000
const ERROR_DETAIL_LIMIT = 4_096

/** Resolve the packaged dsh CLI without requiring a package main export. */
function resolveDshBin(): string {
  const require = createRequire(import.meta.url)
  return join(dirname(require.resolve('@deepseek-ai/dsh/package.json')), 'lib', 'bin.js')
}

/** Resolve the Electron-owned native and remote-browse directory-picker overlay. */
function resolveElectronOverlay(): string {
  return fileURLToPath(new URL('../resources/electron-directory-picker.cordis.patch.yml', import.meta.url))
}

/** Resolve the overlay that exposes the Electron-owned Web profile to LAN clients. */
function resolveLanAccessOverlay(): string {
  return fileURLToPath(new URL('../resources/lan-access.cordis.patch.yml', import.meta.url))
}

/** Resolve the overlay that keeps an FRP-forwarded WebUI on loopback. */
function resolveReverseAccessOverlay(): string {
  return fileURLToPath(new URL('../resources/reverse-access.cordis.patch.yml', import.meta.url))
}

/** Resolve the overlay that confines the Electron-owned Web profile to loopback. */
function resolveLoopbackAccessOverlay(): string {
  return fileURLToPath(new URL('../resources/loopback-access.cordis.patch.yml', import.meta.url))
}

/** Resolve the overlay that mounts the desktop-only Settings contributions. */
function resolveDesktopUiOverlay(): string {
  return fileURLToPath(new URL('../resources/desktop-ui.cordis.patch.yml', import.meta.url))
}

/** Network exposure selected for one Electron-owned WebUI process. */
export type WebBackendMode = 'loopback' | 'lan' | 'frp'

/**
 * Build the packaged CLI arguments for the Electron-owned WebUI.
 * @param platform - operating system running the desktop host.
 * @param mode - loopback-only, authenticated LAN, or loopback-forwarded FRP exposure.
 * @param dshBin - resolved packaged CLI entry.
 * @returns arguments passed to the Electron executable in Node mode.
 */
export function buildBackendArgs(
  platform: NodeJS.Platform,
  mode: WebBackendMode,
  dshBin = resolveDshBin(),
): string[] {
  const networkOverlay = mode === 'lan'
    ? resolveLanAccessOverlay()
    : mode === 'frp'
      ? resolveReverseAccessOverlay()
      : resolveLoopbackAccessOverlay()
  void platform
  const electronOverlay = resolveElectronOverlay()
  const desktopUiOverlay = resolveDesktopUiOverlay()
  return [
    '--expose-internals',
    dshBin,
    'web',
    '--patch', electronOverlay,
    '--patch',
    networkOverlay,
    '--patch', desktopUiOverlay,
    '--port',
    '0',
  ]
}

/**
 * Generate one URL-safe 72-bit credential for an Electron-owned WebUI launch.
 * @returns a 12-character base64url token.
 */
export function createRemoteAccessToken(): string {
  return randomBytes(9).toString('base64url')
}

/** Ready addresses for one Electron-owned WebUI process. */
export interface WebBackendLocation {
  /** Loopback address loaded by the Electron renderer. */
  loopbackUrl: URL
  /** Token-bearing address shown for access from a remote browser. */
  remoteAccessUrl?: URL
  /** Main-process-only bearer used to derive an FRP public URL. */
  remoteAccessToken?: string
  /** Main-process-only bearer required from the local renderer while FRP is active. */
  rendererAccessToken?: string
}

interface WebBackendRun {
  child: ChildProcess
  directoryPickerBridge: ElectronDirectoryPickerBridge
  directoryPickerStop?: Promise<void>
  stopping: boolean
  stopTask?: Promise<void>
}

interface WebBackendOptions {
  /** Complete process-tree cleanup overridden by lifecycle tests. */
  stopTree?: typeof stopProcessTree
  /** Profile plugin-link step overridden by lifecycle tests. */
  linkPlugins?: (home?: string) => void
}

function stopDirectoryPicker(run: WebBackendRun): Promise<void> {
  run.directoryPickerStop ??= run.directoryPickerBridge.stop()
  return run.directoryPickerStop
}

function backendEnvironment(
  remoteAccessToken: string | undefined,
  loopbackAccessToken: string | undefined,
  trustedAuthority: string | undefined,
): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env, ELECTRON_RUN_AS_NODE: '1' }
  delete env.DSH_ELECTRON_REMOTE_ACCESS_TOKEN
  delete env.DSH_ELECTRON_LOOPBACK_ACCESS_TOKEN
  delete env.DSH_ELECTRON_REMOTE_ACCESS_AUTHORITY
  if (remoteAccessToken !== undefined) env.DSH_ELECTRON_REMOTE_ACCESS_TOKEN = remoteAccessToken
  if (loopbackAccessToken !== undefined) env.DSH_ELECTRON_LOOPBACK_ACCESS_TOKEN = loopbackAccessToken
  if (trustedAuthority !== undefined) env.DSH_ELECTRON_REMOTE_ACCESS_AUTHORITY = trustedAuthority
  return env
}

/** Owns the background WebUI command from readiness through shutdown. */
export class WebBackend {
  private run: WebBackendRun | undefined

  /** @param options - process-tree integration overridden by lifecycle tests. */
  constructor(private readonly options: WebBackendOptions = {}) {}

  /**
   * Start the configured WebUI command and wait for its readiness line.
   * @param mode - loopback-only, authenticated LAN, or loopback-forwarded FRP exposure.
   * @param cwd - working directory used by the command and Harness tools.
   * @param onUnexpectedExit - called after cleanup succeeds or its failure is logged.
   * @param pickDirectory - native directory dialog owned by the Electron main process.
   * @returns the loopback renderer URL and optional token-bearing remote-access URL.
   */
  async start(
    mode: WebBackendMode,
    cwd: string,
    onUnexpectedExit: (code: number | null, signal: NodeJS.Signals | null) => void,
    pickDirectory: ElectronDirectoryPickerHandler,
    trustedAuthority?: string,
  ): Promise<WebBackendLocation> {
    if (this.run !== undefined) throw new Error('Electron WebUI command is already running')
    if (mode === 'frp' && trustedAuthority === undefined) {
      throw new Error('FRP WebUI requires a trusted public authority')
    }
    const remoteAccessToken = mode === 'loopback' ? undefined : createRemoteAccessToken()
    let loopbackAccessToken: string | undefined
    if (mode === 'frp') {
      do {
        loopbackAccessToken = createRemoteAccessToken()
      } while (loopbackAccessToken === remoteAccessToken)
    }
    // The Loader resolves plugin names from the kernel profile; link the
    // shell's vendor plugins into the profile fallback before the boot.
    ;(this.options.linkPlugins ?? linkWebKernelPlugins)()
    const child = spawn(process.execPath, buildBackendArgs(process.platform, mode), {
      cwd,
      env: backendEnvironment(remoteAccessToken, loopbackAccessToken, trustedAuthority),
      stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
      detached: process.platform !== 'win32',
      windowsHide: true,
    })
    const stdout = child.stdout
    const stderrStream = child.stderr
    if (stdout === null || stderrStream === null) {
      signalProcessTree(child, 'SIGKILL')
      throw new Error('Electron WebUI command has no output pipes')
    }
    let directoryPickerBridge: ElectronDirectoryPickerBridge
    try {
      directoryPickerBridge = new ElectronDirectoryPickerBridge(child, pickDirectory)
    } catch (error: unknown) {
      signalProcessTree(child, 'SIGKILL')
      throw error
    }
    const run: WebBackendRun = { child, directoryPickerBridge, stopping: false }
    this.run = run

    return await new Promise<WebBackendLocation>((resolve, reject) => {
      let ready = false
      let stderr = ''
      const lines = new LineBuffer()
      const timer = setTimeout(() => {
        void this.stop()
        reject(new Error(`WebUI did not become ready within ${String(STARTUP_TIMEOUT_MS / 1_000)} seconds`))
      }, STARTUP_TIMEOUT_MS)

      stdout.on('data', (chunk: Buffer | string) => {
        const text = String(chunk)
        process.stdout.write(text)
        for (const line of lines.push(text)) {
          const urls = parseReadyUrls(line)
          if (urls === undefined || ready) continue
          ready = true
          clearTimeout(timer)
          resolve({
            loopbackUrl: urls.loopbackUrl,
            ...mode !== 'frp' || remoteAccessToken === undefined ? {} : { remoteAccessToken },
            ...mode !== 'frp' || loopbackAccessToken === undefined
              ? {}
              : { rendererAccessToken: loopbackAccessToken },
            ...urls.lanUrl === undefined || remoteAccessToken === undefined
              ? {}
              : { remoteAccessUrl: formatRemoteAccessUrl(urls.lanUrl, remoteAccessToken) },
          })
        }
      })
      stderrStream.on('data', (chunk: Buffer | string) => {
        const text = String(chunk)
        process.stderr.write(text)
        stderr = `${stderr}${text}`.slice(-ERROR_DETAIL_LIMIT)
      })
      child.once('error', (error) => {
        clearTimeout(timer)
        void this.cleanupRun(run).then(
          () => {
            if (!ready) reject(error)
          },
          (cleanupError: unknown) => {
            if (!ready) {
              reject(new AggregateError(
                [error, cleanupError],
                'WebUI startup and cleanup both failed',
              ))
            } else {
              console.error('WebUI process-tree cleanup failed after a child-process error.', cleanupError)
            }
          },
        )
      })
      child.once('exit', (code, signal) => {
        clearTimeout(timer)
        if (!ready) {
          const detail = stderr.trim()
          const failure = new Error(
            `WebUI command exited with code ${String(code)}${detail === '' ? '' : `\n\n${detail}`}`,
          )
          void this.cleanupRun(run).then(
            () => { reject(failure) },
            (cleanupError: unknown) => {
              reject(new AggregateError(
                [failure, cleanupError],
                'WebUI startup and cleanup both failed',
              ))
            },
          )
        } else if (!run.stopping) {
          void this.finishUnexpectedExit(run, code, signal, onUnexpectedExit)
        }
      })
    })
  }

  /**
   * Stop the owned WebUI command and wait until it exits.
   * @returns the shared bounded attempt; a later call starts a new attempt after failure.
   */
  stop(): Promise<void> {
    const run = this.run
    if (run === undefined) return Promise.resolve()
    run.stopping = true
    return this.cleanupRun(run)
  }

  private cleanupRun(run: WebBackendRun): Promise<void> {
    if (run.stopTask !== undefined) return run.stopTask
    const stopTree = this.options.stopTree ?? stopProcessTree
    const task = (async () => {
      await stopDirectoryPicker(run)
      await stopTree(run.child, 'WebUI')
    })()
    run.stopTask = task
    void task.then(
      () => {
        if (this.run === run) this.run = undefined
      },
      () => {
        if (run.stopTask === task) delete run.stopTask
      },
    )
    return task
  }

  private async finishUnexpectedExit(
    run: WebBackendRun,
    code: number | null,
    signal: NodeJS.Signals | null,
    report: (code: number | null, signal: NodeJS.Signals | null) => void,
  ): Promise<void> {
    try {
      await this.cleanupRun(run)
    } catch (cleanupError) {
      console.error('WebUI process-tree cleanup failed after an unexpected exit.', cleanupError)
    }
    try {
      report(code, signal)
    } catch (reportError) {
      console.error('Failed to report an unexpected WebUI exit.', reportError)
    }
  }
}

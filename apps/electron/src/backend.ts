/** Background WebUI process ownership for the Electron main process. */

import { spawn, spawnSync, type ChildProcess } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ElectronDirectoryPickerBridge, type ElectronDirectoryPickerHandler } from './directory-picker-bridge.ts'
import { formatRemoteAccessUrl } from './remote-access.ts'
import { LineBuffer, parseReadyUrls } from './readiness.ts'

const STARTUP_TIMEOUT_MS = 45_000
const SHUTDOWN_GRACE_MS = 3_000
const ERROR_DETAIL_LIMIT = 4_096

/** Resolve the packaged dsh CLI without requiring a package main export. */
function resolveDshBin(): string {
  const require = createRequire(import.meta.url)
  return join(dirname(require.resolve('@deepseek-ai/dsh/package.json')), 'lib', 'bin.js')
}

/** Resolve the Electron-owned Web profile overlay for one platform. */
function resolvePlatformOverlay(platform: NodeJS.Platform): string | undefined {
  if (platform !== 'win32') return undefined
  return fileURLToPath(new URL('../resources/windows-directory-picker.cordis.patch.yml', import.meta.url))
}

/** Resolve the overlay that exposes the Electron-owned Web profile to LAN clients. */
function resolveLanAccessOverlay(): string {
  return fileURLToPath(new URL('../resources/lan-access.cordis.patch.yml', import.meta.url))
}

/** Resolve the overlay that confines the Electron-owned Web profile to loopback. */
function resolveLoopbackAccessOverlay(): string {
  return fileURLToPath(new URL('../resources/loopback-access.cordis.patch.yml', import.meta.url))
}

/** Network exposure selected for one Electron-owned WebUI process. */
export type WebBackendMode = 'loopback' | 'lan'

/**
 * Build the packaged CLI arguments for the Electron-owned WebUI.
 * @param platform - operating system running the desktop host.
 * @param mode - loopback-only or authenticated LAN exposure.
 * @param dshBin - resolved packaged CLI entry.
 * @returns arguments passed to the Electron executable in Node mode.
 */
export function buildBackendArgs(
  platform: NodeJS.Platform,
  mode: WebBackendMode,
  dshBin = resolveDshBin(),
): string[] {
  const networkOverlay = mode === 'lan' ? resolveLanAccessOverlay() : resolveLoopbackAccessOverlay()
  const platformOverlay = resolvePlatformOverlay(platform)
  return [
    '--expose-internals',
    dshBin,
    'web',
    ...(platformOverlay === undefined ? [] : ['--patch', platformOverlay]),
    '--patch',
    networkOverlay,
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
}

interface WebBackendRun {
  child: ChildProcess
  directoryPickerBridge: ElectronDirectoryPickerBridge
  directoryPickerStop?: Promise<void>
  stopping: boolean
  stopTask?: Promise<void>
}

function stopDirectoryPicker(run: WebBackendRun): Promise<void> {
  run.directoryPickerStop ??= run.directoryPickerBridge.stop()
  return run.directoryPickerStop
}

function backendEnvironment(remoteAccessToken: string | undefined): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env, ELECTRON_RUN_AS_NODE: '1' }
  delete env.DSH_ELECTRON_REMOTE_ACCESS_TOKEN
  if (remoteAccessToken !== undefined) env.DSH_ELECTRON_REMOTE_ACCESS_TOKEN = remoteAccessToken
  return env
}

function signalTree(child: ChildProcess, signal: 'SIGTERM' | 'SIGKILL'): void {
  const pid = child.pid
  if (pid === undefined) return
  if (process.platform === 'win32') {
    spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true })
    return
  }
  try {
    process.kill(-pid, signal)
  } catch {
    // Exit can race either shutdown tier; an absent process group is already quiescent.
  }
}

function treeIsAlive(child: ChildProcess): boolean {
  const pid = child.pid
  if (pid === undefined) return false
  if (process.platform === 'win32') return child.exitCode === null && child.signalCode === null
  try {
    process.kill(-pid, 0)
    return true
  } catch {
    return false
  }
}

async function waitForTreeExit(child: ChildProcess, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs
  while (treeIsAlive(child)) {
    if (Date.now() >= deadline) return false
    await new Promise(resolve => setTimeout(resolve, 25))
  }
  return true
}

/** Owns the background WebUI command from readiness through shutdown. */
export class WebBackend {
  private run: WebBackendRun | undefined

  /**
   * Start the configured WebUI command and wait for its readiness line.
   * @param mode - loopback-only or authenticated LAN exposure.
   * @param cwd - working directory used by the command and Harness tools.
   * @param onUnexpectedExit - called when a ready command exits before desktop shutdown.
   * @param pickDirectory - native directory dialog owned by the Electron main process.
   * @returns the loopback renderer URL and optional token-bearing remote-access URL.
   */
  async start(
    mode: WebBackendMode,
    cwd: string,
    onUnexpectedExit: (code: number | null, signal: NodeJS.Signals | null) => void,
    pickDirectory: ElectronDirectoryPickerHandler,
  ): Promise<WebBackendLocation> {
    if (this.run !== undefined) throw new Error('Electron WebUI command is already running')
    const remoteAccessToken = mode === 'lan' ? createRemoteAccessToken() : undefined
    const child = spawn(process.execPath, buildBackendArgs(process.platform, mode), {
      cwd,
      env: backendEnvironment(remoteAccessToken),
      stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
      detached: process.platform !== 'win32',
      windowsHide: true,
    })
    const stdout = child.stdout
    const stderrStream = child.stderr
    if (stdout === null || stderrStream === null) {
      signalTree(child, 'SIGKILL')
      throw new Error('Electron WebUI command has no output pipes')
    }
    let directoryPickerBridge: ElectronDirectoryPickerBridge
    try {
      directoryPickerBridge = new ElectronDirectoryPickerBridge(child, pickDirectory)
    } catch (error: unknown) {
      signalTree(child, 'SIGKILL')
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
        void stopDirectoryPicker(run).finally(() => {
          if (this.run === run) this.run = undefined
        })
        clearTimeout(timer)
        if (!ready) reject(error)
      })
      child.once('exit', (code, signal) => {
        void stopDirectoryPicker(run).finally(() => {
          if (this.run === run) this.run = undefined
        })
        clearTimeout(timer)
        if (!ready) {
          const detail = stderr.trim()
          reject(new Error(`WebUI command exited with code ${String(code)}${detail === '' ? '' : `\n\n${detail}`}`))
        } else if (!run.stopping) {
          onUnexpectedExit(code, signal)
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
    if (run.stopTask !== undefined) return run.stopTask
    run.stopping = true
    const task = (async () => {
      await stopDirectoryPicker(run)
      signalTree(run.child, 'SIGTERM')
      if (!await waitForTreeExit(run.child, SHUTDOWN_GRACE_MS)) {
        signalTree(run.child, 'SIGKILL')
        if (!await waitForTreeExit(run.child, SHUTDOWN_GRACE_MS)) {
          throw new Error('WebUI process tree did not stop after SIGKILL')
        }
      }
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
}

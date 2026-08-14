/** Background WebUI process ownership for the Electron main process. */

import { spawn, spawnSync, type ChildProcess } from 'node:child_process'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { LineBuffer, parseReadyUrl } from './readiness.ts'

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

/**
 * Build the packaged CLI arguments for the Electron-owned WebUI.
 * @param platform - operating system running the desktop host.
 * @param dshBin - resolved packaged CLI entry.
 * @returns arguments passed to the Electron executable in Node mode.
 */
export function buildBackendArgs(platform: NodeJS.Platform, dshBin = resolveDshBin()): string[] {
  const overlay = resolvePlatformOverlay(platform)
  return [
    '--expose-internals',
    dshBin,
    'web',
    ...(overlay === undefined ? [] : ['--patch', overlay]),
    '--host',
    '127.0.0.1',
    '--port',
    '0',
  ]
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
  private child: ChildProcess | undefined
  private stopping = false

  /**
   * Start the configured WebUI command and wait for its readiness line.
   * @param cwd - working directory used by the command and Harness tools.
   * @param onUnexpectedExit - called when a ready command exits before desktop shutdown.
   * @returns the loopback URL announced by `dsh web`.
   */
  async start(
    cwd: string,
    onUnexpectedExit: (code: number | null, signal: NodeJS.Signals | null) => void,
  ): Promise<URL> {
    if (this.child !== undefined) throw new Error('Electron WebUI command is already running')
    this.stopping = false
    const child = spawn(process.execPath, buildBackendArgs(process.platform), {
      cwd,
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: process.platform !== 'win32',
      windowsHide: true,
    })
    this.child = child

    return await new Promise<URL>((resolve, reject) => {
      let ready = false
      let stderr = ''
      const lines = new LineBuffer()
      const timer = setTimeout(() => {
        void this.stop()
        reject(new Error(`WebUI did not become ready within ${String(STARTUP_TIMEOUT_MS / 1_000)} seconds`))
      }, STARTUP_TIMEOUT_MS)

      child.stdout.on('data', (chunk: Buffer | string) => {
        const text = String(chunk)
        process.stdout.write(text)
        for (const line of lines.push(text)) {
          const url = parseReadyUrl(line)
          if (url === undefined || ready) continue
          ready = true
          clearTimeout(timer)
          resolve(url)
        }
      })
      child.stderr.on('data', (chunk: Buffer | string) => {
        const text = String(chunk)
        process.stderr.write(text)
        stderr = `${stderr}${text}`.slice(-ERROR_DETAIL_LIMIT)
      })
      child.once('error', (error) => {
        this.child = undefined
        clearTimeout(timer)
        if (!ready) reject(error)
      })
      child.once('exit', (code, signal) => {
        this.child = undefined
        clearTimeout(timer)
        if (!ready) {
          const detail = stderr.trim()
          reject(new Error(`WebUI command exited with code ${String(code)}${detail === '' ? '' : `\n\n${detail}`}`))
        } else if (!this.stopping) {
          onUnexpectedExit(code, signal)
        }
      })
    })
  }

  /** Stop the owned WebUI command and wait until it exits. */
  async stop(): Promise<void> {
    const child = this.child
    if (child === undefined) return
    this.stopping = true
    signalTree(child, 'SIGTERM')
    if (await waitForTreeExit(child, SHUTDOWN_GRACE_MS)) return
    signalTree(child, 'SIGKILL')
    if (!await waitForTreeExit(child, SHUTDOWN_GRACE_MS)) {
      throw new Error('WebUI process tree did not stop after SIGKILL')
    }
  }
}

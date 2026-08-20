/** Background WebUI process ownership for the Electron main process. */

import { spawn, type ChildProcess } from 'node:child_process'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { ensureDesktopPath, prependRuntimePath } from './runtime.ts'
import { LineBuffer, parseReadyUrls } from './readiness.ts'
import { signalProcessTree, stopProcessTree } from './process-tree.ts'

const STARTUP_TIMEOUT_MS = 45_000
const ERROR_DETAIL_LIMIT = 4_096

/** Resolve the packaged dsh CLI without requiring a package main export. */
export function resolveDshBin(): string {
  const require = createRequire(import.meta.url)
  return join(dirname(require.resolve('@deepseek-ai/dsh/package.json')), 'lib', 'bin.js')
}

/**
 * Build the packaged CLI arguments for the Electron-owned WebUI.
 * @param dshBin - resolved packaged CLI entry.
 * @returns arguments passed to the Electron executable in Node mode.
 */
export function buildBackendArgs(dshBin = resolveDshBin()): string[] {
  return [
    '--expose-internals',
    dshBin,
    'web',
    '--host', '127.0.0.1',
    '--port', '0',
    // Electron owns a self-drawn window; never hand off to the default browser.
    '--no-open',
  ]
}

/** Ready address for one Electron-owned WebUI process. */
export interface WebBackendLocation {
  /** Loopback address loaded by the Electron renderer. */
  loopbackUrl: URL
}

interface WebBackendRun {
  child: ChildProcess
  stopping: boolean
  stopTask?: Promise<void>
}

interface WebBackendOptions {
  /** Complete process-tree cleanup overridden by lifecycle tests. */
  stopTree?: typeof stopProcessTree
}

/** Owns the background WebUI command from readiness through shutdown. */
export class WebBackend {
  private run: WebBackendRun | undefined

  /** @param options - process-tree integration overridden by lifecycle tests. */
  constructor(private readonly options: WebBackendOptions = {}) {}

  /**
   * Start the configured WebUI command and wait for its readiness line.
   * @param cwd - working directory used by the command and Harness tools.
   * @param onUnexpectedExit - called after cleanup succeeds or its failure is logged.
   * @returns the loopback renderer URL.
   */
  async start(
    cwd: string,
    onUnexpectedExit: (code: number | null, signal: NodeJS.Signals | null) => void,
    runtimeBinDir?: string,
  ): Promise<WebBackendLocation> {
    if (this.run !== undefined) throw new Error('Electron WebUI command is already running')

    const child = spawn(process.execPath, buildBackendArgs(), {
      cwd,
      env: prependRuntimePath(ensureDesktopPath({ ...process.env, ELECTRON_RUN_AS_NODE: '1' }), runtimeBinDir ?? ''),
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: process.platform !== 'win32',
      windowsHide: true,
    })
    const stdout = child.stdout
    const stderrStream = child.stderr
    if (stdout === null || stderrStream === null) {
      signalProcessTree(child, 'SIGKILL')
      throw new Error('Electron WebUI command has no output pipes')
    }
    const run: WebBackendRun = { child, stopping: false }
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
          resolve({ loopbackUrl: urls.loopbackUrl })
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
            if (ready === false) reject(error)
          },
          (cleanupError: unknown) => {
            if (ready === false) {
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
        if (ready === false) {
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
        } else if (run.stopping === false) {
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

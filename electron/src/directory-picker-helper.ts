/** Abortable Electron helper process that owns one native directory dialog. */

import { spawn, spawnSync, type ChildProcess, type SpawnOptions } from 'node:child_process'

/** Private argv marker selecting the directory-dialog-only Electron entry path. */
export const DIRECTORY_PICKER_HELPER_ARGUMENT = '--dsh-directory-picker-helper'

const OUTPUT_PREFIX = 'dsh electron directory picker: '
const OUTPUT_LIMIT = 8_192
const HELPER_CLOSE_GRACE_MS = 5_000

/** Result emitted by the dedicated Electron dialog helper. */
export type DirectoryPickerHelperOutcome =
  | { kind: 'picked'; path: string }
  | { kind: 'cancelled' }
  | { kind: 'failed'; message: string }

/** Facts needed to relaunch this Electron application in helper mode. */
export interface DirectoryPickerHelperLaunch {
  /** Current Electron executable. */
  execPath: string
  /** Unpackaged application directory passed to the Electron executable. */
  applicationPath: string
  /** Whether the current Electron application is packaged. */
  packaged: boolean
  /** Host platform, injectable for deterministic process-option tests. */
  platform?: NodeJS.Platform
}

/** Testable process boundaries for the helper driver. */
export interface DirectoryPickerHelperInternals {
  /** Replaces `child_process.spawn`. */
  spawnProcess?: (command: string, args: readonly string[], options: SpawnOptions) => ChildProcess
  /** Replaces process-tree termination on abort. */
  terminateProcessTree?: (child: ChildProcess, platform: NodeJS.Platform) => void
}

/** Encode the one-line helper protocol carried over stdout. */
export function encodeDirectoryPickerHelperOutcome(outcome: DirectoryPickerHelperOutcome): string {
  return `${OUTPUT_PREFIX}${JSON.stringify(outcome)}`
}

/** Parse one exact helper-protocol line, ignoring unrelated Electron output. */
export function parseDirectoryPickerHelperOutcome(line: string): DirectoryPickerHelperOutcome | undefined {
  if (!line.startsWith(OUTPUT_PREFIX)) return undefined
  let value: unknown
  try {
    value = JSON.parse(line.slice(OUTPUT_PREFIX.length))
  } catch {
    return undefined
  }
  if (typeof value !== 'object' || value === null) return undefined
  const record = value as Record<string, unknown>
  const keys = Object.keys(record)
  if (record.kind === 'picked' && keys.length === 2 && typeof record.path === 'string' && record.path !== '') {
    return { kind: 'picked', path: record.path }
  }
  if (record.kind === 'cancelled' && Object.keys(record).length === 1) return { kind: 'cancelled' }
  if (record.kind === 'failed' && keys.length === 2 && typeof record.message === 'string' && record.message !== '') {
    return { kind: 'failed', message: record.message }
  }
  return undefined
}

function errorOf(reason: unknown): Error {
  return reason instanceof Error ? reason : new Error(String(reason))
}

function terminateProcessTree(child: ChildProcess, platform: NodeJS.Platform): void {
  const pid = child.pid
  if (pid === undefined) return
  if (platform === 'win32') {
    const result = spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], {
      stdio: 'ignore',
      timeout: HELPER_CLOSE_GRACE_MS,
      windowsHide: true,
    })
    if (result.error !== undefined) {
      throw new Error('Electron directory picker helper taskkill failed', { cause: result.error })
    }
    if (result.status !== 0) {
      throw new Error(`Electron directory picker helper taskkill exited with status ${String(result.status)}`)
    }
    return
  }
  try {
    process.kill(-pid, 'SIGKILL')
  } catch {
    // The helper can exit between the abort edge and process-group signal.
  }
}

/**
 * Open one native directory dialog in a dedicated Electron process.
 * @param signal - caller lifetime; abort terminates the complete helper tree.
 * @param launch - executable and packaging facts for this application.
 * @param internals - process hooks for deterministic tests.
 * @returns the selected directory, or null when the operator cancels.
 */
export async function pickElectronDirectory(
  signal: AbortSignal,
  launch: DirectoryPickerHelperLaunch,
  internals: DirectoryPickerHelperInternals = {},
): Promise<string | null> {
  if (signal.aborted) throw errorOf(signal.reason)
  const platform = launch.platform ?? process.platform
  const spawnProcess = internals.spawnProcess ?? spawn
  const stopTree = internals.terminateProcessTree ?? terminateProcessTree
  const args = launch.packaged
    ? [DIRECTORY_PICKER_HELPER_ARGUMENT]
    : [launch.applicationPath, DIRECTORY_PICKER_HELPER_ARGUMENT]
  const child = spawnProcess(launch.execPath, args, {
    detached: platform !== 'win32',
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  })
  const stdoutStream = child.stdout
  const stderrStream = child.stderr
  if (stdoutStream === null || stderrStream === null) {
    stopTree(child, platform)
    throw new Error('Electron directory picker helper has no output pipes')
  }

  return await new Promise<string | null>((resolve, reject) => {
    let stdout = ''
    let stderr = ''
    let settled = false
    let terminationTimer: ReturnType<typeof setTimeout> | undefined
    let terminationError: Error | undefined

    const settle = (outcome: () => void): void => {
      if (settled) return
      settled = true
      if (terminationTimer !== undefined) clearTimeout(terminationTimer)
      signal.removeEventListener('abort', onAbort)
      outcome()
    }
    const killDirectly = (): Error | undefined => {
      try {
        return child.kill('SIGKILL')
          ? undefined
          : new Error('Electron directory picker helper direct kill reported failure')
      } catch (error: unknown) {
        return errorOf(error)
      }
    }
    const onAbort = (): void => {
      try {
        stopTree(child, platform)
      } catch (error: unknown) {
        terminationError = errorOf(error)
        terminationError = killDirectly() ?? terminationError
      }
      if (settled) return
      terminationTimer = setTimeout(() => {
        const fallbackError = killDirectly()
        stdoutStream.destroy()
        stderrStream.destroy()
        child.unref()
        settle(() => {
          reject(new Error(
            `Electron directory picker helper did not exit within ${String(HELPER_CLOSE_GRACE_MS)} ms after cancellation`,
            { cause: fallbackError ?? terminationError ?? errorOf(signal.reason) },
          ))
        })
      }, HELPER_CLOSE_GRACE_MS)
    }

    stdoutStream.on('data', (chunk: Buffer | string) => {
      stdout = `${stdout}${String(chunk)}`.slice(-OUTPUT_LIMIT)
    })
    stderrStream.on('data', (chunk: Buffer | string) => {
      stderr = `${stderr}${String(chunk)}`.slice(-OUTPUT_LIMIT)
    })
    child.once('error', (error) => {
      if (signal.aborted) {
        terminationError = error
        return
      }
      settle(() => { reject(error) })
    })
    child.once('close', (code, exitSignal) => {
      settle(() => {
        if (signal.aborted) {
          reject(errorOf(signal.reason))
          return
        }
        const outcome = stdout.split(/\r?\n/)
          .map(parseDirectoryPickerHelperOutcome)
          .find(candidate => candidate !== undefined)
        if (outcome?.kind === 'picked') {
          resolve(outcome.path)
          return
        }
        if (outcome?.kind === 'cancelled') {
          resolve(null)
          return
        }
        if (outcome?.kind === 'failed') {
          reject(new Error(outcome.message))
          return
        }
        const detail = stderr.trim()
        reject(new Error(
          `Electron directory picker helper exited with code ${String(code)}`
          + (exitSignal === null ? '' : ` (${exitSignal})`)
          + (detail === '' ? '' : `: ${detail}`),
        ))
      })
    })
    signal.addEventListener('abort', onAbort, { once: true })
    if (signal.aborted) onAbort()
  })
}

async function writeHelperOutcome(outcome: DirectoryPickerHelperOutcome): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    process.stdout.write(`${encodeDirectoryPickerHelperOutcome(outcome)}\n`, (error) => {
      if (error === null || error === undefined) resolve()
      else reject(error)
    })
  })
}

/**
 * Run the dialog-only helper entry and emit its one protocol result.
 * @param pick - Electron dialog call owned by the helper main process.
 * @param write - output hook for deterministic tests.
 * @returns process exit code (zero for picked/cancelled, one for failure).
 */
export async function runDirectoryPickerHelper(
  pick: () => Promise<string | null>,
  write: (outcome: DirectoryPickerHelperOutcome) => Promise<void> = writeHelperOutcome,
): Promise<number> {
  try {
    const path = await pick()
    await write(path === null ? { kind: 'cancelled' } : { kind: 'picked', path })
    return 0
  } catch (error: unknown) {
    await write({ kind: 'failed', message: errorOf(error).message })
    return 1
  }
}

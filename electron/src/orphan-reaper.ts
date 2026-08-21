/**
 * Startup reaper for orphaned WebUI backend processes.
 *
 * The WebUI backend is spawned detached so the process tree can be signalled
 * as one group (see process-tree.ts). A normal or OTA-update exit stops the
 * tree through the exit barrier, but a hard kill of the Electron main process
 * (crash, SIGKILL, force-quit) leaves the detached backend running with no
 * parent to join — it becomes an orphan that keeps its session and its port.
 * Reaping happens at startup of the next instance, before a new backend is
 * spawned, and only targets processes whose command line matches this app's
 * own backend binary — never unrelated dsh runs.
 */

import { spawnSync, type SpawnSyncReturns } from 'node:child_process'

/** A process row from the host process table. */
export interface ProcessRow {
  pid: number
  ppid: number
  command: string
}

/** Reaper dependencies, injectable for tests. */
export interface OrphanReaperOptions {
  /** Command-line substring that identifies this app's backend binary (resolveDshBin()). */
  backendBinary: string
  /** Current main-process pid; a backend whose ppid equals it belongs to this instance. */
  ownPid: number
  /** Reads the process table; defaults to `ps -axo pid=,ppid=,command=`. */
  ps?: (args: readonly string[]) => string
  /** Sends one signal to one pid; defaults to process.kill. */
  signal?: (pid: number, signal: NodeJS.Signals) => void
}

/** Parse `ps -axo pid=,ppid=,command=` output into rows, skipping malformed lines. */
export function parseProcessTable(output: string): ProcessRow[] {
  const rows: ProcessRow[] = []
  for (const line of output.split('\n')) {
    const match = /^\s*(\d+)\s+(\d+)\s+(.+)$/.exec(line)
    if (match === null) continue
    // The pattern captured exactly three groups, so all three indices exist.
    rows.push({ pid: Number(match[1]), ppid: Number(match[2]), command: match[3]! })
  }
  return rows
}

/** Whether a row is an orphaned backend of this app: our binary, the web leaf, and no live parent of our own. */
export function isOrphanedBackend(row: ProcessRow, options: OrphanReaperOptions): boolean {
  if (row.ppid === options.ownPid) return false
  if (!row.command.includes(options.backendBinary)) return false
  // The GUI backend is the `dsh web` leaf with the Electron-only flags; a
  // bare `bin.js` in another role (CLI commands) is not our backend.
  return row.command.includes(' web ') && row.command.includes('--no-open')
}

/**
 * Reap orphaned WebUI backends left by a previously killed main process.
 * @param options - binary matcher, own pid, and injectable table reader / signal.
 * @returns the pids that were signalled for termination.
 */
export function reapOrphanedWebBackends(options: OrphanReaperOptions): number[] {
  const readTable = options.ps ?? ((args: readonly string[]) => {
    const result = spawnSync('ps', [...args], { encoding: 'utf8' }) as SpawnSyncReturns<string>
    return result.status === 0 ? result.stdout : ''
  })
  const sendSignal = options.signal ?? ((pid: number, signal: NodeJS.Signals) => process.kill(pid, signal))
  const reaped: number[] = []
  for (const row of parseProcessTable(readTable(['-axo', 'pid=,ppid=,command=']))) {
    if (!isOrphanedBackend(row, options)) continue
    try {
      sendSignal(row.pid, 'SIGTERM')
      reaped.push(row.pid)
    } catch {
      // The process may have exited between the table read and the signal; an
      // absent backend is already reaped.
    }
  }
  return reaped
}

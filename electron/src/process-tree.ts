/** Bounded process-tree termination shared by Electron-owned child runtimes. */

import { spawnSync, type ChildProcess, type SpawnSyncReturns } from 'node:child_process'

const SHUTDOWN_GRACE_MS = 3_000

function taskkillFailure(result: SpawnSyncReturns<Buffer>): Error | undefined {
  if (result.error !== undefined) return new Error(`taskkill could not start: ${result.error.message}`, { cause: result.error })
  if (result.status === 0) return undefined
  return new Error(`taskkill exited with status ${String(result.status)}${
    result.signal === null ? '' : ` from ${result.signal}`
  }`)
}

/** Send one shutdown tier to the complete child process tree. */
export function signalProcessTree(
  child: ChildProcess,
  signal: 'SIGTERM' | 'SIGKILL',
  platform: NodeJS.Platform = process.platform,
): void {
  const pid = child.pid
  if (pid === undefined) return
  if (platform === 'win32') {
    if (child.exitCode !== null || child.signalCode !== null) {
      throw new Error('taskkill cannot verify a process tree after its leader has exited')
    }
    const result = spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], { windowsHide: true })
    const failure = taskkillFailure(result)
    if (failure !== undefined) throw failure
    return
  }
  try {
    process.kill(-pid, signal)
  } catch {
    // Exit can race either shutdown tier; an absent process group is already quiescent.
  }
}

/** Whether the captured process tree can still retain work. */
function processTreeIsAlive(child: ChildProcess): boolean {
  const pid = child.pid
  if (pid === undefined) return false
  try {
    process.kill(-pid, 0)
    return true
  } catch {
    return false
  }
}

async function waitForProcessTreeExit(child: ChildProcess, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs
  while (processTreeIsAlive(child)) {
    if (Date.now() >= deadline) return false
    await new Promise(resolve => setTimeout(resolve, 25))
  }
  return true
}

/**
 * Terminate and join one complete process tree with bounded escalation.
 * @param child - captured process-tree leader.
 * @param label - diagnostic owner name.
 * @param platform - operating system whose process-tree primitive is used.
 */
export async function stopProcessTree(
  child: ChildProcess,
  label: string,
  platform: NodeJS.Platform = process.platform,
): Promise<void> {
  if (platform === 'win32') {
    // taskkill's verified result is the only available tree-wide signal.
    signalProcessTree(child, 'SIGKILL', platform)
    return
  }
  signalProcessTree(child, 'SIGTERM', platform)
  if (await waitForProcessTreeExit(child, SHUTDOWN_GRACE_MS)) return
  signalProcessTree(child, 'SIGKILL', platform)
  if (!await waitForProcessTreeExit(child, SHUTDOWN_GRACE_MS)) {
    throw new Error(`${label} process tree did not stop after SIGKILL`)
  }
}

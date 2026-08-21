import { describe, expect, it } from 'vitest'
import {
  isOrphanedBackend,
  parseProcessTable,
  reapOrphanedWebBackends,
  type OrphanReaperOptions,
} from '../src/orphan-reaper.ts'

const BACKEND = '/Applications/DeepSeek Harness.app/Contents/Resources/app/node_modules/@deepseek-ai/dsh/lib/bin.js'

const TABLE = [
  // our backend under a live main process — keep
  `112233 12211 ${BACKEND} web --host 127.0.0.1 --port 0 --no-open`,
  // orphaned backend of the previous instance — reap
  `112244 1 ${BACKEND} web --host 127.0.0.1 --port 0 --no-open`,
  // another user's dsh CLI run of the same binary — not a web leaf, keep
  `112255 1 ${BACKEND} plugin list`,
  // unrelated binary entirely — keep
  `112266 1 /usr/bin/some-daemon web --no-open`,
  // malformed row — skipped
  `not-a-row`,
].join('\n')

describe('parseProcessTable', () => {
  it('parses pid/ppid/command rows and skips malformed lines', () => {
    const rows = parseProcessTable(TABLE)
    expect(rows).toHaveLength(4)
    expect(rows[0]).toEqual({ pid: 112233, ppid: 12211, command: `${BACKEND} web --host 127.0.0.1 --port 0 --no-open` })
    expect(rows[1]!.ppid).toBe(1)
  })
})

describe('isOrphanedBackend', () => {
  const options: OrphanReaperOptions = { backendBinary: BACKEND, ownPid: 12211 }
  const rows = parseProcessTable(TABLE)

  it('keeps the backend owned by the current main process', () => {
    expect(isOrphanedBackend(rows[0]!, options)).toBe(false)
  })

  it('reaps a backend whose parent is gone (ppid 1)', () => {
    expect(isOrphanedBackend(rows[1]!, options)).toBe(true)
  })

  it('keeps non-web leaves of the same binary', () => {
    expect(isOrphanedBackend(rows[2]!, options)).toBe(false)
  })

  it('keeps unrelated binaries even with web-ish flags', () => {
    expect(isOrphanedBackend(rows[3]!, options)).toBe(false)
  })
})

describe('reapOrphanedWebBackends', () => {
  it('signals exactly the orphaned backend rows', () => {
    const signalled: Array<[number, NodeJS.Signals]> = []
    const options: OrphanReaperOptions = {
      backendBinary: BACKEND,
      ownPid: 12211,
      ps: () => TABLE,
      signal: (pid, signal) => signalled.push([pid, signal]),
    }
    expect(reapOrphanedWebBackends(options)).toEqual([112244])
    expect(signalled).toEqual([[112244, 'SIGTERM']])
  })

  it('tolerates a signal racing an already-exited process', () => {
    const options: OrphanReaperOptions = {
      backendBinary: BACKEND,
      ownPid: 12211,
      ps: () => TABLE,
      signal: () => { throw new Error('ESRCH') },
    }
    expect(reapOrphanedWebBackends(options)).toEqual([])
  })
})

import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  ensureDesktopPath,
  ensureRuntimeBinaries,
  prependRuntimePath,
  resolvePnpmCli,
} from '../src/runtime.ts'

const tempDirs: string[] = []

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe('bundled runtime', () => {
  it('resolves the pnpm CLI shipped with the Electron package', () => {
    expect(existsSync(resolvePnpmCli())).toBe(true)
    expect(resolvePnpmCli()).toContain(join('pnpm', 'bin', 'pnpm.cjs'))
  })

  it('adds missing desktop tool directories to PATH without duplicating entries', () => {
    const existing = '.'
    const env = ensureDesktopPath({ PATH: '/usr/bin:/bin' }, 'darwin', [existing, '/missing/bin'])
    expect(env.PATH).toBe(`${existing}:/usr/bin:/bin`)

    const unchanged = ensureDesktopPath({ PATH: `${existing}:/usr/bin` }, 'darwin', [existing])
    expect(unchanged.PATH).toBe(`${existing}:/usr/bin`)
  })

  it('prepends the runtime bin directory to PATH', () => {
    const env = prependRuntimePath({ PATH: '/usr/bin:/bin' }, '/tmp/runtime-bin', 'linux')
    expect(env.PATH).toBe('/tmp/runtime-bin:/usr/bin:/bin')

    const winEnv = prependRuntimePath({ Path: 'C:\\Windows' }, 'C:\\runtime-bin', 'win32')
    expect(winEnv.Path).toBe('C:\\runtime-bin;C:\\Windows')
  })

  it('creates executable node and pnpm shims', () => {
    const userData = mkdtempSync(join(tmpdir(), 'dsh-electron-runtime-'))
    tempDirs.push(userData)
    const binDir = ensureRuntimeBinaries('/tmp/electron', userData, 'linux')

    expect(existsSync(join(binDir, 'node'))).toBe(true)
    expect(existsSync(join(binDir, 'pnpm'))).toBe(true)
    expect(readFileSync(join(binDir, 'node'), 'utf8')).toContain('ELECTRON_RUN_AS_NODE=1')
    if (process.platform !== 'win32') {
      expect(statSync(join(binDir, 'node')).mode & 0o111).not.toBe(0)
    }
  })
})

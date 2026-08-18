import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  dshShimContent,
  dshShimPath,
  installDshCommandLine,
  userBinPathLine,
} from '../src/cli-installer.ts'

const tempDirs: string[] = []

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe('dsh command-line installer', () => {
  it('creates an executable shim and appends the PATH line exactly once', () => {
    const home = mkdtempSync(join(tmpdir(), 'dsh-cli-install-'))
    tempDirs.push(home)
    const execPath = '/Applications/DeepSeek Harness.app/Contents/MacOS/DeepSeek Harness'
    const dshBin = '/Applications/DeepSeek Harness.app/Contents/Resources/app/node_modules/@deepseek-ai/dsh/lib/bin.js'

    const first = installDshCommandLine(execPath, dshBin, home, 'darwin')
    expect(first.status).toBe('installed')

    const shim = dshShimPath(home, 'darwin')
    expect(existsSync(shim)).toBe(true)
    expect(readFileSync(shim, 'utf8')).toContain('ELECTRON_RUN_AS_NODE=1')
    expect(statSync(shim).mode & 0o111).not.toBe(0)

    const rc = join(home, '.zshrc')
    const line = userBinPathLine()
    expect(readFileSync(rc, 'utf8')).toContain(line)

    const second = installDshCommandLine(execPath, dshBin, home, 'darwin')
    expect(second.status).toBe('already-installed')
    expect(readFileSync(rc, 'utf8').split(line).length - 1).toBe(1)
  })

  it('reports unsupported on Windows until a .cmd installer path is added', () => {
    const outcome = installDshCommandLine('C:\\Electron.exe', 'C:\\dsh\\bin.js', '/tmp/home', 'win32')
    expect(outcome.status).toBe('unsupported')
  })

  it('embeds quoted executable and CLI paths in the shim', () => {
    const content = dshShimContent('/Applications/App.app/Contents/MacOS/App', '/Applications/App.app/Contents/Resources/app/lib/bin.js', 'darwin')
    expect(content).toContain("'/Applications/App.app/Contents/MacOS/App'")
    expect(content).toContain("'/Applications/App.app/Contents/Resources/app/lib/bin.js'")
  })
})

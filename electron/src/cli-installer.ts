/** One-click installation of a user-level dsh shim pointing at the bundled runtime. */

import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

/** Outcome of one user-level dsh shim installation. */
export type CliInstallOutcome =
  | { status: 'installed' | 'already-installed'; message: string; path: string }
  | { status: 'unsupported'; message: string }
  | { status: 'failed'; message: string }

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`
}

/** Shell script that runs the packaged dsh CLI through the Electron Node runtime. */
export function dshShimContent(execPath: string, dshBin: string, platform: NodeJS.Platform): string {
  if (platform === 'win32') {
    return `@echo off
set ELECTRON_RUN_AS_NODE=1
"${execPath}" --expose-internals "${dshBin}" %*
`
  }
  return `#!/bin/sh
ELECTRON_RUN_AS_NODE=1 exec ${shellQuote(execPath)} --expose-internals ${shellQuote(dshBin)} "$@"
`
}

/** Destination of the user-level dsh shim. */
export function dshShimPath(home: string, platform: NodeJS.Platform): string {
  return join(home, 'bin', platform === 'win32' ? 'dsh.cmd' : 'dsh')
}

/** Shell rc files whose PATH should include the user bin directory. */
export function shellRcFiles(home: string, platform: NodeJS.Platform): string[] {
  if (platform === 'win32') return []
  if (platform === 'darwin') return [join(home, '.zshrc'), join(home, '.bash_profile')]
  return [join(home, '.bashrc'), join(home, '.profile')]
}

/** Line that adds the user bin directory to an interactive shell PATH. */
export function userBinPathLine(): string {
  return 'export PATH="$HOME/bin:$PATH"'
}

function rcContainsLine(rcPath: string, line: string): boolean {
  if (!existsSync(rcPath)) return false
  return readFileSync(rcPath, 'utf8').split(/\r?\n/).includes(line)
}

/**
 * Install or refresh the user-level dsh shim and append the PATH line once.
 * @param execPath - packaged Electron executable used as the embedded Node runtime.
 * @param dshBin - packaged dsh CLI entry resolved inside the application bundle.
 * @param home - user home directory.
 * @param platform - operating system whose shim and shell rc format is used.
 * @returns the outcome for immediate native feedback.
 */
export function installDshCommandLine(
  execPath: string,
  dshBin: string,
  home: string,
  platform: NodeJS.Platform = process.platform,
): CliInstallOutcome {
  try {
    if (platform === 'win32') {
      return {
        status: 'unsupported',
        message: '当前平台暂不支持一键安装 dsh 命令行，请在终端中手动配置 PATH。',
      }
    }
    const shimPath = dshShimPath(home, platform)
    const rcFiles = shellRcFiles(home, platform)
    const pathLine = userBinPathLine()
    const missingRc = rcFiles.filter(rcPath => !rcContainsLine(rcPath, pathLine))
    const alreadyInstalled = existsSync(shimPath) && missingRc.length === 0

    mkdirSync(dirname(shimPath), { recursive: true })
    writeFileSync(shimPath, dshShimContent(execPath, dshBin, platform), { mode: 0o755 })
    for (const rcPath of missingRc) {
      appendFileSync(rcPath, `\n${pathLine}\n`)
    }

    return {
      status: alreadyInstalled ? 'already-installed' : 'installed',
      message: alreadyInstalled
        ? `dsh 命令行已安装：${shimPath}`
        : `dsh 命令行安装完成：${shimPath}\n新开一个终端窗口后即可直接使用 dsh。`,
      path: shimPath,
    }
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    return { status: 'failed', message: `安装 dsh 命令行失败：${detail}` }
  }
}

/** Bundled Node and pnpm runtime exposed to owned WebUI and plugin processes. */

import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'

const require = createRequire(import.meta.url)

/** Resolve the pnpm CLI shipped with the Electron package. */
export function resolvePnpmCli(): string {
  const packageDir = dirname(require.resolve('pnpm'))
  return join(packageDir, 'bin', 'pnpm.cjs')
}

/** Writable directory containing the bundled `node` and `pnpm` shims. */
function runtimeBinDir(userData: string): string {
  return join(userData, 'runtime-bin')
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`
}

function posixNodeShim(execPath: string): string {
  return `#!/bin/sh\nELECTRON_RUN_AS_NODE=1 exec ${shellQuote(execPath)} "$@"\n`
}

function posixPnpmShim(execPath: string, pnpmCli: string): string {
  return `#!/bin/sh\nELECTRON_RUN_AS_NODE=1 exec ${shellQuote(execPath)} ${shellQuote(pnpmCli)} "$@"\n`
}

function windowsNodeShim(execPath: string): string {
  return `@echo off\r\nset ELECTRON_RUN_AS_NODE=1\r\n"${execPath}" %*\r\n`
}

function windowsPnpmShim(execPath: string, pnpmCli: string): string {
  return `@echo off\r\nset ELECTRON_RUN_AS_NODE=1\r\n"${execPath}" "${pnpmCli}" %*\r\n`
}

/**
 * Create the executable shims used by packaged and source Electron runs.
 * @param execPath - Electron executable used as the embedded Node runtime.
 * @param userData - writable application data directory.
 * @param platform - operating system whose shim format is generated.
 * @returns the directory to prepend to PATH for owned child processes.
 */
export function ensureRuntimeBinaries(
  execPath: string,
  userData: string,
  platform: NodeJS.Platform = process.platform,
): string {
  const binDir = runtimeBinDir(userData)
  mkdirSync(binDir, { recursive: true })
  const pnpmCli = resolvePnpmCli()
  if (platform === 'win32') {
    writeFileSync(join(binDir, 'node.cmd'), windowsNodeShim(execPath))
    writeFileSync(join(binDir, 'pnpm.cmd'), windowsPnpmShim(execPath, pnpmCli))
  } else {
    writeFileSync(join(binDir, 'node'), posixNodeShim(execPath), { mode: 0o755 })
    writeFileSync(join(binDir, 'pnpm'), posixPnpmShim(execPath, pnpmCli), { mode: 0o755 })
  }
  return binDir
}

/** Common user tool directories that Finder-launched macOS apps do not inherit. */
const DARWIN_DESKTOP_PATH_DIRECTORIES = [
  '/opt/homebrew/bin',
  '/opt/homebrew/sbin',
  '/usr/local/bin',
  '/usr/local/sbin',
]

/**
 * Add user tool directories that are normally only present in a login shell PATH.
 * @param env - environment passed to the child process.
 * @param platform - operating system whose desktop PATH differs from a shell.
 * @param candidates - platform-specific directories to test; exposed for tests.
 * @returns the same environment object with PATH updated.
 */
export function ensureDesktopPath(
  env: NodeJS.ProcessEnv,
  platform: NodeJS.Platform = process.platform,
  candidates: readonly string[] = platform === 'darwin' ? DARWIN_DESKTOP_PATH_DIRECTORIES : [],
): NodeJS.ProcessEnv {
  const present = candidates.filter(directory => existsSync(directory))
  if (present.length === 0) return env
  const separator = platform === 'win32' ? ';' : ':'
  const pathKey = Object.keys(env).find(key => key.toLowerCase() === 'path')
    ?? (platform === 'win32' ? 'Path' : 'PATH')
  const entries = (env[pathKey] ?? '').split(separator).filter(Boolean)
  const missing = present.filter(directory => !entries.includes(directory))
  if (missing.length === 0) return env
  env[pathKey] = [...missing, ...entries].join(separator)
  return env
}

/**
 * Prepend the bundled runtime bin directory to a child process PATH.
 * @param env - environment passed to the child process.
 * @param binDir - directory containing the `node` and `pnpm` shims.
 * @param platform - operating system path separator rule.
 * @returns the same environment object with PATH updated.
 */
export function prependRuntimePath(
  env: NodeJS.ProcessEnv,
  binDir: string,
  platform: NodeJS.Platform = process.platform,
): NodeJS.ProcessEnv {
  if (binDir === '') return env
  const separator = platform === 'win32' ? ';' : ':'
  const pathKey = Object.keys(env).find(key => key.toLowerCase() === 'path')
    ?? (platform === 'win32' ? 'Path' : 'PATH')
  const current = env[pathKey]
  env[pathKey] = current === undefined || current === '' ? binDir : `${binDir}${separator}${current}`
  return env
}

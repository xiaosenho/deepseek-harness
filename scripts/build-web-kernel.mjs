import { spawnSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const repositoryRoot = dirname(dirname(fileURLToPath(import.meta.url)))
const webKernelRoot = join(repositoryRoot, 'deepseek-harness-web')
const pnpmCli = process.env.npm_execpath

if (pnpmCli === undefined || pnpmCli === '') {
  throw new Error('build:web-kernel must be run through pnpm so npm_execpath identifies the active pnpm CLI')
}

function runPnpm(args, env = process.env) {
  const result = spawnSync(process.execPath, [pnpmCli, ...args], {
    cwd: webKernelRoot,
    env,
    stdio: 'inherit',
  })
  if (result.error !== undefined) throw result.error
  if (result.signal !== null) throw new Error(`pnpm ${args.join(' ')} terminated by ${result.signal}`)
  if (result.status !== 0) process.exit(result.status ?? 1)
}

// The Web kernel is a read-only submodule, so its repository-owned hook
// installer must not migrate or replace the parent checkout's Git hooks.
runPnpm(['install', '--no-frozen-lockfile'], { ...process.env, CI: 'true' })
runPnpm(['run', 'build'])

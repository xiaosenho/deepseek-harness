#!/usr/bin/env node
/** Bump the deepseek-harness-web submodule pointer to upstream master and verify the shell. */

import { execFileSync } from 'node:child_process'
import { resolve } from 'node:path'

const kernelDir = resolve(process.cwd(), 'deepseek-harness-web')

function run(command, args, cwd) {
  return execFileSync(command, args, { cwd, encoding: 'utf8' }).trim()
}

const current = run('git', ['rev-parse', 'HEAD'], kernelDir)
console.log(`current kernel pin: ${current.slice(0, 12)}`)
run('git', ['fetch', 'origin', 'master'], kernelDir)
const latest = run('git', ['rev-parse', 'FETCH_HEAD'], kernelDir)
if (latest === current) {
  console.log('Web kernel is already at upstream master.')
  process.exit(0)
}

console.log(`upstream master: ${latest.slice(0, 12)}`)
run('git', ['checkout', '--detach', latest], kernelDir)

console.log('Reinstalling the workspace...')
run('pnpm', ['install', '--no-frozen-lockfile'], process.cwd())
console.log('Building the web kernel...')
run('pnpm', ['run', 'build:web-kernel'], process.cwd())
console.log('Running shell tests...')
run('pnpm', ['run', 'test'], process.cwd())

console.log(`Web kernel bumped ${current.slice(0, 12)} -> ${latest.slice(0, 12)}. Review, then commit the submodule pointer.`)

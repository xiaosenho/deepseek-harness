/** Generate electron/resources/version.json from the shell manifest and the pinned kernel commit. */
import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const shellDir = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const kernelDir = resolve(shellDir, '..', 'deepseek-harness-web')
const manifest = JSON.parse(readFileSync(join(shellDir, 'package.json'), 'utf8'))
const kernelCommit = execFileSync('git', ['-C', kernelDir, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
const info = {
  productName: manifest.productName,
  version: manifest.version,
  webKernelCommit: kernelCommit,
  builtAt: new Date().toISOString(),
}
mkdirSync(join(shellDir, 'resources'), { recursive: true })
writeFileSync(join(shellDir, 'resources', 'version.json'), `${JSON.stringify(info, null, 2)}\n`)
console.log(`version.json: shell ${info.version} over web kernel ${kernelCommit.slice(0, 12)}`)

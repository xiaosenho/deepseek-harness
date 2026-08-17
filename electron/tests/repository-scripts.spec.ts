import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'

interface PackageManifest {
  scripts: Record<string, string>
}

async function readManifest(path: URL): Promise<PackageManifest> {
  return JSON.parse(await readFile(path, 'utf8')) as PackageManifest
}

describe('repository source scripts', () => {
  it('builds source artifacts before starting Electron', async () => {
    const manifest = await readManifest(new URL('../../package.json', import.meta.url))

    expect(manifest.scripts['dev:electron']).toBe(
      'pnpm run build && pnpm --filter @deepseek-ai/dsh-electron run dev',
    )
  })

  it('uses cross-platform pnpm entry points for nested builds', async () => {
    const rootManifest = await readManifest(new URL('../../package.json', import.meta.url))
    const electronManifest = await readManifest(new URL('../package.json', import.meta.url))
    const webKernelBuild = await readFile(new URL('../../scripts/build-web-kernel.mjs', import.meta.url), 'utf8')

    expect(rootManifest.scripts['build:web-kernel']).toBe('node scripts/build-web-kernel.mjs')
    expect(electronManifest.scripts.build).not.toContain('$npm_execpath')
    expect(electronManifest.scripts.build).toMatch(/^pnpm --filter /)
    expect(webKernelBuild).toContain("CI: 'true'")
    expect(webKernelBuild).toContain('spawnSync(process.execPath, [pnpmCli, ...args]')
  })
})

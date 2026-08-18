import { lstatSync, mkdtempSync, mkdirSync, readlinkSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { linkWebKernelPlugins, WEB_KERNEL_PLUGIN_PACKAGES } from '../src/web-kernel-plugins.ts'

const homes: string[] = []

function tempHome(): string {
  const home = mkdtempSync(join(tmpdir(), 'dsh-web-kernel-plugins-'))
  homes.push(home)
  return home
}

afterEach(() => {
  for (const home of homes.splice(0)) rmSync(home, { recursive: true, force: true })
})

function linkPath(home: string, packageName: string): string {
  return join(home, 'profiles', 'node_modules', packageName)
}

describe('linkWebKernelPlugins', () => {
  it('links every vendor plugin into the profile fallback', () => {
    const home = tempHome()
    linkWebKernelPlugins(home)
    for (const packageName of WEB_KERNEL_PLUGIN_PACKAGES) {
      const link = linkPath(home, packageName)
      expect(lstatSync(link).isSymbolicLink()).toBe(true)
      expect(readlinkSync(link).replaceAll('\\', '/')).toContain('electron/vendor')
    }
  })

  it('is idempotent and re-points a stale target', () => {
    const home = tempHome()
    linkWebKernelPlugins(home)
    linkWebKernelPlugins(home)
    const link = linkPath(home, '@deepseek-ai/dsh-tool-docx')
    expect(() => lstatSync(link)).toThrow() // tool-docx is not a shell-mounted plugin
    const stale = linkPath(home, '@deepseek-ai/dsh-host-directory-picker-electron')
    expect(lstatSync(stale).isSymbolicLink()).toBe(true)
  })

  it('throws when the link path is occupied by a real directory', () => {
    const home = tempHome()
    const link = linkPath(home, '@deepseek-ai/dsh-host-directory-picker-electron')
    mkdirSync(link, { recursive: true })
    expect(() => linkWebKernelPlugins(home)).toThrow('exists and is not a symlink')
  })
})

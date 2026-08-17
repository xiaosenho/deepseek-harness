/** Link the shell's vendor plugins into the kernel profile fallback so the Loader can resolve them. */

import { lstatSync, mkdirSync, readlinkSync, symlinkSync, unlinkSync } from 'node:fs'
import { createRequire } from 'node:module'
import { basename, dirname, join } from 'node:path'
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'

const require = createRequire(import.meta.url)

/** Vendor plugin packages the shell mounts into the Web profile. */
export const WEB_KERNEL_PLUGIN_PACKAGES = [
  '@deepseek-ai/dsh-host-directory-picker-electron',
  '@deepseek-ai/dsh-client-ui-directory-picker-electron',
  '@deepseek-ai/dsh-client-ui-desktop-electron',
] as const

/** The flat module fallback the kernel maintains for every profile. */
function fallbackModulesDir(home: string): string {
  return join(home, 'profiles', 'node_modules')
}

/**
 * Ensure `link` is a symlink to `target`, replacing a wrong or dangling
 * link; a real directory throws. Mirrors the kernel's own fallback heal.
 */
function ensureSymlink(link: string, target: string): void {
  let stat
  try {
    stat = lstatSync(link)
  } catch {
    stat = undefined
  }
  if (stat !== undefined) {
    if (!stat.isSymbolicLink()) {
      throw new Error(`dsh-electron: ${link} exists and is not a symlink; remove it so the shell can link its plugins`)
    }
    if (readlinkSync(link) === target) return
    unlinkSync(link)
  }
  symlinkSync(target, link, 'junction')
}

/**
 * Link every shell-owned Web plugin into the kernel's flat module fallback
 * (`$DSH_HOME/profiles/node_modules`), the parent-walk directory every
 * profile reaches before any other module root. The kernel maintains the same
 * directory for its own closure; this mirrors that contract for the fork-only
 * packages the shell's `--patch` overlays mount.
 * @param home - the Harness home; defaults to the resolved `DSH_HOME`.
 */
export function linkWebKernelPlugins(home: string = resolveDshHome()): void {
  const modulesDir = fallbackModulesDir(home)
  for (const packageName of WEB_KERNEL_PLUGIN_PACKAGES) {
    const dir = dirname(require.resolve(`${packageName}/package.json`))
    const link = join(modulesDir, '@deepseek-ai', basename(packageName))
    mkdirSync(dirname(link), { recursive: true })
    ensureSymlink(link, dir)
  }
}

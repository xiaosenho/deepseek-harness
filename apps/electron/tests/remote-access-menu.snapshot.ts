/**
 * Keyless semantic snapshot for the product-owned Remote Access menu fields.
 *
 * Electron exposes an installed application Menu only inside its main process,
 * while external-WebUI mode deliberately omits these commands. A runnable
 * native snapshot would therefore require GUI automation or a production
 * introspection channel. This snapshot invokes the production template builder
 * and does not prove Electron Menu construction or main-process lifecycle.
 */

import { access, mkdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { MenuItemConstructorOptions } from 'electron/main'
import { describe, expect, it } from 'vitest'
import {
  createApplicationMenuTemplate,
  type ApplicationMenuOptions,
  type RemoteAccessMenuCommands,
} from '../src/application-menu.ts'
import type { RemoteAccessState } from '../src/remote-access-controller.ts'

const EXPECTED = join(
  import.meta.dirname,
  'snapshots',
  'remote-access-menu',
  'projection.expected.json',
)
const REFRESHING = process.env.DSH_SNAPSHOT === 'record' || process.env.DSH_SNAPSHOT === 'refresh'
const REMOTE_URL = 'http://192.168.1.5:43127/#dsh-access=SECRET'

const commands: RemoteAccessMenuCommands = {
  start() {},
  stop() {},
  showDetails() {},
  copyUrl() {},
}

function options(
  platform: NodeJS.Platform,
  state?: RemoteAccessState,
): ApplicationMenuOptions {
  return {
    applicationName: 'DeepSeek Harness',
    checkForUpdates: async () => ({ status: 'current' }),
    currentVersion: '0.1.0',
    installUpdate: async () => true,
    platform,
    showMessageBox: async () => ({ checkboxChecked: false, response: 0 }),
    ...(state === undefined ? {} : { remoteAccess: { commands, state } }),
  }
}

interface LocatedRemoteMenu {
  container: string
  items: MenuItemConstructorOptions[]
}

function locateRemoteMenu(
  template: ReturnType<typeof createApplicationMenuTemplate>,
): LocatedRemoteMenu | undefined {
  for (const parent of template) {
    if (!Array.isArray(parent.submenu)) continue
    const remote = parent.submenu.find(item => item.label === 'Remote Access')
    if (remote === undefined || !Array.isArray(remote.submenu)) continue
    return {
      container: parent.label ?? String(parent.role),
      items: remote.submenu,
    }
  }
  return undefined
}

function commandName(click: MenuItemConstructorOptions['click']): string | null {
  if (click === undefined) return null
  for (const [name, command] of Object.entries(commands)) {
    if (click === command) return name
  }
  throw new Error('Remote Access menu contains an unknown command callback')
}

function projectItems(items: MenuItemConstructorOptions[]): object[] {
  return items.map((item) => {
    if (item.type === 'separator') return { type: 'separator' }
    return {
      id: item.id,
      label: item.label,
      enabled: item.enabled ?? true,
      command: commandName(item.click),
    }
  })
}

function requiredRemoteMenu(
  platform: NodeJS.Platform,
  state: RemoteAccessState,
): LocatedRemoteMenu {
  const remote = locateRemoteMenu(createApplicationMenuTemplate(options(platform, state)))
  if (remote === undefined) throw new Error(`Remote Access menu is absent on ${platform}`)
  return remote
}

function projection(): object {
  const platforms = ['darwin', 'win32', 'linux'] as const
  const states = {
    off: { enabled: false, preferredMode: 'lan', transitioning: false },
    on: { enabled: true, mode: 'lan', preferredMode: 'lan', transitioning: false, url: REMOTE_URL },
    changing: { enabled: true, mode: 'frp', preferredMode: 'frp', transitioning: true, url: REMOTE_URL },
    'on-without-url': { enabled: true, mode: 'frp', preferredMode: 'frp', transitioning: false },
  } satisfies Record<string, RemoteAccessState>
  return {
    externalWebUiRemoteMenuPresent: Object.fromEntries(platforms.map(platform => [
      platform,
      locateRemoteMenu(createApplicationMenuTemplate(options(platform))) !== undefined,
    ])),
    placement: Object.fromEntries(platforms.map(platform => [
      platform,
      requiredRemoteMenu(platform, states.off).container,
    ])),
    states: Object.fromEntries(Object.entries(states).map(([name, state]) => [
      name,
      projectItems(requiredRemoteMenu('darwin', state).items),
    ])),
  }
}

describe('Electron Remote Access menu semantic snapshot', () => {
  it('pins product labels, availability, placement, and command bindings', async () => {
    const output = `${JSON.stringify(projection(), null, 2)}\n`
    expect(output).not.toContain(REMOTE_URL)
    if (REFRESHING) {
      await mkdir(dirname(EXPECTED), { recursive: true })
      await writeFile(EXPECTED, output)
    } else {
      await access(EXPECTED)
    }
    await expect(output).toMatchFileSnapshot(EXPECTED)
  })
})

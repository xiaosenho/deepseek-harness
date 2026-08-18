/** Native Electron application menu for desktop-owned operations. */

import type {
  Menu,
  MenuItem,
  MenuItemConstructorOptions,
  MessageBoxOptions,
  MessageBoxReturnValue,
} from 'electron/main'
import type { CliInstallOutcome } from './cli-installer.ts'
import type { RemoteAccessState } from './remote-access-controller.ts'
import type { OtaUpdateCheckResult } from './updater.ts'

const CHECK_FOR_UPDATES_ID = 'check-for-updates'
const INSTALL_DSH_ID = 'install-dsh'
const REMOTE_ACCESS_STATUS_ID = 'remote-access-status'
const REMOTE_ACCESS_START_ID = 'remote-access-start'
const REMOTE_ACCESS_DETAILS_ID = 'remote-access-details'
const REMOTE_ACCESS_COPY_ID = 'remote-access-copy'
const REMOTE_ACCESS_STOP_ID = 'remote-access-stop'

type ShowMessageBox = (options: MessageBoxOptions) => Promise<MessageBoxReturnValue>

function assertNever(value: never): never {
  throw new Error(`Unknown Electron update result: ${JSON.stringify(value)}`)
}

/** Commands contributed by the Electron-owned remote-access controller. */
export interface RemoteAccessMenuCommands {
  /** Start the configured authenticated remote transport. */
  start: () => void
  /** Stop the active remote transport and return to loopback-only mode. */
  stop: () => void
  /** Present the current authenticated URL in a native dialog. */
  showDetails: () => void
  /** Copy the current authenticated URL. */
  copyUrl: () => void
}

/** Remote-access state and commands projected into the native menu. */
export interface RemoteAccessMenuOptions {
  /** Authoritative state at menu construction time. */
  state: RemoteAccessState
  /** Main-process operations invoked by menu items. */
  commands: RemoteAccessMenuCommands
}

/** Dependencies for the native application menu. */
export interface ApplicationMenuOptions {
  /** Installed application name. */
  applicationName: string
  /** Installed application version. */
  currentVersion: string
  /** Operating system reported by Electron. */
  platform: NodeJS.Platform
  /** Shared startup/manual OTA controller operation. */
  checkForUpdates: () => Promise<OtaUpdateCheckResult>
  /** Install a verified update already prepared by the controller. */
  installUpdate: () => Promise<boolean>
  /** Install a user-level dsh command-line shim. */
  installCommandLine: () => Promise<CliInstallOutcome>
  /** Native message-box presenter. */
  showMessageBox: ShowMessageBox
  /** Electron-owned remote access; absent for an external WebUI. */
  remoteAccess?: RemoteAccessMenuOptions
}

export function updateResultDialog(
  applicationName: string,
  currentVersion: string,
  result: OtaUpdateCheckResult,
): MessageBoxOptions {
  const base = { title: applicationName, buttons: ['OK'] }
  switch (result.status) {
    case 'disabled':
      return { ...base, type: 'info', message: 'Updates are available only in an installed application.' }
    case 'unsupported':
      return { ...base, type: 'info', message: 'Automatic updates are not available on this platform.' }
    case 'readonly':
      return {
        ...base,
        type: 'warning',
        message: 'Automatic updates cannot run from a read-only volume.',
        detail: 'Move DeepSeek Harness to the Applications folder, then check for updates again.',
      }
    case 'unsigned':
      return {
        ...base,
        type: 'warning',
        message: 'This macOS build is unsigned and cannot install automatic updates.',
        detail: 'Install a signed and notarized release, or replace this build manually.',
      }
    case 'no-release':
      return { ...base, type: 'info', message: 'No update is currently published.' }
    case 'current':
      return { ...base, type: 'info', message: `${applicationName} ${currentVersion} is up to date.` }
    case 'ready':
      return {
        ...base,
        type: 'info',
        message: `${applicationName} ${result.version} is ready to install.`,
        detail: result.changelog,
        buttons: ['Install and Restart', 'Later'],
        defaultId: 0,
        cancelId: 1,
      }
    case 'failed':
      return {
        ...base,
        type: 'error',
        message: 'The update check failed.',
        detail: result.detail,
      }
    default:
      return assertNever(result)
  }
}

/** Present one update result and return whether the ready update should install. */
export async function runUpdateResultDialog(
  options: ApplicationMenuOptions,
  result: OtaUpdateCheckResult,
): Promise<boolean> {
  const response = await options.showMessageBox(
    updateResultDialog(options.applicationName, options.currentVersion, result),
  )
  return result.status === 'ready' && response.response === 0
}

/**
 * Run a manual update check while keeping its native menu item single-flight.
 * @param item - clicked native menu item.
 * @param options - application identity, controller operation, and dialog presenter.
 * @returns after the result dialog closes.
 */
export async function runManualUpdateCheck(
  item: Pick<MenuItem, 'enabled' | 'label'>,
  options: ApplicationMenuOptions,
): Promise<void> {
  if (!item.enabled) return
  item.enabled = false
  item.label = 'Checking for Updates...'
  try {
    const result = await options.checkForUpdates()
    if (await runUpdateResultDialog(options, result)) await options.installUpdate()
  } finally {
    item.label = 'Check for Updates...'
    item.enabled = true
  }
}

/** Run the user-level dsh shim installation while keeping the menu item single-flight. */
export async function runInstallCommandLine(
  item: Pick<MenuItem, 'enabled' | 'label'>,
  options: ApplicationMenuOptions,
): Promise<void> {
  if (!item.enabled) return
  item.enabled = false
  item.label = 'Installing dsh Command Line...'
  try {
    const outcome = await options.installCommandLine()
    await options.showMessageBox({
      type: outcome.status === 'failed' ? 'error' : 'info',
      title: options.applicationName,
      message: outcome.message,
    })
  } finally {
    item.label = 'Install dsh Command Line...'
    item.enabled = true
  }
}

function installDshItem(options: ApplicationMenuOptions): MenuItemConstructorOptions {
  return {
    id: INSTALL_DSH_ID,
    label: 'Install dsh Command Line...',
    click: (item) => {
      void runInstallCommandLine(item, options).catch((error: unknown) => {
        console.error('The native Electron dsh install command failed.', error)
      })
    },
  }
}

function updateItem(options: ApplicationMenuOptions): MenuItemConstructorOptions {
  return {
    id: CHECK_FOR_UPDATES_ID,
    label: 'Check for Updates...',
    click: (item) => {
      void runManualUpdateCheck(item, options).catch((error: unknown) => {
        console.error('The native Electron update command failed.', error)
      })
    },
  }
}

function remoteAccessStatusLabel(state: RemoteAccessState): string {
  if (state.transitioning) return 'Status: Changing...'
  return state.enabled ? 'Status: On' : 'Status: Off'
}

function remoteAccessItem(options: RemoteAccessMenuOptions): MenuItemConstructorOptions {
  const { commands, state } = options
  const settled = !state.transitioning
  const hasUrl = state.enabled && state.url !== undefined
  return {
    label: 'Remote Access',
    submenu: [
      {
        id: REMOTE_ACCESS_STATUS_ID,
        label: remoteAccessStatusLabel(state),
        enabled: false,
      },
      { type: 'separator' },
      {
        id: REMOTE_ACCESS_START_ID,
        label: 'Start Remote Access...',
        enabled: settled && !state.enabled,
        click: commands.start,
      },
      {
        id: REMOTE_ACCESS_DETAILS_ID,
        label: 'Show Connection Details...',
        enabled: settled && hasUrl,
        click: commands.showDetails,
      },
      {
        id: REMOTE_ACCESS_COPY_ID,
        label: 'Copy Connection URL',
        enabled: settled && hasUrl,
        click: commands.copyUrl,
      },
      { type: 'separator' },
      {
        id: REMOTE_ACCESS_STOP_ID,
        label: 'Stop Remote Access...',
        enabled: settled && state.enabled,
        click: commands.stop,
      },
    ],
  }
}

function requiredMenuItem(menu: Pick<Menu, 'getMenuItemById'>, id: string): MenuItem {
  const item = menu.getMenuItemById(id)
  if (item === null) throw new Error(`Electron application menu is missing ${id}`)
  return item
}

/**
 * Refresh the native remote-access items without rebuilding unrelated menu state.
 * @param menu - installed Electron application menu.
 * @param state - current authoritative controller state.
 */
export function refreshRemoteAccessMenu(
  menu: Pick<Menu, 'getMenuItemById'>,
  state: RemoteAccessState,
): void {
  const settled = !state.transitioning
  const hasUrl = state.enabled && state.url !== undefined
  requiredMenuItem(menu, REMOTE_ACCESS_STATUS_ID).label = remoteAccessStatusLabel(state)
  requiredMenuItem(menu, REMOTE_ACCESS_START_ID).enabled = settled && !state.enabled
  requiredMenuItem(menu, REMOTE_ACCESS_DETAILS_ID).enabled = settled && hasUrl
  requiredMenuItem(menu, REMOTE_ACCESS_COPY_ID).enabled = settled && hasUrl
  requiredMenuItem(menu, REMOTE_ACCESS_STOP_ID).enabled = settled && state.enabled
}

/**
 * Build the platform-native application menu without adding renderer capabilities.
 * @param options - application identity and main-process operations.
 * @returns a complete Electron application-menu template.
 */
export function createApplicationMenuTemplate(options: ApplicationMenuOptions): MenuItemConstructorOptions[] {
  const remote = options.remoteAccess === undefined ? [] : [
    { type: 'separator' } as const,
    remoteAccessItem(options.remoteAccess),
  ]
  if (options.platform === 'darwin') {
    return [
      {
        label: options.applicationName,
        submenu: [
          { role: 'about' },
          { type: 'separator' },
          updateItem(options),
          { type: 'separator' },
          installDshItem(options),
          ...remote,
          { type: 'separator' },
          { role: 'services' },
          { type: 'separator' },
          { role: 'hide' },
          { role: 'hideOthers' },
          { role: 'unhide' },
          { type: 'separator' },
          { role: 'quit' },
        ],
      },
      { role: 'editMenu' },
      { role: 'viewMenu' },
      { role: 'windowMenu' },
    ]
  }
  return [
    { role: 'fileMenu' },
    { role: 'editMenu' },
    { role: 'viewMenu' },
    { role: 'windowMenu' },
    {
      role: 'help',
      submenu: [
        installDshItem(options),
        { type: 'separator' },
        updateItem(options),
        ...remote,
        { type: 'separator' },
        { role: 'about' },
      ],
    },
  ]
}

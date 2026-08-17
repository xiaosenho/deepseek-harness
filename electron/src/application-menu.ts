/** Native Electron application menu for the desktop shell. */

import type {
  MenuItem,
  MenuItemConstructorOptions,
  MessageBoxOptions,
  MessageBoxReturnValue,
} from 'electron/main'
import type { OtaUpdateCheckResult } from './updater.ts'

const CHECK_FOR_UPDATES_ID = 'check-for-updates'

type ShowMessageBox = (options: MessageBoxOptions) => Promise<MessageBoxReturnValue>

function assertNever(value: never): never {
  throw new Error(`Unknown Electron update result: ${JSON.stringify(value)}`)
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
  /** Native message-box presenter. */
  showMessageBox: ShowMessageBox
}

function resultDialog(
  applicationName: string,
  currentVersion: string,
  result: OtaUpdateCheckResult,
): MessageBoxOptions {
  const base = { title: applicationName, buttons: ['确定'] }
  switch (result.status) {
    case 'disabled':
      return { ...base, type: 'info', message: '更新仅适用于已安装的应用。' }
    case 'unsupported':
      return { ...base, type: 'info', message: '当前平台暂不支持自动更新。' }
    case 'no-release':
      return { ...base, type: 'info', message: '当前没有已发布的更新。' }
    case 'current':
      return { ...base, type: 'info', message: `${applicationName} ${currentVersion} 已是最新版本。` }
    case 'ready':
      return {
        ...base,
        type: 'info',
        message: `${applicationName} ${result.version} 已准备好安装。`,
        detail: result.changelog,
        buttons: ['立即安装并重启', '稍后'],
        defaultId: 0,
        cancelId: 1,
      }
    case 'failed':
      return {
        ...base,
        type: 'error',
        message: '更新检查失败。',
        detail: result.detail,
      }
    default:
      return assertNever(result)
  }
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
  if (item.enabled === false) return
  item.enabled = false
  item.label = '正在检查更新...'
  try {
    const result = await options.checkForUpdates()
    const dialog = await options.showMessageBox(resultDialog(options.applicationName, options.currentVersion, result))
    if (result.status === 'ready' && dialog.response === 0) await options.installUpdate()
  } finally {
    item.label = '检查更新...'
    item.enabled = true
  }
}

function updateItem(options: ApplicationMenuOptions): MenuItemConstructorOptions {
  return {
    id: CHECK_FOR_UPDATES_ID,
    label: '检查更新...',
    click: (item) => {
      void runManualUpdateCheck(item, options).catch((error: unknown) => {
        console.error('The native Electron update command failed.', error)
      })
    },
  }
}

/**
 * Build a platform-native application menu.
 * @param options - application identity and update operations.
 * @returns a complete Electron application-menu template.
 */
export function createApplicationMenuTemplate(options: ApplicationMenuOptions): MenuItemConstructorOptions[] {
  if (options.platform === 'darwin') {
    return [
      {
        label: options.applicationName,
        submenu: [
          { label: `关于 ${options.applicationName}`, role: 'about' },
          { type: 'separator' },
          updateItem(options),
          { type: 'separator' },
          { label: '服务', role: 'services' },
          { type: 'separator' },
          { label: '隐藏', role: 'hide' },
          { label: '隐藏其他', role: 'hideOthers' },
          { label: '全部显示', role: 'unhide' },
          { type: 'separator' },
          { label: `退出 ${options.applicationName}`, role: 'quit' },
        ],
      },
      { label: '编辑', role: 'editMenu' },
      { label: '显示', role: 'viewMenu' },
      { label: '窗口', role: 'windowMenu' },
    ]
  }
  return [
    { label: '文件', role: 'fileMenu' },
    { label: '编辑', role: 'editMenu' },
    { label: '显示', role: 'viewMenu' },
    { label: '窗口', role: 'windowMenu' },
    {
      label: '帮助',
      role: 'help',
      submenu: [
        updateItem(options),
        { type: 'separator' },
        { label: `关于 ${options.applicationName}`, role: 'about' },
      ],
    },
  ]
}

/** Electron main-process host for the existing dsh Web profile. */

import { join } from 'node:path'
import { shell } from 'electron/common'
import { app, BrowserWindow, dialog, Menu, net } from 'electron/main'
import { createApplicationMenuTemplate } from './application-menu.ts'
import { resolveApplicationUrl } from './application-url.ts'
import { WebBackend } from './backend.ts'
import { ExitBarrier } from './exit-barrier.ts'
import { createApplicationNavigationGuard, isExternalNavigation } from './navigation.ts'
import { ensureRuntimeBinaries } from './runtime.ts'
import {
  installUpdateAfterShutdown,
  OtaUpdateController,
  type InstallDownloadedUpdate,
} from './updater.ts'

app.setName('DeepSeek Harness')
app.setPath('userData', join(app.getPath('appData'), 'DeepSeek Harness'))

let mainWindow: BrowserWindow | undefined
let applicationUrl: URL | undefined
let quitting = false
let runtimeBinDir: string | undefined
const backend = new WebBackend()
const exitBarrier = new ExitBarrier()
const isCurrentApplicationNavigation = createApplicationNavigationGuard(() => applicationUrl)
const otaUpdater = new OtaUpdateController({
  ...(process.env.DSH_ELECTRON_OTA_URL === undefined
    ? {}
    : { baseUrl: process.env.DSH_ELECTRON_OTA_URL }),
  currentVersion: app.getVersion(),
  fetch: (input, init) => net.fetch(input, init),
  isPackaged: app.isPackaged,
  onForceUpdateReady: restartForUpdate,
  platform: process.platform,
})

function openExternal(target: string): void {
  if (isExternalNavigation(target)) void shell.openExternal(target)
}

function stopOwnedProcesses(): Promise<void> {
  return backend.stop()
}

function relaunchAfterInstallFailure(error: Error): void {
  console.error('下载的更新安装程序在进程关闭后启动失败。', error)
  app.relaunch()
  app.exit(1)
}

async function restartForUpdate(install: InstallDownloadedUpdate): Promise<void> {
  if (quitting) return
  quitting = true
  try {
    await installUpdateAfterShutdown(
      () => exitBarrier.prepare(stopOwnedProcesses),
      () => { install(relaunchAfterInstallFailure) },
    )
  } catch (error) {
    if (exitBarrier.canExit) {
      relaunchAfterInstallFailure(error instanceof Error ? error : new Error(String(error)))
      return
    }
    quitting = false
    const detail = error instanceof Error ? error.message : String(error)
    await dialog.showMessageBox({
      type: 'error',
      title: 'DeepSeek Harness',
      message: '下载的更新无法重启 DeepSeek Harness。',
      detail,
    })
  }
}

function configureApplicationMenu(): void {
  const applicationName = app.getName()
  const currentVersion = app.getVersion()
  const menuOptions: Parameters<typeof createApplicationMenuTemplate>[0] = {
    applicationName,
    checkForUpdates: () => otaUpdater.check(),
    currentVersion,
    installUpdate: () => otaUpdater.install(),
    platform: process.platform,
    showMessageBox: options => dialog.showMessageBox(options),
  }
  app.setAboutPanelOptions({
    applicationName,
    applicationVersion: currentVersion,
  })
  Menu.setApplicationMenu(Menu.buildFromTemplate(createApplicationMenuTemplate(menuOptions)))
}

/** Create the isolated desktop window for the loopback Web-profile origin. */
function createWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 960,
    minHeight: 640,
    show: false,
    title: 'DeepSeek Harness',
    backgroundColor: '#ffffff',
    autoHideMenuBar: process.platform !== 'darwin',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webviewTag: false,
    },
  })
  window.webContents.setWindowOpenHandler(({ url: target }) => {
    if (isCurrentApplicationNavigation(target)) void window.loadURL(target)
    else openExternal(target)
    return { action: 'deny' }
  })
  window.webContents.on('will-navigate', (event, target) => {
    if (isCurrentApplicationNavigation(target)) return
    event.preventDefault()
    openExternal(target)
  })
  window.webContents.on('page-title-updated', (event, title) => {
    event.preventDefault()
    window.setTitle(title)
  })
  window.once('ready-to-show', () => { window.show() })
  window.once('closed', () => {
    if (mainWindow === window) mainWindow = undefined
  })
  mainWindow = window
  return window
}

async function start(): Promise<void> {
  try {
    const defaultCwd = app.isPackaged ? app.getPath('home') : join(app.getAppPath(), '..', '..')
    runtimeBinDir = ensureRuntimeBinaries(process.execPath, app.getPath('userData'))
    if (process.env.DSH_ELECTRON_URL === undefined) {
      const location = await backend.start(
        process.env.DSH_ELECTRON_CWD?.trim() || defaultCwd,
        (code, signal) => {
          if (quitting) return
          void dialog.showMessageBox({
            type: 'error',
            title: 'DeepSeek Harness',
            message: 'DeepSeek Harness WebUI 已停止。',
            detail: signal === null ? `退出码：${String(code)}` : `信号：${signal}`,
          }).finally(() => { app.quit() })
        },
        runtimeBinDir,
      )
      applicationUrl = location.loopbackUrl
    } else {
      applicationUrl = resolveApplicationUrl(process.env.DSH_ELECTRON_URL)
    }
    const window = createWindow()
    await window.loadURL(applicationUrl.href)
    configureApplicationMenu()
    void otaUpdater.check()
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    await dialog.showMessageBox({
      type: 'error',
      title: 'DeepSeek Harness',
      message: 'DeepSeek Harness WebUI 不可用。',
      detail,
    })
    app.quit()
  }
}

if (app.requestSingleInstanceLock() === false) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (mainWindow === undefined && applicationUrl !== undefined) {
      const window = createWindow()
      void window.loadURL(applicationUrl.href)
    }
    mainWindow?.restore()
    mainWindow?.focus()
  })
  app.on('activate', () => {
    if (mainWindow === undefined && applicationUrl !== undefined) {
      const window = createWindow()
      void window.loadURL(applicationUrl.href)
    }
  })
  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })
  app.on('before-quit', (event) => {
    if (exitBarrier.canExit) return
    event.preventDefault()
    if (quitting) return
    quitting = true
    void exitBarrier.prepare(stopOwnedProcesses).then(
      () => { app.quit() },
      (error: unknown) => {
        quitting = false
        console.error('停止 Electron 持有的进程时失败。', error)
      },
    )
  })
  void app.whenReady().then(start)
}

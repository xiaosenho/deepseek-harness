/** Electron main-process host for the existing dsh Web profile. */

import { spawnSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { shell } from 'electron/common'
import { app, BrowserWindow, dialog, Menu, net } from 'electron/main'
import { createApplicationMenuTemplate, updateResultDialog } from './application-menu.ts'
import { resolveApplicationUrl } from './application-url.ts'
import { resolveDshBin, WebBackend } from './backend.ts'
import { installDshCommandLine } from './cli-installer.ts'
import {
  DIRECTORY_PICKER_HELPER_ARGUMENT,
  pickElectronDirectory,
  runDirectoryPickerHelper,
} from './directory-picker-helper.ts'
import { ExitBarrier } from './exit-barrier.ts'
import { createApplicationNavigationGuard, isExternalNavigation } from './navigation.ts'
import { ensureRuntimeBinaries } from './runtime.ts'
import {
  installUpdateAfterShutdown,
  OtaUpdateController,
  type InstallDownloadedUpdate,
  type OtaUpdateCheckResult,
} from './updater.ts'

app.setName('DeepSeek Harness')
app.setPath('userData', join(app.getPath('appData'), 'DeepSeek Harness'))

let mainWindow: BrowserWindow | undefined
let applicationUrl: URL | undefined
let quitting = false
let runtimeBinDir: string | undefined
let updateProgressWindow: BrowserWindow | undefined
let updateProgressBlocking = false
const backend = new WebBackend()
const exitBarrier = new ExitBarrier()
const directoryPickerHelper = process.argv.includes(DIRECTORY_PICKER_HELPER_ARGUMENT)
const isCurrentApplicationNavigation = createApplicationNavigationGuard(() => applicationUrl)
const otaUpdater = new OtaUpdateController({
  ...(process.env.DSH_ELECTRON_OTA_URL === undefined
    ? {}
    : { baseUrl: process.env.DSH_ELECTRON_OTA_URL }),
  applicationExecPath: process.execPath,
  currentVersion: app.getVersion(),
  fetch: (input, init) => net.fetch(input, init),
  isPackaged: app.isPackaged,
  onDownloadStart: (force: boolean) => {
    updateProgressBlocking = force
    setUpdateProgress(0)
  },
  onDownloadProgress: (progress) => {
    setUpdateProgress(progress.percent)
  },
  onForceUpdateReady: restartForUpdate,
  platform: process.platform,
})

function openExternal(target: string): void {
  if (isExternalNavigation(target)) void shell.openExternal(target)
}

function stopOwnedProcesses(): Promise<void> {
  return backend.stop()
}

function updateProgressHtml(percent: number): string {
  const installing = updateProgressBlocking && percent >= 100
  const title = installing ? '正在安装更新…' : updateProgressBlocking ? '正在下载并安装更新…' : '正在后台下载更新…'
  const detail = installing
    ? '更新包已就绪，应用即将重启。'
    : updateProgressBlocking
      ? '更新完成前主界面不可操作，请稍候。'
      : '主界面可继续使用，下载完成后会提示你。'
  const rounded = Math.max(0, Math.min(100, Math.round(percent)))
  const progress = `<progress value="${rounded}" max="100" style="display:block;width:100%;height:14px;appearance:auto"></progress><p style="margin:10px 0 0;color:#888;text-align:right">${rounded}%</p>`
  return `<!doctype html><meta charset="utf-8"><style>body{font:13px -apple-system,BlinkMacSystemFont,sans-serif;padding:18px;color:#333;background:#fff;margin:0}</style><p style="margin:0 0 8px"><strong>${title}</strong></p><p style="margin:0 0 8px;color:#888">${detail}</p>${progress}`
}

function createUpdateProgressWindow(blocking: boolean): BrowserWindow {
  const window = new BrowserWindow({
    width: 420,
    height: 160,
    resizable: false,
    minimizable: false,
    maximizable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    ...(mainWindow === undefined ? {} : { parent: mainWindow }),
    modal: blocking,
    title: blocking ? '正在更新' : '更新下载中',
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webviewTag: false,
    },
  })
  window.once('ready-to-show', () => { window.show() })
  return window
}

function setUpdateProgress(percent: number): void {
  if (updateProgressWindow === undefined) {
    updateProgressWindow = createUpdateProgressWindow(updateProgressBlocking)
  }
  void updateProgressWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(updateProgressHtml(percent))}`)
}

function showUpdateInstallProgress(): void {
  updateProgressBlocking = true
  setUpdateProgress(100)
}

function closeUpdateProgressWindow(): void {
  updateProgressWindow?.close()
  updateProgressWindow = undefined
}

async function runMenuUpdateCheck(): Promise<OtaUpdateCheckResult> {
  try {
    return await otaUpdater.check()
  } finally {
    closeUpdateProgressWindow()
  }
}

async function presentStartupUpdate(): Promise<void> {
  try {
    const result = await otaUpdater.check()
    if (result.status !== 'ready') return
    const response = await dialog.showMessageBox(updateResultDialog(app.getName(), app.getVersion(), result))
    if (response.response === 0) {
      showUpdateInstallProgress()
      await otaUpdater.install()
    }
  } finally {
    closeUpdateProgressWindow()
  }
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
      () => {
        install(relaunchAfterInstallFailure)
        // Squirrel.Mac 竞态：quitAndInstall 先启动 ShipIt 再异步退出 app，ShipIt 启动时主进程
        // 仍在运行会中止安装（App Still Running Error）。延迟退出给 Squirrel 写安装请求的时间，
        // 并在退出前终止 Electron Helper：app.exit(0) 不清理它们，ShipIt 检测到残留实例同样中止。
        setTimeout(() => {
          if (process.platform === 'darwin') {
            const bundleRoot = dirname(dirname(dirname(process.execPath)))
            spawnSync('pkill', ['-f', `${bundleRoot}/Contents/Frameworks/.*Helper`], { stdio: 'ignore' })
          }
          app.exit(0)
        }, 300)
      },
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
    checkForUpdates: () => runMenuUpdateCheck(),
    currentVersion,
    installCommandLine: () => Promise.resolve(installDshCommandLine(
      process.execPath,
      resolveDshBin(),
      app.getPath('home'),
    )),
    installUpdate: () => {
      showUpdateInstallProgress()
      return otaUpdater.install()
    },
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
        signal => pickElectronDirectory(signal, {
          execPath: process.execPath,
          applicationPath: app.getAppPath(),
          packaged: app.isPackaged,
        }),
        runtimeBinDir,
      )
      applicationUrl = location.loopbackUrl
    } else {
      applicationUrl = resolveApplicationUrl(process.env.DSH_ELECTRON_URL)
    }
    const window = createWindow()
    await window.loadURL(applicationUrl.href)
    configureApplicationMenu()
    void presentStartupUpdate()
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

// Dialog-only helper entry: relaunching the executable with the private
// helper argument opens exactly one native directory dialog and reports the
// outcome on stdout, so the WebUI child never touches the OS chooser. It runs
// before the single-instance lock, which the running main app already holds.
if (directoryPickerHelper) {
  app.disableHardwareAcceleration()
  void app.whenReady()
    .then(() => runDirectoryPickerHelper(async () => {
      const result = await dialog.showOpenDialog({
        title: 'Select Workspace Directory',
        properties: ['openDirectory', 'createDirectory'],
      })
      return result.canceled ? null : result.filePaths[0] ?? null
    }))
    .then((code) => { app.exit(code) }, () => { app.exit(1) })
} else if (app.requestSingleInstanceLock() === false) {
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

/** Electron main-process host for the existing dsh Web profile. */

import { join } from 'node:path'
import type { ElectronDesktopState } from '@deepseek-ai/dsh-client-ui-desktop-electron/bridge-contract'
import { clipboard, shell } from 'electron/common'
import { app, BrowserWindow, dialog, ipcMain, Menu, net, safeStorage, session } from 'electron/main'
import {
  createApplicationMenuTemplate,
  refreshRemoteAccessMenu,
  type ApplicationMenuOptions,
} from './application-menu.ts'
import { resolveApplicationUrl } from './application-url.ts'
import { WebBackend } from './backend.ts'
import { installDesktopBridge } from './desktop-bridge.ts'
import { FrpcClient } from './frpc.ts'
import {
  DIRECTORY_PICKER_HELPER_ARGUMENT,
  pickElectronDirectory,
  runDirectoryPickerHelper,
} from './directory-picker-helper.ts'
import {
  createApplicationNavigationGuard,
  isExternalNavigation,
  loadRestartedApplication,
} from './navigation.ts'
import { RemoteAccessController } from './remote-access-controller.ts'
import {
  changeRemoteAccessFromMenu,
  copyRemoteAccessUrl,
  showRemoteAccessDetails,
  type NativeRemoteAccessOptions,
} from './remote-access-menu.ts'
import { FatalRemoteAccessRecovery } from './remote-access-recovery.ts'
import {
  defaultRemoteAccessConfiguration,
  normalizeRemoteAccessConfiguration,
  redactRemoteAccessConfiguration,
  RemoteAccessConfigurationStore,
} from './remote-access-config.ts'
import { ExitBarrier } from './exit-barrier.ts'
import { synchronizeRendererAccessCookie } from './renderer-access-cookie.ts'
import { pickRemoteAccessFile } from './remote-access-file-picker.ts'
import {
  installUpdateAfterShutdown,
  OtaUpdateController,
  type InstallDownloadedUpdate,
} from './updater.ts'

app.setName('DeepSeek Harness')
app.setPath('userData', join(app.getPath('appData'), 'DeepSeek Harness'))

let mainWindow: BrowserWindow | undefined
let applicationUrl: URL | undefined
let remoteAccess: RemoteAccessController | undefined
let remoteAccessStore: RemoteAccessConfigurationStore | undefined
let quitting = false
const backend = new WebBackend()
const exitBarrier = new ExitBarrier()
const fatalRemoteAccessRecovery = new FatalRemoteAccessRecovery()
const directoryPickerHelper = process.argv.includes(DIRECTORY_PICKER_HELPER_ARGUMENT)
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
  return remoteAccess?.shutdown() ?? backend.stop()
}

function desktopState(): ElectronDesktopState {
  const controller = remoteAccess
  if (controller === undefined) throw new Error('Electron does not own this WebUI')
  const state = controller.getState()
  const configuration = redactRemoteAccessConfiguration(controller.getConfiguration())
  let publicEndpoint: string | undefined
  if (state.url !== undefined) {
    const endpoint = new URL(state.url)
    endpoint.hash = ''
    publicEndpoint = endpoint.href
  }
  return {
    currentVersion: app.getVersion(),
    remoteAccess: {
      enabled: state.enabled,
      preferredMode: configuration.mode,
      transitioning: state.transitioning,
      frp: configuration.frp,
      ...state.mode === undefined ? {} : { activeMode: state.mode },
      ...publicEndpoint === undefined ? {} : { publicEndpoint },
    },
    update: otaUpdater.getState(),
  }
}

function remoteAccessSecretCodec() {
  const requireSecureStorage = (): void => {
    if (!safeStorage.isEncryptionAvailable()) {
      throw new Error('The operating-system secret store is unavailable')
    }
    if (process.platform === 'linux' && safeStorage.getSelectedStorageBackend() === 'basic_text') {
      throw new Error('The Linux secret store is using unencrypted basic-text storage')
    }
  }
  return {
    encrypt(value: string): string {
      requireSecureStorage()
      return safeStorage.encryptString(value).toString('base64')
    },
    decrypt(value: string): string {
      requireSecureStorage()
      return safeStorage.decryptString(Buffer.from(value, 'base64'))
    },
  }
}

function relaunchAfterInstallFailure(error: Error): void {
  console.error('The downloaded update installer failed after process shutdown.', error)
  app.relaunch()
  app.exit(1)
}

function configureApplicationMenu(): void {
  const applicationName = app.getName()
  const currentVersion = app.getVersion()
  const controller = remoteAccess
  const menuOptions: ApplicationMenuOptions = {
    applicationName,
    checkForUpdates: () => otaUpdater.check(),
    currentVersion,
    installUpdate: () => otaUpdater.install(),
    platform: process.platform,
    showMessageBox: options => dialog.showMessageBox(options),
  }
  if (controller !== undefined) {
    menuOptions.remoteAccess = {
      state: controller.getState(),
      commands: {
        start: () => { runRemoteAccessChange(true) },
        stop: () => { runRemoteAccessChange(false) },
        showDetails: () => { runRemoteAccessDetails() },
        copyUrl: () => { runRemoteAccessCopy() },
      },
    }
  }
  app.setAboutPanelOptions({ applicationName, applicationVersion: currentVersion })
  Menu.setApplicationMenu(Menu.buildFromTemplate(createApplicationMenuTemplate(menuOptions)))
}

function nativeRemoteAccessOptions(controller: RemoteAccessController): NativeRemoteAccessOptions {
  return {
    applicationName: app.getName(),
    controller,
    navigate: navigateApplication,
    refreshMenu: refreshInstalledRemoteAccessMenu,
    showMessageBox: options => dialog.showMessageBox(options),
    writeText: (text) => { clipboard.writeText(text) },
  }
}

function refreshInstalledRemoteAccessMenu(): void {
  const controller = remoteAccess
  const menu = Menu.getApplicationMenu()
  if (controller === undefined || menu === null) return
  refreshRemoteAccessMenu(menu, controller.getState())
}

function logRemoteAccessMenuFailure(error: unknown): void {
  console.error('The native Electron remote-access command failed.', error)
}

function runRemoteAccessChange(enabled: boolean): void {
  const controller = remoteAccess
  if (controller === undefined) return
  void changeRemoteAccessFromMenu(enabled, nativeRemoteAccessOptions(controller))
    .catch(logRemoteAccessMenuFailure)
}

function runRemoteAccessDetails(): void {
  const controller = remoteAccess
  if (controller === undefined) return
  void showRemoteAccessDetails(nativeRemoteAccessOptions(controller))
    .catch(logRemoteAccessMenuFailure)
}

function runRemoteAccessCopy(): void {
  const controller = remoteAccess
  if (controller === undefined) return
  void copyRemoteAccessUrl(nativeRemoteAccessOptions(controller))
    .catch(logRemoteAccessMenuFailure)
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
      message: 'The downloaded update could not restart DeepSeek Harness.',
      detail,
    })
  }
}

async function setRemoteAccessFromRenderer(enabled: boolean): Promise<boolean> {
  const controller = remoteAccess
  if (controller === undefined) return false
  const result = await controller.setEnabled(enabled)
  refreshInstalledRemoteAccessMenu()
  const navigationUrl = result.navigationUrl
  if (navigationUrl !== undefined) {
    setImmediate(() => { navigateApplication(navigationUrl) })
  }
  return result.succeeded
}

async function saveRemoteAccessConfigurationFromRenderer(input: unknown): Promise<ElectronDesktopState> {
  const controller = remoteAccess
  const store = remoteAccessStore
  if (controller === undefined || store === undefined) throw new Error('Electron does not own this WebUI')
  const configuration = normalizeRemoteAccessConfiguration(input, controller.getConfiguration())
  const saved = await controller.setConfiguration(configuration, () => store.save(configuration))
  if (!saved) throw new Error('Remote-access settings can be changed only while remote access is off')
  return desktopState()
}

function reportRemoteAccessFailure(error: Error): void {
  if (quitting) return
  void dialog.showMessageBox({
    type: 'error',
    title: 'DeepSeek Harness',
    message: 'DeepSeek Harness could not change remote access.',
    detail: error.message,
  })
}

function reportFatalRemoteAccessFailure(error: Error): void {
  if (quitting) return
  void fatalRemoteAccessRecovery.run(
    () => dialog.showMessageBox({
      type: 'error',
      title: 'DeepSeek Harness',
      message: 'DeepSeek Harness must close because remote access could not recover safely.',
      detail: error.message,
    }),
    () => { app.quit() },
  )
}

function navigateApplication(url: URL): void {
  if (quitting) return
  const window = mainWindow
  void synchronizeRendererAccessCookie(
    session.defaultSession.cookies,
    url,
    remoteAccess?.getRendererAccessToken(),
  ).then(
    () => loadRestartedApplication(
      url,
      (next) => { applicationUrl = next },
      window === undefined ? undefined : target => window.loadURL(target),
      reportFatalRemoteAccessFailure,
    ),
    (error: unknown) => {
      const detail = error instanceof Error ? error.message : String(error)
      reportFatalRemoteAccessFailure(new Error(
        `The WebUI restarted at ${url.origin}, but Electron could not prepare local authentication: ${detail}`,
      ))
    },
  )
}

/** Create the isolated desktop window for one ready Web-profile origin. */
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
      ...remoteAccess === undefined
        ? {}
        : { preload: join(app.getAppPath(), 'lib', 'preload.cjs') },
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
    if (process.env.DSH_ELECTRON_URL === undefined) {
      const store = new RemoteAccessConfigurationStore(
        join(app.getPath('userData'), 'remote-access.json'),
        remoteAccessSecretCodec(),
      )
      const configuration = await store.load(defaultRemoteAccessConfiguration(
        process.env.DSH_ELECTRON_FRPC_PATH?.trim() || 'frpc',
      ))
      const controller = new RemoteAccessController({
        backend,
        frpc: new FrpcClient({ temporaryRoot: app.getPath('temp') }),
        configuration,
        cwd: process.env.DSH_ELECTRON_CWD?.trim() || defaultCwd,
        onTransitionError: (error, fatal, navigationUrl) => {
          if (navigationUrl !== undefined) setImmediate(() => { navigateApplication(navigationUrl) })
          if (fatal) reportFatalRemoteAccessFailure(error)
          else reportRemoteAccessFailure(error)
        },
        onUnexpectedExit: (code, signal) => {
          if (quitting) return
          void dialog.showMessageBox({
            type: 'error',
            title: 'DeepSeek Harness',
            message: 'The DeepSeek Harness WebUI stopped.',
            detail: signal === null ? `Exit code: ${String(code)}` : `Signal: ${signal}`,
          }).finally(() => { app.quit() })
        },
        pickDirectory: signal => pickElectronDirectory(signal, {
          execPath: process.execPath,
          applicationPath: app.getAppPath(),
          packaged: app.isPackaged,
        }),
      })
      remoteAccess = controller
      remoteAccessStore = store
      const location = await controller.start()
      applicationUrl = location.loopbackUrl
      installDesktopBridge(ipcMain, {
        applicationUrl: () => applicationUrl,
        webContents: () => mainWindow?.webContents,
        getState: desktopState,
        setRemoteAccessEnabled: setRemoteAccessFromRenderer,
        saveRemoteAccessConfiguration: saveRemoteAccessConfigurationFromRenderer,
        selectRemoteAccessFile: kind => pickRemoteAccessFile(dialog, kind),
        copyRemoteAccessUrl: async () => {
          const current = remoteAccess
          return current === undefined ? false : copyRemoteAccessUrl(nativeRemoteAccessOptions(current))
        },
        checkForUpdates: async () => {
          await otaUpdater.check()
          return desktopState()
        },
        installUpdate: () => otaUpdater.install(),
      })
    } else {
      applicationUrl = resolveApplicationUrl(process.env.DSH_ELECTRON_URL)
      remoteAccess = undefined
      remoteAccessStore = undefined
    }
    const window = createWindow()
    void otaUpdater.check()
    if (remoteAccess !== undefined) {
      await synchronizeRendererAccessCookie(
        session.defaultSession.cookies,
        applicationUrl,
        remoteAccess.getRendererAccessToken(),
      )
    }
    await window.loadURL(applicationUrl.href)
    configureApplicationMenu()
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    await dialog.showMessageBox({
      type: 'error',
      title: 'DeepSeek Harness',
      message: 'DeepSeek Harness WebUI is unavailable.',
      detail,
    })
    app.quit()
  }
}

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
} else if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (mainWindow === undefined && applicationUrl !== undefined) {
      const window = createWindow()
      if (remoteAccess === undefined) void window.loadURL(applicationUrl.href)
      else navigateApplication(applicationUrl)
    }
    mainWindow?.restore()
    mainWindow?.focus()
  })
  app.on('activate', () => {
    if (mainWindow === undefined && applicationUrl !== undefined) {
      const window = createWindow()
      if (remoteAccess === undefined) void window.loadURL(applicationUrl.href)
      else navigateApplication(applicationUrl)
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
        console.error('Failed to stop Electron-owned processes during exit.', error)
      },
    )
  })
  void app.whenReady().then(start)
}

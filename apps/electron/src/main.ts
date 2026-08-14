/** Electron main-process host for the existing dsh Web profile. */

import { join } from 'node:path'
import { shell } from 'electron/common'
import { app, BrowserWindow, dialog } from 'electron/main'
import { resolveApplicationUrl } from './application-url.ts'
import { WebBackend } from './backend.ts'
import { isApplicationNavigation, isExternalNavigation } from './navigation.ts'

app.setName('DeepSeek Harness')
app.setPath('userData', join(app.getPath('appData'), 'DeepSeek Harness'))

let mainWindow: BrowserWindow | undefined
let applicationUrl: URL | undefined
let quitting = false
const backend = new WebBackend()

function openExternal(target: string): void {
  if (isExternalNavigation(target)) void shell.openExternal(target)
}

/** Create the isolated desktop window for one ready Web-profile origin. */
function createWindow(url: URL): BrowserWindow {
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
    if (isApplicationNavigation(target, url)) void window.loadURL(target)
    else openExternal(target)
    return { action: 'deny' }
  })
  window.webContents.on('will-navigate', (event, target) => {
    if (isApplicationNavigation(target, url)) return
    event.preventDefault()
    openExternal(target)
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
    applicationUrl = process.env.DSH_ELECTRON_URL === undefined
      ? await backend.start(
        process.env.DSH_ELECTRON_CWD?.trim() || defaultCwd,
        (code, signal) => {
          if (quitting) return
          void dialog.showMessageBox({
            type: 'error',
            title: 'DeepSeek Harness',
            message: 'The DeepSeek Harness WebUI stopped.',
            detail: signal === null ? `Exit code: ${String(code)}` : `Signal: ${signal}`,
          }).finally(() => { app.quit() })
        },
      )
      : resolveApplicationUrl(process.env.DSH_ELECTRON_URL)
    const window = createWindow(applicationUrl)
    await window.loadURL(applicationUrl.href)
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

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (mainWindow === undefined && applicationUrl !== undefined) {
      const window = createWindow(applicationUrl)
      void window.loadURL(applicationUrl.href)
    }
    mainWindow?.restore()
    mainWindow?.focus()
  })
  app.on('activate', () => {
    if (mainWindow === undefined && applicationUrl !== undefined) {
      const window = createWindow(applicationUrl)
      void window.loadURL(applicationUrl.href)
    }
  })
  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })
  app.on('before-quit', (event) => {
    if (quitting) return
    event.preventDefault()
    quitting = true
    void backend.stop().finally(() => { app.quit() })
  })
  void app.whenReady().then(start)
}

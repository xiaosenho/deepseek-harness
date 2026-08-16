/** Authorized IPC handlers for Electron-managed WebUI desktop controls. */

import type {
  ElectronDesktopState,
  ElectronRemoteAccessFileKind,
} from '@deepseek-ai/dsh-client-ui-desktop-electron/bridge-contract'
import type { IpcMain, IpcMainInvokeEvent, WebContents } from 'electron/main'

/** IPC channel names shared with the sandboxed preload. */
export const DESKTOP_BRIDGE_CHANNELS = {
  state: 'dsh/electron-desktop/state',
  remoteAccess: 'dsh/electron-desktop/remote-access',
  remoteAccessConfiguration: 'dsh/electron-desktop/remote-access-configuration',
  remoteAccessFile: 'dsh/electron-desktop/remote-access-file',
  copyRemoteAccess: 'dsh/electron-desktop/copy-remote-access',
  checkUpdates: 'dsh/electron-desktop/check-updates',
  installUpdate: 'dsh/electron-desktop/install-update',
} as const

/** Main-process operations exposed through the narrow bridge. */
export interface DesktopBridgeOperations {
  /** Current managed window contents. */
  webContents: () => WebContents | undefined
  /** Current managed WebUI URL, which changes after a backend restart. */
  applicationUrl: () => URL | undefined
  /** Read JSON-safe desktop state. */
  getState: () => ElectronDesktopState
  /** Change remote-access mode. */
  setRemoteAccessEnabled: (enabled: boolean) => Promise<boolean>
  /** Validate and persist remote-access preferences. */
  saveRemoteAccessConfiguration: (input: unknown) => Promise<ElectronDesktopState>
  /** Select one FRP file through a purpose-specific native dialog. */
  selectRemoteAccessFile: (kind: ElectronRemoteAccessFileKind) => Promise<string | null>
  /** Copy the current credential-bearing remote URL. */
  copyRemoteAccessUrl: () => Promise<boolean>
  /** Check and prepare a trusted update. */
  checkForUpdates: () => Promise<ElectronDesktopState>
  /** Install a prepared update. */
  installUpdate: () => Promise<boolean>
}

function authorize(event: IpcMainInvokeEvent, operations: DesktopBridgeOperations): void {
  const contents = operations.webContents()
  const expected = operations.applicationUrl()
  const frame = event.senderFrame
  if (
    contents === undefined
    || expected === undefined
    || event.sender !== contents
    || frame === null
    || frame !== contents.mainFrame
  ) {
    throw new Error('Electron desktop bridge request is not authorized')
  }
  let actual: URL
  try {
    actual = new URL(frame.url)
  } catch {
    throw new Error('Electron desktop bridge request is not authorized')
  }
  if (actual.origin !== expected.origin) {
    throw new Error('Electron desktop bridge request is not authorized')
  }
}

/**
 * Install the desktop handlers and return their exact disposer.
 * @param ipc - Electron main-process IPC registry.
 * @param operations - authoritative window, backend, clipboard, and updater operations.
 * @returns a disposer that removes every installed handler.
 */
export function installDesktopBridge(ipc: Pick<IpcMain, 'handle' | 'removeHandler'>, operations: DesktopBridgeOperations): () => void {
  ipc.handle(DESKTOP_BRIDGE_CHANNELS.state, (event) => {
    authorize(event, operations)
    return operations.getState()
  })
  ipc.handle(DESKTOP_BRIDGE_CHANNELS.remoteAccess, (event, enabled: unknown) => {
    authorize(event, operations)
    if (typeof enabled !== 'boolean') throw new Error('Electron remote-access state must be boolean')
    return operations.setRemoteAccessEnabled(enabled)
  })
  ipc.handle(DESKTOP_BRIDGE_CHANNELS.remoteAccessConfiguration, (event, input: unknown) => {
    authorize(event, operations)
    return operations.saveRemoteAccessConfiguration(input)
  })
  ipc.handle(DESKTOP_BRIDGE_CHANNELS.remoteAccessFile, (event, kind: unknown) => {
    authorize(event, operations)
    if (kind !== 'frpc-executable' && kind !== 'trusted-ca') {
      throw new Error('Electron remote-access file kind is invalid')
    }
    return operations.selectRemoteAccessFile(kind)
  })
  ipc.handle(DESKTOP_BRIDGE_CHANNELS.copyRemoteAccess, (event) => {
    authorize(event, operations)
    return operations.copyRemoteAccessUrl()
  })
  ipc.handle(DESKTOP_BRIDGE_CHANNELS.checkUpdates, async (event) => {
    authorize(event, operations)
    return operations.checkForUpdates()
  })
  ipc.handle(DESKTOP_BRIDGE_CHANNELS.installUpdate, (event) => {
    authorize(event, operations)
    return operations.installUpdate()
  })
  return () => {
    for (const channel of Object.values(DESKTOP_BRIDGE_CHANNELS)) ipc.removeHandler(channel)
  }
}

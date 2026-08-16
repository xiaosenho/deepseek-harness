/** Sandboxed preload exposing only the managed desktop control API. */

import type { ElectronDesktopBridge } from '@deepseek-ai/dsh-client-ui-desktop-electron/bridge-contract'
import { contextBridge, ipcRenderer } from 'electron'
import { DESKTOP_BRIDGE_CHANNELS } from './desktop-bridge.ts'

const bridge: ElectronDesktopBridge = {
  getDesktopState: () => ipcRenderer.invoke(DESKTOP_BRIDGE_CHANNELS.state),
  setRemoteAccessEnabled: enabled => ipcRenderer.invoke(DESKTOP_BRIDGE_CHANNELS.remoteAccess, enabled),
  saveRemoteAccessConfiguration: input => ipcRenderer.invoke(
    DESKTOP_BRIDGE_CHANNELS.remoteAccessConfiguration,
    input,
  ),
  selectRemoteAccessFile: kind => ipcRenderer.invoke(DESKTOP_BRIDGE_CHANNELS.remoteAccessFile, kind),
  copyRemoteAccessUrl: () => ipcRenderer.invoke(DESKTOP_BRIDGE_CHANNELS.copyRemoteAccess),
  checkForUpdates: () => ipcRenderer.invoke(DESKTOP_BRIDGE_CHANNELS.checkUpdates),
  installUpdate: () => ipcRenderer.invoke(DESKTOP_BRIDGE_CHANNELS.installUpdate),
}

contextBridge.exposeInMainWorld('dshElectron', bridge)

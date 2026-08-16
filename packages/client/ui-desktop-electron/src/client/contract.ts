import type { HostObservable, InjectFace } from '@deepseek-ai/dsh-client-ui-slots'
import type { DesktopControlSnapshot } from './desktop-controller.ts'
import type {
  ElectronRemoteAccessConfigurationInput,
  ElectronRemoteAccessFileKind,
} from '../bridge-contract.ts'

/** Shared injected operations and state for every Electron-only UI contribution. */
export interface DesktopControlInjected {
  hooks: {
    /** Current main-process desktop state. */
    desktopControl: HostObservable<DesktopControlSnapshot>
  }
  /** Start or stop the configured authenticated remote transport. */
  setRemoteAccessEnabled: (enabled: boolean) => Promise<boolean>
  /** Validate and persist the preferred transport and FRP settings. */
  saveRemoteAccessConfiguration: (input: ElectronRemoteAccessConfigurationInput) => Promise<void>
  /** Select one FRP file through the managed Electron window. */
  selectRemoteAccessFile: (kind: ElectronRemoteAccessFileKind) => Promise<string | null>
  /** Copy the current complete remote URL through Electron main. */
  copyRemoteAccessUrl: () => Promise<boolean>
  /** Refresh update availability. */
  checkForUpdates: () => Promise<void>
  /** Install the prepared update and restart the application. */
  installUpdate: () => Promise<boolean>
}

/** Renderer-bound form of the shared injected face. */
export type DesktopControlFace = InjectFace<DesktopControlInjected>

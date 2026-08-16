/** Remote-access transport selected for the next Electron-owned exposure. */
export type ElectronRemoteAccessMode = 'lan' | 'frp'

/** Remote-access file selected through an Electron-owned native dialog. */
export type ElectronRemoteAccessFileKind = 'frpc-executable' | 'trusted-ca'

/** Redacted FRP settings returned by the Electron main process. */
export interface ElectronFrpConfiguration {
  /** Public frps IP address or hostname, without a scheme or port. */
  serverAddress: string
  /** frpc-to-frps control port. */
  serverPort: number
  /** Public TCP proxy port, or zero for frps assignment. */
  remotePort: number
  /** Optional externally terminated HTTP(S) origin; blank derives an HTTP origin from frps. */
  publicOrigin: string
  /** frpc executable path or PATH name. */
  executablePath: string
  /** CA certificate file used to verify the frps TLS certificate. */
  tlsTrustedCaFile: string
  /** Optional certificate server name; blank verifies against serverAddress. */
  tlsServerName: string
  /** Whether an frps authentication token is stored. */
  authTokenConfigured: boolean
  /** Explicit acknowledgement required for a plaintext public origin. */
  allowInsecureHttp: boolean
}

/** One-way update for the stored frps authentication token. */
export type ElectronFrpTokenUpdate =
  | { action: 'keep' }
  | { action: 'replace'; value: string }
  | { action: 'clear' }

/** User-editable remote-access settings sent to Electron main. */
export interface ElectronRemoteAccessConfigurationInput {
  /** Transport used by the next enable action. */
  mode: ElectronRemoteAccessMode
  /** Complete non-secret FRP draft and an explicit secret update. */
  frp: Omit<ElectronFrpConfiguration, 'authTokenConfigured'> & {
    authToken: ElectronFrpTokenUpdate
  }
}

/** JSON-safe remote-access state returned by the Electron main process. */
export interface ElectronRemoteAccessState {
  /** Whether one authenticated remote-access transport is active. */
  enabled: boolean
  /** Active transport while enabled. */
  activeMode?: ElectronRemoteAccessMode
  /** Transport selected for the next enable action. */
  preferredMode: ElectronRemoteAccessMode
  /** Credential-free endpoint while enabled and settled. */
  publicEndpoint?: string
  /** Whether Electron is replacing the owned Web backend. */
  transitioning: boolean
  /** Stored FRP settings with the authentication token redacted. */
  frp: ElectronFrpConfiguration
}

/** JSON-safe update state returned by the Electron main process. */
export type ElectronUpdateState =
  | { status: 'idle' | 'checking' | 'disabled' | 'unsupported' | 'no-release' | 'current' }
  | { status: 'ready'; version: string; changelog: string }
  | { status: 'failed'; detail: string }

/** Desktop facts available only to the Electron-managed local renderer. */
export interface ElectronDesktopState {
  /** Installed application version. */
  currentVersion: string
  /** Authoritative remote-access controller state. */
  remoteAccess: ElectronRemoteAccessState
  /** Authoritative updater state. */
  update: ElectronUpdateState
}

/** Narrow preload API exposed only to the Electron-managed local WebUI. */
export interface ElectronDesktopBridge {
  /** Read current application, remote-access, and updater state. */
  getDesktopState(): Promise<ElectronDesktopState>
  /** Start or stop the configured authenticated remote transport. */
  setRemoteAccessEnabled(enabled: boolean): Promise<boolean>
  /** Validate and persist the next remote-access transport and FRP settings. */
  saveRemoteAccessConfiguration(input: ElectronRemoteAccessConfigurationInput): Promise<ElectronDesktopState>
  /** Select one FRP file without exposing a general filesystem API. */
  selectRemoteAccessFile(kind: ElectronRemoteAccessFileKind): Promise<string | null>
  /** Copy the current complete remote-access URL in Electron main. */
  copyRemoteAccessUrl(): Promise<boolean>
  /** Check and prepare the newest trusted desktop update. */
  checkForUpdates(): Promise<ElectronDesktopState>
  /** Install the prepared update after orderly application shutdown. */
  installUpdate(): Promise<boolean>
}

declare global {
  interface Window {
    /** Present only in the Electron-managed local renderer. */
    dshElectron?: ElectronDesktopBridge
  }
}

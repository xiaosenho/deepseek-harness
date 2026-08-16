/** React-free controller for the Electron preload bridge. */

import type {
  ElectronDesktopBridge,
  ElectronDesktopState,
  ElectronRemoteAccessConfigurationInput,
  ElectronRemoteAccessFileKind,
} from '../bridge-contract.ts'

/** Immutable controller snapshot consumed through the slot hook binding. */
export type DesktopControlSnapshot =
  | { phase: 'loading' }
  | { phase: 'ready'; value: ElectronDesktopState }
  | { phase: 'failed' }

const POLL_INTERVAL_MS = 1_000

function record(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error(`${label} is invalid`)
  return value as Record<string, unknown>
}

function exactKeys(value: Record<string, unknown>, allowed: readonly string[], label: string): void {
  if (Object.keys(value).some(key => !allowed.includes(key))) throw new Error(`${label} is invalid`)
}

function parsePort(value: unknown, allowZero: boolean): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < (allowZero ? 0 : 1) || value > 65_535) {
    throw new Error('Electron desktop state has an invalid FRP port')
  }
  return value
}

function parseString(value: unknown, label: string): string {
  if (typeof value !== 'string') throw new Error(`Electron ${label} is invalid`)
  return value
}

function parsePublicEndpoint(value: unknown): string | undefined {
  if (value === undefined) return undefined
  if (typeof value !== 'string') throw new Error('Electron desktop state has an invalid public endpoint')
  const endpoint = new URL(value)
  if (
    (endpoint.protocol !== 'http:' && endpoint.protocol !== 'https:')
    || endpoint.hash !== ''
    || endpoint.search !== ''
    || endpoint.username !== ''
    || endpoint.password !== ''
  ) throw new Error('Electron desktop state exposed a credential-bearing endpoint')
  return endpoint.href
}

/**
 * Validate the JSON-safe state returned across Electron IPC.
 * @param value - untrusted preload result.
 * @returns the complete normalized desktop state.
 */
export function parseElectronDesktopState(value: unknown): ElectronDesktopState {
  const root = record(value, 'Electron desktop state')
  exactKeys(root, ['currentVersion', 'remoteAccess', 'update'], 'Electron desktop state')
  if (typeof root.currentVersion !== 'string') throw new Error('Electron desktop version is invalid')
  const remote = record(root.remoteAccess, 'Electron remote-access state')
  exactKeys(remote, [
    'enabled', 'activeMode', 'preferredMode', 'publicEndpoint', 'transitioning', 'frp',
  ], 'Electron remote-access state')
  if (typeof remote.enabled !== 'boolean' || typeof remote.transitioning !== 'boolean') {
    throw new Error('Electron remote-access state is invalid')
  }
  if (remote.preferredMode !== 'lan' && remote.preferredMode !== 'frp') {
    throw new Error('Electron preferred remote-access mode is invalid')
  }
  if (remote.activeMode !== undefined && remote.activeMode !== 'lan' && remote.activeMode !== 'frp') {
    throw new Error('Electron active remote-access mode is invalid')
  }
  if (remote.enabled !== (remote.activeMode !== undefined)) {
    throw new Error('Electron active remote-access state is inconsistent')
  }
  const publicEndpoint = parsePublicEndpoint(remote.publicEndpoint)
  if (!remote.enabled && publicEndpoint !== undefined) {
    throw new Error('Electron disabled remote access retained a public endpoint')
  }
  const frp = record(remote.frp, 'Electron FRP state')
  exactKeys(frp, [
    'serverAddress', 'serverPort', 'remotePort', 'publicOrigin', 'executablePath',
    'tlsTrustedCaFile', 'tlsServerName', 'authTokenConfigured', 'allowInsecureHttp',
  ], 'Electron FRP state')
  if (typeof frp.authTokenConfigured !== 'boolean' || typeof frp.allowInsecureHttp !== 'boolean') {
    throw new Error('Electron FRP flags are invalid')
  }
  const update = record(root.update, 'Electron update state')
  const statuses = new Set([
    'idle', 'checking', 'disabled', 'unsupported', 'no-release', 'current', 'ready', 'failed',
  ])
  if (typeof update.status !== 'string' || !statuses.has(update.status)) {
    throw new Error('Electron update status is invalid')
  }
  if (update.status === 'ready') {
    exactKeys(update, ['status', 'version', 'changelog'], 'Electron ready update state')
    if (typeof update.version !== 'string' || typeof update.changelog !== 'string') {
      throw new Error('Electron ready update state is invalid')
    }
  } else if (update.status === 'failed') {
    exactKeys(update, ['status', 'detail'], 'Electron failed update state')
    if (typeof update.detail !== 'string') throw new Error('Electron failed update state is invalid')
  } else {
    exactKeys(update, ['status'], 'Electron update state')
  }
  return {
    currentVersion: root.currentVersion,
    remoteAccess: {
      enabled: remote.enabled,
      preferredMode: remote.preferredMode,
      transitioning: remote.transitioning,
      frp: {
        serverAddress: parseString(frp.serverAddress, 'FRP server address'),
        serverPort: parsePort(frp.serverPort, false),
        remotePort: parsePort(frp.remotePort, true),
        publicOrigin: parseString(frp.publicOrigin, 'FRP public origin'),
        executablePath: parseString(frp.executablePath, 'frpc executable'),
        tlsTrustedCaFile: parseString(frp.tlsTrustedCaFile, 'FRP trusted CA file'),
        tlsServerName: parseString(frp.tlsServerName, 'FRP TLS server name'),
        authTokenConfigured: frp.authTokenConfigured,
        allowInsecureHttp: frp.allowInsecureHttp,
      },
      ...remote.activeMode === undefined ? {} : { activeMode: remote.activeMode },
      ...publicEndpoint === undefined ? {} : { publicEndpoint },
    },
    update: update as ElectronDesktopState['update'],
  }
}

/**
 * Resolve a complete bridge without accepting partial globals from other pages.
 * @param value - candidate global exposed to the renderer.
 * @returns the complete bridge, or undefined when any method is absent.
 */
export function resolveElectronDesktopBridge(value: unknown): ElectronDesktopBridge | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const candidate = value as Partial<ElectronDesktopBridge>
  return typeof candidate.getDesktopState === 'function'
    && typeof candidate.setRemoteAccessEnabled === 'function'
    && typeof candidate.saveRemoteAccessConfiguration === 'function'
    && typeof candidate.selectRemoteAccessFile === 'function'
    && typeof candidate.copyRemoteAccessUrl === 'function'
    && typeof candidate.checkForUpdates === 'function'
    && typeof candidate.installUpdate === 'function'
    ? candidate as ElectronDesktopBridge
    : undefined
}

/** Owns bridge reads, command serialization, and short-lived transition polling. */
export class DesktopControlController {
  private snapshot: DesktopControlSnapshot = { phase: 'loading' }
  private listeners = new Set<() => void>()
  private disposed = false
  private pollTimer: number | undefined
  private commandTail: Promise<void> = Promise.resolve()
  private readSequence = 0

  /** @param bridge - validated preload bridge for the managed local renderer. */
  constructor(private readonly bridge: ElectronDesktopBridge) {}

  /** Return the stable snapshot reference until a bridge result changes it. */
  getSnapshot = (): DesktopControlSnapshot => this.snapshot

  /** Subscribe to snapshot replacements. */
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  /** Load initial state and poll only while Electron reports a transition. */
  async start(): Promise<void> {
    await this.refresh()
  }

  /** Stop polling and suppress late publications. */
  dispose(): void {
    this.disposed = true
    window.clearTimeout(this.pollTimer)
    this.pollTimer = undefined
    this.listeners.clear()
  }

  /**
   * Request a remote-access mode change and refresh if the page remains loaded.
   * @param enabled - whether the configured remote transport should be active.
   * @returns whether Electron reached the requested state.
   */
  async setRemoteAccessEnabled(enabled: boolean): Promise<boolean> {
    return this.enqueue(async () => {
      const changed = await this.bridge.setRemoteAccessEnabled(enabled)
      await this.refresh()
      return changed
    })
  }

  /**
   * Validate and save remote-access preferences through Electron main.
   * @param input - complete non-secret draft plus the explicit token update.
   */
  async saveRemoteAccessConfiguration(input: ElectronRemoteAccessConfigurationInput): Promise<void> {
    await this.enqueue(async () => {
      const value = parseElectronDesktopState(await this.bridge.saveRemoteAccessConfiguration(input))
      this.readSequence += 1
      this.publish({ phase: 'ready', value })
      this.schedulePoll()
    })
  }

  /**
   * Open one native FRP file selector through Electron main.
   * @param kind - fixed selector purpose and file filtering policy.
   * @returns the selected absolute path, or null after cancellation.
   */
  selectRemoteAccessFile(kind: ElectronRemoteAccessFileKind): Promise<string | null> {
    return this.bridge.selectRemoteAccessFile(kind)
  }

  /**
   * Copy the current credential-bearing URL through Electron main.
   * @returns whether an active URL was copied.
   */
  copyRemoteAccessUrl(): Promise<boolean> {
    return this.bridge.copyRemoteAccessUrl()
  }

  /** Run an on-demand update check and adopt its returned state. */
  async checkForUpdates(): Promise<void> {
    await this.enqueue(async () => {
      const value = parseElectronDesktopState(await this.bridge.checkForUpdates())
      this.readSequence += 1
      this.publish({ phase: 'ready', value })
      this.schedulePoll()
    })
  }

  /**
   * Install the verified update prepared by Electron.
   * @returns whether a prepared update started installation.
   */
  installUpdate(): Promise<boolean> {
    return this.bridge.installUpdate()
  }

  private async refresh(): Promise<void> {
    const sequence = ++this.readSequence
    try {
      const value = parseElectronDesktopState(await this.bridge.getDesktopState())
      if (sequence !== this.readSequence) return
      this.publish({ phase: 'ready', value })
      this.schedulePoll()
    } catch {
      if (sequence !== this.readSequence) return
      this.publish({ phase: 'failed' })
    }
  }

  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const task = this.commandTail.then(operation, operation)
    this.commandTail = task.then(() => {}, () => {})
    return task
  }

  private publish(snapshot: DesktopControlSnapshot): void {
    if (this.disposed) return
    this.snapshot = snapshot
    for (const listener of this.listeners) listener()
  }

  private schedulePoll(): void {
    window.clearTimeout(this.pollTimer)
    this.pollTimer = undefined
    if (this.snapshot.phase !== 'ready') return
    const { remoteAccess, update } = this.snapshot.value
    if (!remoteAccess.enabled && !remoteAccess.transitioning && update.status !== 'checking') return
    this.pollTimer = window.setTimeout(() => {
      this.pollTimer = undefined
      void this.refresh()
    }, POLL_INTERVAL_MS)
  }
}

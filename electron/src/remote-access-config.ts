/** Validated, redacted, and owner-only Electron remote-access preferences. */

import { isIP } from 'node:net'
import { readFile } from 'node:fs/promises'
import { writeFileAtomic } from '@deepseek-ai/dsh-atomic-write'
import type {
  ElectronFrpConfiguration,
} from '@deepseek-ai/dsh-client-ui-desktop-electron/bridge-contract'

const CONFIG_VERSION = 2
const MAX_TEXT_LENGTH = 4_096

/** Complete main-process FRP configuration, including the optional frps secret. */
export interface FrpRemoteAccessConfiguration extends Omit<ElectronFrpConfiguration, 'authTokenConfigured'> {
  /** Optional shared token configured on frps. */
  authToken?: string
}

/** Persisted transport preference; enabled runtime state is deliberately absent. */
export interface RemoteAccessConfiguration {
  /** Transport used by the next enable action. */
  mode: 'lan' | 'frp'
  /** Validated FRP client settings. */
  frp: FrpRemoteAccessConfiguration
}

/** OS-backed encryption adapter for the optional stored frps token. */
export interface RemoteAccessSecretCodec {
  /** Encrypt a secret into a JSON-safe opaque string. */
  encrypt: (value: string) => string
  /** Decrypt an opaque stored value. */
  decrypt: (value: string) => string
}

interface StoredRemoteAccessConfiguration {
  version: typeof CONFIG_VERSION
  mode: 'lan' | 'frp'
  frp: Omit<FrpRemoteAccessConfiguration, 'authToken'> & {
    encryptedAuthToken?: string
  }
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`${label} must be an object`)
  }
  return value as Record<string, unknown>
}

function exactKeys(value: Record<string, unknown>, allowed: readonly string[], label: string): void {
  const unexpected = Object.keys(value).filter(key => !allowed.includes(key))
  if (unexpected.length > 0) throw new Error(`${label} has unexpected field ${unexpected[0]}`)
}

function text(value: unknown, label: string, allowEmpty = false): string {
  if (typeof value !== 'string') throw new Error(`${label} must be a string`)
  const normalized = value.trim()
  if (!allowEmpty && normalized === '') throw new Error(`${label} must not be empty`)
  if (normalized.length > MAX_TEXT_LENGTH) throw new Error(`${label} is too long`)
  return normalized
}

function port(value: unknown, label: string, allowZero = false): number {
  if (!Number.isInteger(value) || typeof value !== 'number') throw new Error(`${label} must be an integer`)
  if (value < (allowZero ? 0 : 1) || value > 65_535) {
    throw new Error(`${label} must be between ${allowZero ? '0' : '1'} and 65535`)
  }
  return value
}

function boolean(value: unknown, label: string): boolean {
  if (typeof value !== 'boolean') throw new Error(`${label} must be boolean`)
  return value
}

/** Normalize a bare IP address or DNS hostname for frpc. */
function normalizeBareHost(value: unknown, label: string, allowEmpty: boolean): string {
  const normalized = text(value, label, allowEmpty)
  if (normalized === '') return ''
  if (normalized === '0.0.0.0' || normalized === '::') {
    throw new Error(`${label} must name one server`)
  }
  if (isIP(normalized) !== 0) return normalized
  if (/[\s/:@?#\[\]]/u.test(normalized)) {
    throw new Error(`${label} must be a bare IP address or hostname`)
  }
  let parsed: URL
  try {
    parsed = new URL(`http://${normalized}`)
  } catch {
    throw new Error(`${label} must be a bare IP address or hostname`)
  }
  if (parsed.hostname === '') {
    throw new Error(`${label} must name one server`)
  }
  return parsed.hostname
}

/** Normalize a bare IP address or DNS hostname for frpc. */
export function normalizeFrpServerAddress(value: unknown, allowEmpty = false): string {
  return normalizeBareHost(value, 'FRP server address', allowEmpty)
}

function hostAuthority(hostname: string, value: number | undefined): string {
  const host = isIP(hostname) === 6 ? `[${hostname}]` : hostname
  return value === undefined ? host : `${host}:${String(value)}`
}

function normalizePublicOrigin(value: unknown, allowEmpty: boolean): string {
  const normalized = text(value, 'FRP public origin', allowEmpty)
  if (normalized === '') return ''
  let parsed: URL
  try {
    parsed = new URL(normalized)
  } catch {
    throw new Error('FRP public origin must be an HTTP or HTTPS origin')
  }
  if (
    (parsed.protocol !== 'http:' && parsed.protocol !== 'https:')
    || parsed.username !== ''
    || parsed.password !== ''
    || parsed.pathname !== '/'
    || parsed.search !== ''
    || parsed.hash !== ''
  ) {
    throw new Error('FRP public origin must contain only an HTTP or HTTPS authority')
  }
  return parsed.origin
}

function normalizeFrp(
  value: unknown,
  requireEndpoint: boolean,
): Omit<FrpRemoteAccessConfiguration, 'authToken'> {
  const input = record(value, 'FRP configuration')
  exactKeys(input, [
    'serverAddress',
    'serverPort',
    'remotePort',
    'publicOrigin',
    'executablePath',
    'tlsTrustedCaFile',
    'tlsServerName',
    'allowInsecureHttp',
    'authToken',
    'encryptedAuthToken',
  ], 'FRP configuration')
  const serverAddress = normalizeFrpServerAddress(input.serverAddress, !requireEndpoint)
  const remotePort = port(input.remotePort, 'FRP public port', true)
  const publicOrigin = normalizePublicOrigin(input.publicOrigin, true)
  const tlsTrustedCaFile = text(input.tlsTrustedCaFile, 'FRP trusted CA file', !requireEndpoint)
  const tlsServerName = normalizeBareHost(input.tlsServerName, 'FRP TLS server name', true)
  const allowInsecureHttp = boolean(input.allowInsecureHttp, 'FRP plaintext acknowledgement')
  if (requireEndpoint && publicOrigin !== '' && remotePort === 0) {
    throw new Error('FRP automatic public ports cannot use a separate public origin')
  }
  const publicProtocol = publicOrigin === '' ? 'http:' : new URL(publicOrigin).protocol
  if (requireEndpoint && publicProtocol === 'http:' && !allowInsecureHttp) {
    throw new Error('FRP plaintext public access requires explicit acknowledgement')
  }
  return {
    serverAddress,
    serverPort: port(input.serverPort, 'frps port'),
    remotePort,
    publicOrigin,
    executablePath: text(input.executablePath, 'frpc executable'),
    tlsTrustedCaFile,
    tlsServerName,
    allowInsecureHttp,
  }
}

/** Initial preferences for an application that has never saved FRP settings. */
export function defaultRemoteAccessConfiguration(executablePath = 'frpc'): RemoteAccessConfiguration {
  return {
    mode: 'lan',
    frp: {
      serverAddress: '',
      serverPort: 7_000,
      remotePort: 0,
      publicOrigin: '',
      executablePath,
      tlsTrustedCaFile: '',
      tlsServerName: '',
      allowInsecureHttp: false,
    },
  }
}

/**
 * Validate one renderer update and apply its explicit token operation.
 * @param value - untrusted IPC payload.
 * @param current - current secret-bearing preferences.
 * @returns normalized complete preferences.
 */
export function normalizeRemoteAccessConfiguration(
  value: unknown,
  current: RemoteAccessConfiguration,
): RemoteAccessConfiguration {
  const input = record(value, 'Remote-access configuration')
  exactKeys(input, ['mode', 'frp'], 'Remote-access configuration')
  if (input.mode !== 'lan' && input.mode !== 'frp') {
    throw new Error('Remote-access mode must be lan or frp')
  }
  const rawFrp = record(input.frp, 'FRP configuration')
  exactKeys(rawFrp, [
    'serverAddress',
    'serverPort',
    'remotePort',
    'publicOrigin',
    'executablePath',
    'tlsTrustedCaFile',
    'tlsServerName',
    'allowInsecureHttp',
    'authToken',
  ], 'FRP configuration')
  const normalized = normalizeFrp(rawFrp, input.mode === 'frp')
  const token = record(rawFrp.authToken, 'FRP token update')
  exactKeys(token, token.action === 'replace' ? ['action', 'value'] : ['action'], 'FRP token update')
  let authToken = current.frp.authToken
  if (token.action === 'clear') authToken = undefined
  else if (token.action === 'replace') authToken = text(token.value, 'FRP authentication token')
  else if (token.action !== 'keep') throw new Error('FRP token update action is invalid')
  return {
    mode: input.mode,
    frp: { ...normalized, ...authToken === undefined ? {} : { authToken } },
  }
}

/** Redact the optional frps token before state crosses the preload bridge. */
export function redactRemoteAccessConfiguration(
  configuration: RemoteAccessConfiguration,
): { mode: 'lan' | 'frp'; frp: ElectronFrpConfiguration } {
  const { authToken, ...frp } = configuration.frp
  return {
    mode: configuration.mode,
    frp: { ...frp, authTokenConfigured: authToken !== undefined },
  }
}

/** Host authority admitted by the token-protected reverse WebUI. */
export function frpTrustedAuthority(configuration: FrpRemoteAccessConfiguration): string {
  if (configuration.publicOrigin !== '') return new URL(configuration.publicOrigin).host
  return hostAuthority(
    configuration.serverAddress,
    configuration.remotePort === 0 ? undefined : configuration.remotePort,
  )
}

/** Public origin after frps reports the actual TCP proxy port. */
export function frpPublicOrigin(configuration: FrpRemoteAccessConfiguration, actualRemotePort: number): URL {
  if (configuration.publicOrigin !== '') return new URL(configuration.publicOrigin)
  return new URL(`http://${hostAuthority(configuration.serverAddress, actualRemotePort)}`)
}

/** Owner-only JSON store for remote-access preferences. */
export class RemoteAccessConfigurationStore {
  /** @param filename - user-data JSON path; @param codec - OS-backed secret encryption. */
  constructor(
    private readonly filename: string,
    private readonly codec: RemoteAccessSecretCodec,
  ) {}

  /** Load and validate the complete current file, or return the supplied first-run defaults. */
  async load(defaults: RemoteAccessConfiguration): Promise<RemoteAccessConfiguration> {
    let source: string
    try {
      source = await readFile(this.filename, 'utf8')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return defaults
      throw error
    }
    let parsed: unknown
    try {
      parsed = JSON.parse(source)
    } catch (error) {
      throw new Error(`Electron remote-access settings are not valid JSON: ${String(error)}`)
    }
    const stored = record(parsed, 'Stored remote-access configuration')
    exactKeys(stored, ['version', 'mode', 'frp'], 'Stored remote-access configuration')
    if (stored.version !== CONFIG_VERSION) throw new Error('Electron remote-access settings version is unsupported')
    if (stored.mode !== 'lan' && stored.mode !== 'frp') throw new Error('Stored remote-access mode is invalid')
    const rawFrp = record(stored.frp, 'Stored FRP configuration')
    exactKeys(rawFrp, [
      'serverAddress',
      'serverPort',
      'remotePort',
      'publicOrigin',
      'executablePath',
      'tlsTrustedCaFile',
      'tlsServerName',
      'allowInsecureHttp',
      'encryptedAuthToken',
    ], 'Stored FRP configuration')
    const normalized = normalizeFrp(rawFrp, stored.mode === 'frp')
    const encrypted = rawFrp.encryptedAuthToken
    if (encrypted !== undefined && typeof encrypted !== 'string') {
      throw new Error('Stored FRP authentication token is invalid')
    }
    const authToken = encrypted === undefined
      ? undefined
      : text(this.codec.decrypt(encrypted), 'Stored FRP authentication token')
    return {
      mode: stored.mode,
      frp: { ...normalized, ...authToken === undefined ? {} : { authToken } },
    }
  }

  /** Atomically persist one complete file with owner-only permissions. */
  async save(configuration: RemoteAccessConfiguration): Promise<void> {
    const { authToken, ...frp } = configuration.frp
    const stored: StoredRemoteAccessConfiguration = {
      version: CONFIG_VERSION,
      mode: configuration.mode,
      frp: {
        ...frp,
        ...authToken === undefined ? {} : { encryptedAuthToken: this.codec.encrypt(authToken) },
      },
    }
    await writeFileAtomic(this.filename, `${JSON.stringify(stored, null, 2)}\n`, {
      mode: 0o600,
      dirMode: 0o700,
    })
  }
}

/** PocketBase release selection and verified Electron update orchestration. */

import { spawnSync } from 'node:child_process'
import { dirname } from 'node:path'

const DEFAULT_OTA_BASE_URL = 'https://ota.xiaosenho.top/'
const TRUSTED_ARTIFACT_ROOT_URL = new URL('https://application-1305333896.cos.ap-guangzhou.myqcloud.com/')
const RELEASE_COLLECTION = 'app_releases'
const RELEASE_RESPONSE_LIMIT_BYTES = 64 * 1024
const RELEASE_REQUEST_TIMEOUT_MS = 10_000

type OtaPlatform = 'macos' | 'windows'
type ReleaseFetch = (input: string, init?: RequestInit) => Promise<Response>

/** Starts a downloaded installer and reports updater errors that occur after invocation. */
export type InstallDownloadedUpdate = (onError: (error: Error) => void) => void

interface OtaRelease {
  id: string
  platform: OtaPlatform
  version: string
  versionCode: number
  changelog: string
  force: boolean
  fileUrl: URL
}

interface UpdateFileInfo {
  sha512: string
  url: string
}

interface UpdateInfo {
  files: UpdateFileInfo[]
  version: string
}

interface UpdateCheckResult {
  isUpdateAvailable: boolean
  updateInfo: UpdateInfo
}

interface UpdateDownloadProgress {
  percent: number
}

interface ElectronUpdater {
  allowDowngrade: boolean
  autoDownload: boolean
  autoInstallOnAppQuit: boolean
  disableDifferentialDownload: boolean
  checkForUpdates(): Promise<UpdateCheckResult | null>
  downloadUpdate(): Promise<string[]>
  on(event: 'download-progress', listener: (progress: UpdateDownloadProgress) => void): this
  once(event: 'error', listener: (error: Error) => void): this
  quitAndInstall(isSilent?: boolean, isForceRunAfter?: boolean): void
  removeListener(event: 'error', listener: (error: Error) => void): this
  removeListener(event: 'download-progress', listener: (progress: UpdateDownloadProgress) => void): this
  setFeedURL(options: { provider: 'generic'; url: string }): void
}

interface UpdateLogger {
  error(message: string): void
  info(message: string): void
  warn(message: string): void
}

/** Dependencies and application state used for one startup OTA check. */
export interface StartOtaUpdateOptions {
  /** Current packaged application version. */
  currentVersion: string
  /** Whether Electron is running from an installed package. */
  isPackaged: boolean
  /** Called after a forced update is fully downloaded. */
  onForceUpdateReady: (install: InstallDownloadedUpdate) => Promise<void>
  /** Operating system reported by the Electron main process. */
  platform: NodeJS.Platform
  /** PocketBase origin; defaults to the production OTA service. */
  baseUrl?: string
  /** HTTP implementation supplied by Electron main. */
  fetch?: ReleaseFetch
  /** Executable path whose location decides whether the app can install updates. */
  applicationExecPath?: string
  /** Called when a verified release begins downloading. */
  onDownloadStart?: (force: boolean) => void
  /** Called with download progress from electron-updater. */
  onDownloadProgress?: (progress: UpdateDownloadProgress) => void
  /** Diagnostic sink; update failures never stop application startup. */
  logger?: UpdateLogger
  /** Updater override for deterministic tests. */
  updater?: ElectronUpdater
}

/** User-visible outcome of one Electron-owned update check. */
export type OtaUpdateCheckResult =
  | { status: 'disabled' }
  | { status: 'unsupported' }
  | { status: 'unsigned' }
  | { status: 'readonly' }
  | { status: 'no-release' }
  | { status: 'current' }
  | { status: 'ready'; version: string; changelog: string }
  | { status: 'failed'; detail: string }

/** Current observable state of the Electron-owned updater. */
export type OtaUpdateState = { status: 'idle' | 'checking' } | OtaUpdateCheckResult

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function parseBaseUrl(value: string): URL {
  const url = new URL(value)
  if (url.protocol !== 'https:' || url.username !== '' || url.password !== '') {
    throw new Error('Electron OTA base URL must be an HTTPS URL without credentials')
  }
  url.hash = ''
  url.search = ''
  if (!url.pathname.endsWith('/')) url.pathname = `${url.pathname}/`
  return url
}

function runningOnReadOnlyVolume(platform: NodeJS.Platform, execPath: string): boolean {
  return platform === 'darwin' && execPath.startsWith('/Volumes/')
}

function isSignedMacApplication(execPath: string): boolean {
  const bundlePath = dirname(dirname(execPath))
  return spawnSync('codesign', ['--verify', '--deep', '--strict', bundlePath], { stdio: 'ignore' }).status === 0
}

function mapPlatform(platform: NodeJS.Platform): OtaPlatform | undefined {
  if (platform === 'darwin') return 'macos'
  return undefined
}

function artifactSuffix(platform: OtaPlatform): string {
  return platform === 'macos' ? '.dmg' : '.exe'
}

function parseRelease(value: unknown, expectedPlatform: OtaPlatform): OtaRelease {
  if (!isRecord(value)) throw new Error('Electron OTA release must be an object')
  const { changelog, file_url: fileUrlValue, id, is_force: force, platform, version, version_code: versionCode } = value
  if (typeof id !== 'string' || !/^[a-z0-9]{15}$/.test(id)) {
    throw new Error('Electron OTA release id must be a PocketBase record id')
  }
  if (platform !== expectedPlatform) throw new Error(`Electron OTA release platform must be ${expectedPlatform}`)
  if (typeof version !== 'string' || version.trim() !== version || version === '') {
    throw new Error('Electron OTA release version must be a non-empty trimmed string')
  }
  if (!Number.isSafeInteger(versionCode) || (versionCode as number) < 0) {
    throw new Error('Electron OTA release version_code must be a non-negative safe integer')
  }
  if (typeof changelog !== 'string') throw new Error('Electron OTA release changelog must be a string')
  if (typeof force !== 'boolean') throw new Error('Electron OTA release is_force must be a boolean')
  if (typeof fileUrlValue !== 'string' || fileUrlValue === '') {
    throw new Error('Electron OTA release file_url must be a non-empty HTTPS URL')
  }
  const fileUrl = new URL(fileUrlValue)
  if (fileUrl.protocol !== 'https:' || fileUrl.username !== '' || fileUrl.password !== '') {
    throw new Error('Electron OTA release file_url must be an HTTPS URL without credentials')
  }
  if (
    fileUrl.origin !== TRUSTED_ARTIFACT_ROOT_URL.origin
    || !fileUrl.pathname.startsWith(TRUSTED_ARTIFACT_ROOT_URL.pathname)
  ) {
    throw new Error(`Electron OTA release file_url must be under ${TRUSTED_ARTIFACT_ROOT_URL.href}`)
  }
  const suffix = artifactSuffix(expectedPlatform)
  if (!fileUrl.pathname.endsWith(suffix)) {
    throw new Error(`Electron OTA release file_url must identify a ${expectedPlatform} ${suffix} artifact`)
  }
  return { id, platform: expectedPlatform, version, versionCode: versionCode as number, changelog, force, fileUrl }
}

async function readBoundedText(response: Response): Promise<string> {
  const declaredLength = response.headers.get('content-length')
  if (declaredLength !== null && Number(declaredLength) > RELEASE_RESPONSE_LIMIT_BYTES) {
    throw new Error(`Electron OTA response exceeds ${String(RELEASE_RESPONSE_LIMIT_BYTES)} bytes`)
  }
  if (response.body === null) return ''
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let length = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    length += value.byteLength
    if (length > RELEASE_RESPONSE_LIMIT_BYTES) {
      await reader.cancel()
      throw new Error(`Electron OTA response exceeds ${String(RELEASE_RESPONSE_LIMIT_BYTES)} bytes`)
    }
    chunks.push(value)
  }
  const bytes = new Uint8Array(length)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
}

async function fetchLatestRelease(
  fetchImpl: ReleaseFetch,
  baseUrl: URL,
  platform: OtaPlatform,
): Promise<OtaRelease | undefined> {
  const endpoint = new URL(`api/collections/${RELEASE_COLLECTION}/records`, baseUrl)
  endpoint.search = new URLSearchParams({
    filter: `platform="${platform}"`,
    perPage: '1',
    skipTotal: '1',
    sort: '-version_code',
  }).toString()
  const response = await fetchImpl(endpoint.href, {
    headers: { accept: 'application/json' },
    signal: AbortSignal.timeout(RELEASE_REQUEST_TIMEOUT_MS),
  })
  if (!response.ok) throw new Error(`Electron OTA request failed with HTTP ${String(response.status)}`)
  const text = await readBoundedText(response)
  let body: unknown
  try {
    body = JSON.parse(text)
  } catch (error) {
    throw new Error('Electron OTA response is not valid JSON', { cause: error })
  }
  if (!isRecord(body) || !Array.isArray(body.items)) {
    throw new Error('Electron OTA response must contain an items array')
  }
  if (body.items.length === 0) return undefined
  if (body.items.length !== 1) throw new Error('Electron OTA response must contain at most one release')
  return parseRelease(body.items[0], platform)
}

function canonicalSha512(value: string): boolean {
  try {
    const bytes = Buffer.from(value, 'base64')
    return bytes.byteLength === 64 && bytes.toString('base64') === value
  } catch {
    return false
  }
}

function releaseDirectory(fileUrl: URL): URL {
  const withoutQuery = new URL(fileUrl)
  withoutQuery.hash = ''
  withoutQuery.search = ''
  return new URL('.', withoutQuery)
}

function validateUpdateMetadata(release: OtaRelease, info: UpdateInfo, baseUrl: URL): void {
  if (info.version !== release.version) {
    throw new Error(`Electron update metadata version ${info.version} does not match OTA release ${release.version}`)
  }
  if (!Array.isArray(info.files) || info.files.length === 0) {
    throw new Error('Electron update metadata must contain at least one file')
  }
  const releasePath = release.fileUrl.pathname
  let containsReleaseArtifact = false
  for (const file of info.files) {
    if (!isRecord(file) || typeof file.url !== 'string' || typeof file.sha512 !== 'string') {
      throw new Error('Electron update metadata files must contain url and sha512 strings')
    }
    if (!canonicalSha512(file.sha512)) throw new Error('Electron update metadata contains an invalid SHA-512 checksum')
    const resolved = new URL(file.url, baseUrl)
    const resolvedDirectory = releaseDirectory(resolved)
    if (resolved.protocol !== 'https:' || resolvedDirectory.href !== baseUrl.href) {
      throw new Error('Electron update metadata files must stay in the OTA release directory over HTTPS')
    }
    if (resolved.origin === release.fileUrl.origin && resolved.pathname === releasePath) {
      containsReleaseArtifact = true
    }
  }
  if (!containsReleaseArtifact) {
    throw new Error('Electron update metadata does not contain the PocketBase release artifact')
  }
}

async function resolveUpdater(override: ElectronUpdater | undefined): Promise<ElectronUpdater> {
  if (override !== undefined) return override
  const updaterModule = await import('electron-updater')
  return updaterModule.default.autoUpdater
}

/**
 * Check the PocketBase release selected for this platform and download a verified update in the background.
 * @param options - packaged application state and injected Electron dependencies.
 * @returns the final result after the check and any background download complete.
 */
export async function startOtaUpdate(options: StartOtaUpdateOptions): Promise<OtaUpdateCheckResult> {
  if (!options.isPackaged) return { status: 'disabled' }
  const logger = options.logger ?? console
  try {
    if (options.applicationExecPath !== undefined && runningOnReadOnlyVolume(options.platform, options.applicationExecPath)) {
      logger.warn('[OTA] Application runs from a read-only volume')
      return { status: 'readonly' }
    }
    if (
      options.platform === 'darwin'
      && options.applicationExecPath !== undefined
      && !isSignedMacApplication(options.applicationExecPath)
    ) {
      logger.warn('[OTA] macOS application is not signed; Squirrel.Mac cannot replace it')
      return { status: 'unsigned' }
    }
    const platform = mapPlatform(options.platform)
    if (platform === undefined) {
      logger.warn(`[OTA] Unsupported Electron platform: ${options.platform}`)
      return { status: 'unsupported' }
    }
    const baseUrl = parseBaseUrl(options.baseUrl ?? DEFAULT_OTA_BASE_URL)
    const release = await fetchLatestRelease(options.fetch ?? globalThis.fetch, baseUrl, platform)
    if (release === undefined) {
      logger.info(`[OTA] No ${platform} release is published`)
      return { status: 'no-release' }
    }
    if (release.version === options.currentVersion) {
      logger.info(`[OTA] Version ${release.version} is current`)
      return { status: 'current' }
    }

    const artifactBaseUrl = releaseDirectory(release.fileUrl)
    const updater = await resolveUpdater(options.updater)
    updater.allowDowngrade = false
    updater.autoDownload = false
    updater.autoInstallOnAppQuit = true
    updater.disableDifferentialDownload = false
    updater.setFeedURL({ provider: 'generic', url: artifactBaseUrl.href })

    const result = await updater.checkForUpdates()
    if (result === null || !result.isUpdateAvailable) {
      logger.info(`[OTA] Version ${release.version} is not newer than ${options.currentVersion}`)
      return { status: 'current' }
    }
    validateUpdateMetadata(release, result.updateInfo, artifactBaseUrl)
    logger.info(`[OTA] Downloading ${release.version}`)
    options.onDownloadStart?.(release.force)
    const progressListener = options.onDownloadProgress === undefined
      ? undefined
      : (progress: UpdateDownloadProgress) => { options.onDownloadProgress?.(progress) }
    if (progressListener !== undefined) updater.on('download-progress', progressListener)
    try {
      await updater.downloadUpdate()
    } finally {
      if (progressListener !== undefined) updater.removeListener('download-progress', progressListener)
    }
    logger.info(`[OTA] Version ${release.version} is ready to install`)
    if (release.force) {
      await options.onForceUpdateReady((onError) => {
        updater.once('error', onError)
        try {
          updater.quitAndInstall(false, true)
        } catch (error) {
          updater.removeListener('error', onError)
          throw error
        }
      })
    }
    return { status: 'ready', version: release.version, changelog: release.changelog }
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    logger.error(`[OTA] Update check failed: ${detail}`)
    return { status: 'failed', detail }
  }
}

/** Coalesces startup and menu-triggered checks and retains a downloaded update. */
export class OtaUpdateController {
  private pending: Promise<OtaUpdateCheckResult> | undefined
  private ready: Extract<OtaUpdateCheckResult, { status: 'ready' }> | undefined
  private installReadyUpdate: InstallDownloadedUpdate | undefined
  private state: OtaUpdateState = { status: 'idle' }

  /** @param options - stable application and updater dependencies. */
  constructor(private readonly options: StartOtaUpdateOptions) {}

  /**
   * Read updater state for native and managed-renderer presentation.
   * @returns a stable value until the next updater transition.
   */
  getState(): OtaUpdateState {
    return this.state
  }

  /**
   * Check once, sharing an active operation and avoiding a second download after readiness.
   * @returns the final outcome for native Electron presentation.
   */
  check(): Promise<OtaUpdateCheckResult> {
    if (this.ready !== undefined) return Promise.resolve(this.ready)
    if (this.pending !== undefined) return this.pending
    this.state = { status: 'checking' }
    const operation = this.run()
    this.pending = operation
    return operation
  }

  private async run(): Promise<OtaUpdateCheckResult> {
    try {
      const result = await startOtaUpdate(this.options)
      this.state = result
      if (result.status === 'ready') {
        this.ready = result
        const updater = await resolveUpdater(this.options.updater)
        this.installReadyUpdate = (onError) => {
          updater.once('error', onError)
          try {
            updater.quitAndInstall(false, true)
          } catch (error) {
            updater.removeListener('error', onError)
            throw error
          }
        }
      }
      return result
    } finally {
      this.pending = undefined
    }
  }

  /**
   * Install the downloaded update through the same orderly shutdown path used by forced releases.
   * @returns false when no verified update is ready; otherwise true after installer invocation.
   */
  async install(): Promise<boolean> {
    const install = this.installReadyUpdate
    if (this.ready === undefined || install === undefined) return false
    await this.options.onForceUpdateReady(install)
    return true
  }
}

/**
 * Install an update only after every Electron-owned background process has stopped.
 * @param stop - quiesces the application-owned process tree.
 * @param install - starts the downloaded update installer and relaunch.
 * @returns after the installer has been invoked.
 */
export async function installUpdateAfterShutdown(stop: () => Promise<void>, install: () => void): Promise<void> {
  await stop()
  install()
}

/** Owned frpc process with scrubbed environment, private configuration, and authenticated readiness. */

import { spawn, type ChildProcess, type SpawnOptions } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:net'
import { join } from 'node:path'
import { scrubbedParentEnv } from '@deepseek-ai/dsh-subprocess'
import type { FrpRemoteAccessConfiguration } from './remote-access-config.ts'
import { stopProcessTree } from './process-tree.ts'

const STARTUP_TIMEOUT_MS = 20_000
const STATUS_POLL_INTERVAL_MS = 100
const ERROR_DETAIL_LIMIT = 4_096

interface FrpcAdminConfiguration {
  port: number
  user: string
  password: string
}

interface FrpcRun {
  abort: AbortController
  child: ChildProcess
  configDirectory: string
  onUnexpectedExit: (error: Error) => void
  output: string
  ready: boolean
  stopping: boolean
  stopTask?: Promise<void>
}

interface FrpcClientOptions {
  /** Parent for owner-only per-run configuration directories. */
  temporaryRoot: string
  /** Process launcher overridden by lifecycle tests. */
  spawnProcess?: (command: string, args: readonly string[], options: SpawnOptions) => ChildProcess
  /** Loopback port allocator overridden by readiness tests. */
  allocateAdminPort?: () => Promise<number>
  /** HTTP client used only against the authenticated loopback admin API. */
  fetch?: typeof globalThis.fetch
  /** Process-tree platform overridden by tests. */
  platform?: NodeJS.Platform
  /** Complete process-tree cleanup overridden by lifecycle tests. */
  stopTree?: typeof stopProcessTree
}

/** JSON configuration accepted by current frpc releases. */
export interface FrpcJsonConfiguration {
  serverAddr: string
  serverPort: number
  loginFailExit: true
  auth?: { method: 'token'; token: string }
  transport: {
    tls: {
      enable: true
      trustedCaFile: string
      serverName: string
    }
  }
  webServer: { addr: '127.0.0.1'; port: number; user: string; password: string }
  log: { to: 'console'; level: 'info'; disablePrintColor: true }
  proxies: Array<{
    name: string
    type: 'tcp'
    localIP: '127.0.0.1'
    localPort: number
    remotePort: number
    transport: { useEncryption: true }
  }>
}

/** Build a secret-bearing frpc JSON document without placing secrets in argv. */
export function buildFrpcConfiguration(
  configuration: FrpRemoteAccessConfiguration,
  localPort: number,
  proxyName: string,
  admin: FrpcAdminConfiguration,
): FrpcJsonConfiguration {
  return {
    serverAddr: configuration.serverAddress,
    serverPort: configuration.serverPort,
    loginFailExit: true,
    ...configuration.authToken === undefined
      ? {}
      : { auth: { method: 'token' as const, token: configuration.authToken } },
    transport: {
      tls: {
        enable: true,
        trustedCaFile: configuration.tlsTrustedCaFile,
        serverName: configuration.tlsServerName || configuration.serverAddress,
      },
    },
    webServer: { addr: '127.0.0.1', ...admin },
    log: { to: 'console', level: 'info', disablePrintColor: true },
    proxies: [{
      name: proxyName,
      type: 'tcp',
      localIP: '127.0.0.1',
      localPort,
      remotePort: configuration.remotePort,
      transport: { useEncryption: true },
    }],
  }
}

async function allocateLoopbackPort(): Promise<number> {
  const server = createServer()
  server.unref()
  return new Promise<number>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      if (address === null || typeof address === 'string') {
        server.close()
        reject(new Error('Could not allocate the frpc status port'))
        return
      }
      server.close((error) => {
        if (error === undefined) resolve(address.port)
        else reject(error)
      })
    })
  })
}

function abortError(signal: AbortSignal): Error {
  return signal.reason instanceof Error ? signal.reason : new Error(String(signal.reason))
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) throw abortError(signal)
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function proxyRemotePort(value: unknown): number | undefined {
  if (typeof value !== 'string') return undefined
  const match = /:([1-9]\d{0,4})$/u.exec(value)
  if (match?.[1] === undefined) return undefined
  const valuePort = Number(match[1])
  return valuePort <= 65_535 ? valuePort : undefined
}

function inspectProxyStatus(value: unknown, proxyName: string): { remotePort?: number; failure?: string } {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return {}
  const tcp = (value as Record<string, unknown>).tcp
  if (!Array.isArray(tcp)) return {}
  const proxy = tcp.find((entry) => {
    return typeof entry === 'object' && entry !== null
      && (entry as Record<string, unknown>).name === proxyName
  }) as Record<string, unknown> | undefined
  if (proxy === undefined) return {}
  const status = typeof proxy.status === 'string' ? proxy.status : ''
  const detail = typeof proxy.err === 'string' ? proxy.err.trim() : ''
  if (status === 'running') {
    const remotePort = proxyRemotePort(proxy.remote_addr)
    return remotePort === undefined
      ? { failure: 'frpc reported a running proxy without a public port' }
      : { remotePort }
  }
  if (detail !== '' || status.toLowerCase().includes('error')) {
    return { failure: detail === '' ? `frpc proxy status is ${status}` : detail }
  }
  return {}
}

async function waitForProxy(
  fetchStatus: typeof globalThis.fetch,
  admin: FrpcAdminConfiguration,
  proxyName: string,
  signal: AbortSignal,
): Promise<number> {
  const deadline = Date.now() + STARTUP_TIMEOUT_MS
  const authorization = `Basic ${Buffer.from(`${admin.user}:${admin.password}`).toString('base64')}`
  while (true) {
    throwIfAborted(signal)
    try {
      const remaining = Math.max(1, deadline - Date.now())
      const response = await fetchStatus(`http://127.0.0.1:${String(admin.port)}/api/status`, {
        headers: { authorization },
        signal: AbortSignal.any([signal, AbortSignal.timeout(remaining)]),
      })
      if (response.ok) {
        const status = inspectProxyStatus(await response.json(), proxyName)
        if (status.failure !== undefined) throw new Error(`frpc could not publish the proxy: ${status.failure}`)
        if (status.remotePort !== undefined) {
          throwIfAborted(signal)
          return status.remotePort
        }
      } else if (response.status === 401 || response.status === 403) {
        throw new Error('frpc status API rejected its private credentials')
      }
    } catch (error) {
      throwIfAborted(signal)
      if (error instanceof Error && error.message.startsWith('frpc ')) throw error
    }
    if (Date.now() >= deadline) throw new Error('frpc proxy did not become ready within 20 seconds')
    await new Promise(resolve => setTimeout(resolve, STATUS_POLL_INTERVAL_MS))
  }
}

/** Owns one frpc process from private configuration through awaited process-tree cleanup. */
export class FrpcClient {
  private run: FrpcRun | undefined

  /** @param options - temp-root, process, status, and platform integrations. */
  constructor(private readonly options: FrpcClientOptions) {}

  /**
   * Start one TCP proxy and wait until frpc reports it running.
   * @param configuration - validated server, port, executable, and optional token.
   * @param localPort - loopback WebUI port forwarded by frpc.
   * @param onUnexpectedExit - called after an unexpected exit's cleanup completes or fails.
   * @returns the actual public port, including an frps-assigned port.
   */
  async start(
    configuration: FrpRemoteAccessConfiguration,
    localPort: number,
    onUnexpectedExit: (error: Error) => void,
  ): Promise<number> {
    if (this.run !== undefined) throw new Error('frpc is already running')
    const allocatePort = this.options.allocateAdminPort ?? allocateLoopbackPort
    const admin: FrpcAdminConfiguration = {
      port: await allocatePort(),
      user: randomBytes(12).toString('base64url'),
      password: randomBytes(18).toString('base64url'),
    }
    const proxyName = `dsh-electron-${randomBytes(6).toString('hex')}`
    const configDirectory = await mkdtemp(join(this.options.temporaryRoot, 'dsh-frpc-'))
    const configPath = join(configDirectory, 'frpc.json')
    const spawnProcess = this.options.spawnProcess ?? ((command, args, options) => spawn(command, args, options))
    let child: ChildProcess
    try {
      await chmod(configDirectory, 0o700)
      await writeFile(
        configPath,
        `${JSON.stringify(buildFrpcConfiguration(configuration, localPort, proxyName, admin), null, 2)}\n`,
        { mode: 0o600, flag: 'wx' },
      )
      child = spawnProcess(configuration.executablePath, ['-c', configPath], {
        env: scrubbedParentEnv(),
        stdio: ['ignore', 'pipe', 'pipe'],
        detached: (this.options.platform ?? process.platform) !== 'win32',
        windowsHide: true,
      })
    } catch (error) {
      try {
        await rm(configDirectory, { recursive: true, force: true })
      } catch (cleanupError) {
        throw new AggregateError([error, cleanupError], 'frpc launch and configuration cleanup both failed')
      }
      throw error
    }
    const run: FrpcRun = {
      abort: new AbortController(),
      child,
      configDirectory,
      onUnexpectedExit,
      output: '',
      ready: false,
      stopping: false,
    }
    this.run = run
    const capture = (chunk: Buffer | string): void => {
      const output = String(chunk)
      run.output = `${run.output}${output}`.slice(-ERROR_DETAIL_LIMIT)
      process.stderr.write(output)
    }
    child.stdout?.on('data', capture)
    child.stderr?.on('data', capture)
    child.once('error', (error) => {
      run.abort.abort(error)
    })
    child.once('exit', (code, signal) => {
      const failure = new Error(
        `frpc exited ${signal === null ? `with code ${String(code)}` : `from ${signal}`}`
        + (run.output.trim() === '' ? '' : `\n\n${run.output.trim()}`),
      )
      run.abort.abort(failure)
      if (run.ready && !run.stopping) void this.finishUnexpectedExit(run, failure)
    })

    try {
      const remotePort = await waitForProxy(
        this.options.fetch ?? globalThis.fetch,
        admin,
        proxyName,
        run.abort.signal,
      )
      if (run.abort.signal.aborted) throw abortError(run.abort.signal)
      run.ready = true
      return remotePort
    } catch (failure) {
      try {
        await this.stop()
      } catch (cleanupFailure) {
        throw new AggregateError(
          [failure, cleanupFailure],
          'frpc startup and cleanup both failed',
        )
      }
      throw failure
    }
  }

  /** Stop and join the current frpc tree, retaining failed cleanup for a retry. */
  stop(): Promise<void> {
    const run = this.run
    if (run === undefined) return Promise.resolve()
    run.stopping = true
    run.abort.abort(new Error('frpc is stopping'))
    return this.cleanupRun(run)
  }

  private cleanupRun(run: FrpcRun): Promise<void> {
    if (run.stopTask !== undefined) return run.stopTask
    const stopTree = this.options.stopTree ?? stopProcessTree
    const task = (async () => {
      await stopTree(run.child, 'frpc', this.options.platform)
      await rm(run.configDirectory, { recursive: true, force: true })
      if (this.run === run) this.run = undefined
    })()
    run.stopTask = task
    void task.catch(() => {
      if (run.stopTask === task) delete run.stopTask
    })
    return task
  }

  private async finishUnexpectedExit(run: FrpcRun, failure: Error): Promise<void> {
    let reported: Error = failure
    try {
      await this.cleanupRun(run)
    } catch (cleanupFailure) {
      reported = new AggregateError(
        [failure, cleanupFailure],
        'frpc exited and process-tree or private configuration cleanup failed',
      )
    }
    try {
      run.onUnexpectedExit(reported)
    } catch (reportError) {
      console.error('Failed to report an unexpected frpc exit.', errorMessage(reportError))
    }
  }
}

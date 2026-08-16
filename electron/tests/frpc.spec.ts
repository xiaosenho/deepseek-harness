import type { ChildProcess, SpawnOptions } from 'node:child_process'
import { EventEmitter } from 'node:events'
import { readFileSync, statSync } from 'node:fs'
import { mkdtemp, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { PassThrough } from 'node:stream'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  buildFrpcConfiguration,
  FrpcClient,
  type FrpcJsonConfiguration,
} from '../src/frpc.ts'
import type { FrpRemoteAccessConfiguration } from '../src/remote-access-config.ts'

const roots: string[] = []

function configuration(
  overrides: Partial<FrpRemoteAccessConfiguration> = {},
): FrpRemoteAccessConfiguration {
  return {
    serverAddress: '203.0.113.9',
    serverPort: 7_000,
    remotePort: 32_080,
    publicOrigin: '',
    executablePath: '/opt/frpc',
    tlsTrustedCaFile: '/etc/frp/ca.crt',
    tlsServerName: '',
    allowInsecureHttp: true,
    authToken: 'frps-auth-secret',
    ...overrides,
  }
}

class FakeFrpcChild extends EventEmitter {
  readonly pid = undefined
  readonly stdout = new PassThrough()
  readonly stderr = new PassThrough()
  exitCode: number | null = null
  signalCode: NodeJS.Signals | null = null
}

function asChild(child: FakeFrpcChild): ChildProcess {
  return child as unknown as ChildProcess
}

async function temporaryRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'dsh-frpc-test-'))
  roots.push(root)
  return root
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

describe('frpc configuration', () => {
  it('uses encrypted transport, a loopback target, and private status credentials', () => {
    expect(buildFrpcConfiguration(
      configuration(),
      43_127,
      'dsh-proxy',
      { port: 49_152, user: 'status-user', password: 'status-password' },
    )).toEqual({
      serverAddr: '203.0.113.9',
      serverPort: 7_000,
      loginFailExit: true,
      auth: { method: 'token', token: 'frps-auth-secret' },
      transport: {
        tls: {
          enable: true,
          trustedCaFile: '/etc/frp/ca.crt',
          serverName: '203.0.113.9',
        },
      },
      webServer: {
        addr: '127.0.0.1',
        port: 49_152,
        user: 'status-user',
        password: 'status-password',
      },
      log: { to: 'console', level: 'info', disablePrintColor: true },
      proxies: [{
        name: 'dsh-proxy',
        type: 'tcp',
        localIP: '127.0.0.1',
        localPort: 43_127,
        remotePort: 32_080,
        transport: { useEncryption: true },
      }],
    })
    const withoutAuth = configuration()
    delete withoutAuth.authToken
    expect(buildFrpcConfiguration(
      withoutAuth,
      43_127,
      'dsh-proxy',
      { port: 49_152, user: 'status-user', password: 'status-password' },
    )).not.toHaveProperty('auth')
    expect(buildFrpcConfiguration(
      configuration({ tlsServerName: 'frps.example.com' }),
      43_127,
      'dsh-proxy',
      { port: 49_152, user: 'status-user', password: 'status-password' },
    ).transport.tls.serverName).toBe('frps.example.com')
  })
})

describe('FrpcClient lifecycle', () => {
  it('keeps secrets out of argv, authenticates readiness, and removes the private run file', async () => {
    const root = await temporaryRoot()
    const child = new FakeFrpcChild()
    let command = ''
    let args: readonly string[] = []
    let spawnOptions: SpawnOptions | undefined
    let generated: FrpcJsonConfiguration | undefined
    let configPath = ''
    let authorization = ''
    process.env.DSH_FRPC_TEST_STALE = 'stale-harness-state'
    process.env.FRPC_TEST_TOKEN = 'ambient-secret'
    process.env.FRPC_TEST_VISIBLE = 'ordinary-value'
    const client = new FrpcClient({
      temporaryRoot: root,
      allocateAdminPort: async () => 49_152,
      platform: 'linux',
      spawnProcess: (nextCommand, nextArgs, options) => {
        command = nextCommand
        args = nextArgs
        spawnOptions = options
        configPath = String(nextArgs[1])
        generated = JSON.parse(readFileSync(configPath, 'utf8')) as FrpcJsonConfiguration
        return asChild(child)
      },
      fetch: async (_input, init) => {
        authorization = new Headers(init?.headers).get('authorization') ?? ''
        const proxyName = generated?.proxies[0]?.name
        return Response.json({
          tcp: [{
            name: proxyName,
            status: 'running',
            remote_addr: '203.0.113.9:32080',
          }],
        })
      },
    })

    try {
      await expect(client.start(configuration(), 43_127, () => {})).resolves.toBe(32_080)
    } finally {
      delete process.env.DSH_FRPC_TEST_STALE
      delete process.env.FRPC_TEST_TOKEN
      delete process.env.FRPC_TEST_VISIBLE
    }

    expect(command).toBe('/opt/frpc')
    expect(args).toEqual(['-c', configPath])
    expect(args.join(' ')).not.toContain('frps-auth-secret')
    expect(spawnOptions).toMatchObject({
      detached: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    })
    expect(spawnOptions?.env).toMatchObject({
      FRPC_TEST_VISIBLE: 'ordinary-value',
      PATH: process.env.PATH,
    })
    expect(spawnOptions?.env).not.toHaveProperty('DSH_FRPC_TEST_STALE')
    expect(spawnOptions?.env).not.toHaveProperty('FRPC_TEST_TOKEN')
    expect(generated).toMatchObject({
      auth: { token: 'frps-auth-secret' },
      proxies: [{ localIP: '127.0.0.1', localPort: 43_127 }],
    })
    const admin = generated?.webServer
    expect(authorization).toBe(
      `Basic ${Buffer.from(`${String(admin?.user)}:${String(admin?.password)}`).toString('base64')}`,
    )
    if (process.platform !== 'win32') {
      expect(statSync(configPath).mode & 0o777).toBe(0o600)
      expect(statSync(dirname(configPath)).mode & 0o777).toBe(0o700)
    }

    await client.stop()
    expect(await readdir(root)).toEqual([])
    await expect(client.stop()).resolves.toBeUndefined()
  })

  it('stops the fake process and removes its config when frps rejects the proxy', async () => {
    const root = await temporaryRoot()
    const child = new FakeFrpcChild()
    let proxyName = ''
    const client = new FrpcClient({
      temporaryRoot: root,
      allocateAdminPort: async () => 49_152,
      platform: 'linux',
      spawnProcess: (_command, args) => {
        const generated = JSON.parse(readFileSync(String(args[1]), 'utf8')) as FrpcJsonConfiguration
        proxyName = generated.proxies[0]?.name ?? ''
        return asChild(child)
      },
      fetch: async () => Response.json({
        tcp: [{ name: proxyName, status: 'error', err: 'remote port denied' }],
      }),
    })

    await expect(client.start(configuration(), 43_127, () => {}))
      .rejects.toThrow('remote port denied')
    expect(await readdir(root)).toEqual([])
  })

  it('rejects startup when the child exits before a running status can be adopted', async () => {
    const root = await temporaryRoot()
    const child = new FakeFrpcChild()
    let proxyName = ''
    const onUnexpectedExit = vi.fn()
    const client = new FrpcClient({
      temporaryRoot: root,
      allocateAdminPort: async () => 49_152,
      platform: 'linux',
      spawnProcess: (_command, args) => {
        const generated = JSON.parse(readFileSync(String(args[1]), 'utf8')) as FrpcJsonConfiguration
        proxyName = generated.proxies[0]?.name ?? ''
        return asChild(child)
      },
      fetch: async () => {
        child.exitCode = 1
        child.emit('exit', 1, null)
        return Response.json({
          tcp: [{ name: proxyName, status: 'running', remote_addr: '203.0.113.9:32080' }],
        })
      },
    })

    await expect(client.start(configuration(), 43_127, onUnexpectedExit))
      .rejects.toThrow('frpc exited with code 1')
    expect(onUnexpectedExit).not.toHaveBeenCalled()
    expect(await readdir(root)).toEqual([])
  })

  it('joins an unexpectedly exited leader tree before removing config and reporting', async () => {
    const root = await temporaryRoot()
    const child = new FakeFrpcChild()
    let proxyName = ''
    const cleanup = Promise.withResolvers<undefined>()
    const events: string[] = []
    const stopTree = vi.fn(async () => {
      events.push('tree-stop-start')
      await cleanup.promise
      events.push('tree-stop-finished')
    })
    const onUnexpectedExit = vi.fn<(error: Error) => void>(() => {
      events.push('reported')
    })
    const client = new FrpcClient({
      temporaryRoot: root,
      allocateAdminPort: async () => 49_152,
      platform: 'linux',
      stopTree,
      spawnProcess: (_command, args) => {
        const generated = JSON.parse(readFileSync(String(args[1]), 'utf8')) as FrpcJsonConfiguration
        proxyName = generated.proxies[0]?.name ?? ''
        return asChild(child)
      },
      fetch: async () => Response.json({
        tcp: [{ name: proxyName, status: 'running', remote_addr: '203.0.113.9:32080' }],
      }),
    })
    await client.start(configuration(), 43_127, onUnexpectedExit)

    child.exitCode = 1
    child.emit('exit', 1, null)

    expect(stopTree).toHaveBeenCalledWith(asChild(child), 'frpc', 'linux')
    expect(onUnexpectedExit).not.toHaveBeenCalled()
    expect(await readdir(root)).toHaveLength(1)
    const concurrentStop = client.stop()
    cleanup.resolve(undefined)
    await concurrentStop
    await vi.waitFor(() => { expect(onUnexpectedExit).toHaveBeenCalledOnce() })
    expect(onUnexpectedExit.mock.calls[0]?.[0].message).toContain('frpc exited with code 1')
    expect(stopTree).toHaveBeenCalledOnce()
    expect(events).toEqual(['tree-stop-start', 'tree-stop-finished', 'reported'])
    expect(await readdir(root)).toEqual([])
    await expect(client.stop()).resolves.toBeUndefined()
  })

  it('does not report an exit that races after an explicit stop request', async () => {
    const root = await temporaryRoot()
    const child = new FakeFrpcChild()
    let proxyName = ''
    const cleanup = Promise.withResolvers<undefined>()
    const stopTree = vi.fn(async () => { await cleanup.promise })
    const onUnexpectedExit = vi.fn<(error: Error) => void>()
    const client = new FrpcClient({
      temporaryRoot: root,
      allocateAdminPort: async () => 49_152,
      platform: 'linux',
      stopTree,
      spawnProcess: (_command, args) => {
        const generated = JSON.parse(readFileSync(String(args[1]), 'utf8')) as FrpcJsonConfiguration
        proxyName = generated.proxies[0]?.name ?? ''
        return asChild(child)
      },
      fetch: async () => Response.json({
        tcp: [{ name: proxyName, status: 'running', remote_addr: '203.0.113.9:32080' }],
      }),
    })
    await client.start(configuration(), 43_127, onUnexpectedExit)

    const firstStop = client.stop()
    const secondStop = client.stop()
    expect(secondStop).toBe(firstStop)
    child.exitCode = 0
    child.emit('exit', 0, null)
    cleanup.resolve(undefined)

    await firstStop
    expect(stopTree).toHaveBeenCalledOnce()
    expect(onUnexpectedExit).not.toHaveBeenCalled()
    expect(await readdir(root)).toEqual([])
  })

  it('reports cleanup failure, retains the run, and retries complete cleanup', async () => {
    const root = await temporaryRoot()
    const child = new FakeFrpcChild()
    let proxyName = ''
    let cleanupAttempts = 0
    const stopTree = vi.fn(async () => {
      cleanupAttempts += 1
      if (cleanupAttempts === 1) throw new Error('tree cleanup failed')
    })
    const onUnexpectedExit = vi.fn<(error: Error) => void>()
    const client = new FrpcClient({
      temporaryRoot: root,
      allocateAdminPort: async () => 49_152,
      platform: 'linux',
      stopTree,
      spawnProcess: (_command, args) => {
        const generated = JSON.parse(readFileSync(String(args[1]), 'utf8')) as FrpcJsonConfiguration
        proxyName = generated.proxies[0]?.name ?? ''
        return asChild(child)
      },
      fetch: async () => Response.json({
        tcp: [{ name: proxyName, status: 'running', remote_addr: '203.0.113.9:32080' }],
      }),
    })
    await client.start(configuration(), 43_127, onUnexpectedExit)

    child.exitCode = 1
    child.emit('exit', 1, null)

    await vi.waitFor(() => { expect(onUnexpectedExit).toHaveBeenCalledOnce() })
    const reported = onUnexpectedExit.mock.calls[0]?.[0]
    expect(reported).toBeInstanceOf(AggregateError)
    expect(reported?.message).toBe('frpc exited and process-tree or private configuration cleanup failed')
    if (!(reported instanceof AggregateError)) throw new Error('Expected an AggregateError')
    expect(reported.errors).toEqual([
      expect.objectContaining({ message: 'frpc exited with code 1' }),
      expect.objectContaining({ message: 'tree cleanup failed' }),
    ])
    expect(await readdir(root)).toHaveLength(1)
    await expect(client.start(configuration(), 43_127, () => {})).rejects.toThrow('frpc is already running')

    await expect(client.stop()).resolves.toBeUndefined()
    expect(stopTree).toHaveBeenCalledTimes(2)
    expect(await readdir(root)).toEqual([])
  })
})

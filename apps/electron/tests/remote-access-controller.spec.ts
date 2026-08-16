import { describe, expect, it, vi } from 'vitest'
import type { ElectronDirectoryPickerHandler } from '../src/directory-picker-bridge.ts'
import type { WebBackendLocation, WebBackendMode } from '../src/backend.ts'
import type {
  FrpRemoteAccessConfiguration,
  RemoteAccessConfiguration,
} from '../src/remote-access-config.ts'
import { RemoteAccessController } from '../src/remote-access-controller.ts'

interface Deferred {
  promise: Promise<void>
  resolve: () => void
}

interface StartPlan {
  error?: Error
  location?: WebBackendLocation
  wait?: Promise<void>
}

interface StopPlan {
  error?: Error
  wait?: Promise<void>
}

interface FrpcStartPlan {
  error?: Error
  remotePort?: number
  wait?: Promise<void>
}

const LAN_CONFIGURATION: RemoteAccessConfiguration = {
  mode: 'lan',
  frp: {
    serverAddress: '',
    serverPort: 7_000,
    remotePort: 0,
    publicOrigin: '',
    executablePath: 'frpc',
    tlsTrustedCaFile: '',
    tlsServerName: '',
    allowInsecureHttp: false,
  },
}

const FRP_CONFIGURATION: RemoteAccessConfiguration = {
  mode: 'frp',
  frp: {
    serverAddress: '203.0.113.9',
    serverPort: 7_000,
    remotePort: 32_080,
    publicOrigin: '',
    executablePath: '/opt/frpc',
    tlsTrustedCaFile: '/etc/frp/ca.crt',
    tlsServerName: '',
    authToken: 'frps-secret',
    allowInsecureHttp: true,
  },
}

function deferred(): Deferred {
  let resolve!: () => void
  const promise = new Promise<void>((done) => { resolve = done })
  return { promise, resolve }
}

function location(
  port: number,
  remoteAccessUrl?: string,
  remoteAccessToken?: string,
  rendererAccessToken?: string,
): WebBackendLocation {
  return {
    loopbackUrl: new URL(`http://127.0.0.1:${String(port)}/`),
    ...remoteAccessUrl === undefined ? {} : { remoteAccessUrl: new URL(remoteAccessUrl) },
    ...remoteAccessToken === undefined ? {} : { remoteAccessToken },
    ...rendererAccessToken === undefined ? {} : { rendererAccessToken },
  }
}

class ScriptedBackend {
  readonly events: string[] = []
  readonly startPlans: StartPlan[] = []
  readonly stopPlans: StopPlan[] = []
  readonly trustedAuthorities: Array<string | undefined> = []
  readonly start = vi.fn(async (
    mode: WebBackendMode,
    _cwd: string,
    _onUnexpectedExit: (code: number | null, signal: NodeJS.Signals | null) => void,
    _pickDirectory: ElectronDirectoryPickerHandler,
    trustedAuthority?: string,
  ): Promise<WebBackendLocation> => {
    this.events.push(`start:${mode}`)
    this.trustedAuthorities.push(trustedAuthority)
    const plan = this.startPlans.shift()
    if (plan === undefined) throw new Error(`missing ${mode} start plan`)
    await plan.wait
    if (plan.error !== undefined) throw plan.error
    if (plan.location === undefined) throw new Error(`missing ${mode} location`)
    return plan.location
  })

  readonly stop = vi.fn(async (): Promise<void> => {
    this.events.push('stop')
    const plan = this.stopPlans.shift()
    await plan?.wait
    if (plan?.error !== undefined) throw plan.error
  })
}

class ScriptedFrpc {
  readonly startPlans: FrpcStartPlan[] = []
  readonly stopPlans: StopPlan[] = []
  readonly startConfigurations: FrpRemoteAccessConfiguration[] = []
  private active = false
  private onUnexpectedExit: ((error: Error) => void) | undefined

  constructor(private readonly events: string[]) {}

  readonly start = vi.fn(async (
    configuration: FrpRemoteAccessConfiguration,
    localPort: number,
    onUnexpectedExit: (error: Error) => void,
  ): Promise<number> => {
    this.events.push(`frpc:start:${String(localPort)}`)
    this.startConfigurations.push(configuration)
    const plan = this.startPlans.shift()
    if (plan === undefined) throw new Error('missing frpc start plan')
    await plan.wait
    if (plan.error !== undefined) throw plan.error
    if (plan.remotePort === undefined) throw new Error('missing frpc remote port')
    this.active = true
    this.onUnexpectedExit = onUnexpectedExit
    return plan.remotePort
  })

  readonly stop = vi.fn(async (): Promise<void> => {
    if (!this.active) return
    this.events.push('frpc:stop')
    const plan = this.stopPlans.shift()
    await plan?.wait
    if (plan?.error !== undefined) throw plan.error
    this.active = false
    this.onUnexpectedExit = undefined
  })

  crash(error: Error): void {
    if (!this.active) throw new Error('frpc is not active')
    const report = this.onUnexpectedExit
    this.active = false
    this.onUnexpectedExit = undefined
    report?.(error)
  }
}

function createController(
  backend: ScriptedBackend,
  configuration: RemoteAccessConfiguration = LAN_CONFIGURATION,
  platform: NodeJS.Platform = 'darwin',
) {
  const errors: Error[] = []
  const fatalErrors: Error[] = []
  const recoveryUrls: URL[] = []
  const unexpectedExits: [number | null, NodeJS.Signals | null][] = []
  const frpc = new ScriptedFrpc(backend.events)
  const controller = new RemoteAccessController({
    backend,
    frpc,
    configuration,
    cwd: '/work',
    onTransitionError: (error, fatal, navigationUrl) => {
      errors.push(error)
      if (fatal) fatalErrors.push(error)
      if (navigationUrl !== undefined) recoveryUrls.push(navigationUrl)
    },
    onUnexpectedExit: (code, signal) => void unexpectedExits.push([code, signal]),
    pickDirectory: async () => null,
    platform,
  })
  return { controller, errors, fatalErrors, frpc, recoveryUrls, unexpectedExits }
}

describe('RemoteAccessController', () => {
  it('rejects Windows FRP before stopping the active loopback backend', async () => {
    const backend = new ScriptedBackend()
    backend.startPlans.push({ location: location(43127) })
    const { controller, errors, fatalErrors, frpc } = createController(
      backend,
      FRP_CONFIGURATION,
      'win32',
    )
    await controller.start()

    await expect(controller.setEnabled(true)).resolves.toEqual({ succeeded: false })

    expect(backend.events).toEqual(['start:loopback'])
    expect(frpc.start).not.toHaveBeenCalled()
    expect(errors).toHaveLength(1)
    expect(errors[0]?.message).toContain('not supported on Windows')
    expect(fatalErrors).toEqual([])
    expect(controller.getState()).toEqual({
      enabled: false,
      preferredMode: 'frp',
      transitioning: false,
    })
  })

  it('starts in loopback mode with remote access disabled', async () => {
    const backend = new ScriptedBackend()
    backend.startPlans.push({ location: location(43127) })
    const { controller } = createController(backend)

    await expect(controller.start()).resolves.toEqual(location(43127))
    expect(backend.events).toEqual(['start:loopback'])
    expect(controller.getState()).toEqual({
      enabled: false,
      preferredMode: 'lan',
      transitioning: false,
    })
  })

  it('treats requests for the active mode as successful no-ops', async () => {
    const backend = new ScriptedBackend()
    backend.startPlans.push(
      { location: location(43127) },
      { location: location(43128, 'http://192.168.1.5:43128/#dsh-access=token') },
    )
    const { controller } = createController(backend)
    await controller.start()

    await expect(controller.setEnabled(false)).resolves.toEqual({ succeeded: true })
    expect(backend.events).toEqual(['start:loopback'])
    await controller.setEnabled(true)
    await expect(controller.setEnabled(true)).resolves.toEqual({ succeeded: true })
    expect(backend.events).toEqual(['start:loopback', 'stop', 'start:lan'])
  })

  it('serializes enablement and rejects a concurrent mode change', async () => {
    const backend = new ScriptedBackend()
    const lanReady = deferred()
    backend.startPlans.push(
      { location: location(43127) },
      {
        location: location(43128, 'http://192.168.1.5:43128/#dsh-access=fresh-token'),
        wait: lanReady.promise,
      },
    )
    const { controller } = createController(backend)
    await controller.start()

    const enabling = controller.setEnabled(true)
    await vi.waitFor(() => { expect(backend.events).toEqual(['start:loopback', 'stop', 'start:lan']) })
    expect(controller.getState()).toEqual({
      enabled: false,
      preferredMode: 'lan',
      transitioning: true,
    })
    await expect(controller.setEnabled(false)).resolves.toEqual({ succeeded: false })

    lanReady.resolve()
    await expect(enabling).resolves.toEqual({
      succeeded: true,
      navigationUrl: new URL('http://127.0.0.1:43128/'),
    })
    expect(controller.getState()).toEqual({
      enabled: true,
      mode: 'lan',
      preferredMode: 'lan',
      transitioning: false,
      url: 'http://192.168.1.5:43128/#dsh-access=fresh-token',
    })
  })

  it('stops the LAN backend before restoring loopback mode', async () => {
    const backend = new ScriptedBackend()
    backend.startPlans.push(
      { location: location(43127) },
      { location: location(43128, 'http://192.168.1.5:43128/#dsh-access=old-token') },
      { location: location(43129) },
    )
    const { controller } = createController(backend)
    await controller.start()
    await controller.setEnabled(true)

    await expect(controller.setEnabled(false)).resolves.toEqual({
      succeeded: true,
      navigationUrl: new URL('http://127.0.0.1:43129/'),
    })
    expect(backend.events).toEqual([
      'start:loopback', 'stop', 'start:lan', 'stop', 'start:loopback',
    ])
    expect(controller.getState()).toEqual({
      enabled: false,
      preferredMode: 'lan',
      transitioning: false,
    })
  })

  it('rolls back to a new loopback origin when LAN readiness has no remote URL', async () => {
    const backend = new ScriptedBackend()
    backend.startPlans.push(
      { location: location(43127) },
      { location: location(43128) },
      { location: location(43129) },
    )
    const { controller, errors, fatalErrors } = createController(backend)
    await controller.start()

    await expect(controller.setEnabled(true)).resolves.toEqual({
      succeeded: false,
      navigationUrl: new URL('http://127.0.0.1:43129/'),
    })
    expect(backend.events).toEqual([
      'start:loopback', 'stop', 'start:lan', 'stop', 'start:loopback',
    ])
    expect(controller.getState()).toEqual({
      enabled: false,
      preferredMode: 'lan',
      transitioning: false,
    })
    expect(errors).toHaveLength(1)
    expect(errors[0]?.message).toContain('no reachable external IPv4 address')
    expect(fatalErrors).toEqual([])
  })

  it('rolls back to loopback when the LAN backend fails to start', async () => {
    const backend = new ScriptedBackend()
    backend.startPlans.push(
      { location: location(43127) },
      { error: new Error('LAN bind failed') },
      { location: location(43129) },
    )
    const { controller, errors, fatalErrors } = createController(backend)
    await controller.start()

    await expect(controller.setEnabled(true)).resolves.toEqual({
      succeeded: false,
      navigationUrl: new URL('http://127.0.0.1:43129/'),
    })
    expect(controller.getState()).toEqual({
      enabled: false,
      preferredMode: 'lan',
      transitioning: false,
    })
    expect(errors[0]?.message).toContain('LAN bind failed')
    expect(fatalErrors).toEqual([])
    expect(backend.events).toEqual([
      'start:loopback', 'stop', 'start:lan', 'stop', 'start:loopback',
    ])
  })

  it('replaces the LAN URL when disabling fails and rolls back to LAN', async () => {
    const backend = new ScriptedBackend()
    backend.startPlans.push(
      { location: location(43127) },
      { location: location(43128, 'http://192.168.1.5:43128/#dsh-access=old-token') },
      { error: new Error('loopback bind failed') },
      { location: location(43130, 'http://192.168.1.5:43130/#dsh-access=new-token') },
    )
    const { controller, errors, fatalErrors } = createController(backend)
    await controller.start()
    await controller.setEnabled(true)

    await expect(controller.setEnabled(false)).resolves.toEqual({
      succeeded: false,
      navigationUrl: new URL('http://127.0.0.1:43130/'),
    })
    expect(controller.getState()).toEqual({
      enabled: true,
      mode: 'lan',
      preferredMode: 'lan',
      transitioning: false,
      url: 'http://192.168.1.5:43130/#dsh-access=new-token',
    })
    expect(errors[0]?.message).toContain('loopback bind failed')
    expect(fatalErrors).toEqual([])
    expect(backend.events).toEqual([
      'start:loopback', 'stop', 'start:lan',
      'stop', 'start:loopback', 'stop', 'start:lan',
    ])
  })

  it('fails closed and reports both failures when rollback cannot restart', async () => {
    const backend = new ScriptedBackend()
    backend.startPlans.push(
      { location: location(43127) },
      { error: new Error('LAN bind failed') },
      { error: new Error('loopback bind failed') },
    )
    const { controller, errors, fatalErrors } = createController(backend)
    await controller.start()

    await expect(controller.setEnabled(true)).resolves.toEqual({ succeeded: false })
    expect(controller.getState()).toEqual({
      enabled: false,
      preferredMode: 'lan',
      transitioning: false,
    })
    expect(errors).toHaveLength(1)
    expect(errors[0]?.message).toContain('LAN bind failed')
    expect(errors[0]?.message).toContain('loopback bind failed')
    expect(errors[0]?.message).toContain('must exit')
    expect(fatalErrors).toEqual(errors)
    expect(backend.events).toEqual([
      'start:loopback', 'stop', 'start:lan', 'stop', 'start:loopback', 'stop',
    ])
  })

  it('keeps the previous mode when stopping it fails', async () => {
    const backend = new ScriptedBackend()
    backend.startPlans.push({ location: location(43127) })
    backend.stopPlans.push({ error: new Error('process tree remained alive') })
    const { controller, errors, fatalErrors } = createController(backend)
    await controller.start()

    await expect(controller.setEnabled(true)).resolves.toEqual({ succeeded: false })
    expect(controller.getState()).toEqual({
      enabled: false,
      preferredMode: 'lan',
      transitioning: false,
    })
    expect(backend.events).toEqual(['start:loopback', 'stop'])
    expect(errors[0]?.message).toContain('process tree remained alive')
    expect(errors[0]?.message).toContain('must exit')
    expect(errors[0]?.message).not.toContain('previous mode was restored')
    expect(fatalErrors).toEqual(errors)
  })

  it('starts FRP after the protected loopback WebUI and uses the reported public port', async () => {
    const backend = new ScriptedBackend()
    backend.startPlans.push(
      { location: location(43127) },
      { location: location(43128, undefined, 'host-access-token', 'renderer-access-token') },
    )
    const { controller, frpc } = createController(backend, FRP_CONFIGURATION)
    frpc.startPlans.push({ remotePort: 32_080 })
    await controller.start()

    await expect(controller.setEnabled(true)).resolves.toEqual({
      succeeded: true,
      navigationUrl: new URL('http://127.0.0.1:43128/'),
    })

    expect(backend.events).toEqual([
      'start:loopback', 'stop', 'start:frp', 'frpc:start:43128',
    ])
    expect(backend.trustedAuthorities).toEqual([undefined, '203.0.113.9:32080'])
    expect(frpc.startConfigurations).toEqual([FRP_CONFIGURATION.frp])
    expect(controller.getState()).toEqual({
      enabled: true,
      mode: 'frp',
      preferredMode: 'frp',
      transitioning: false,
      url: 'http://203.0.113.9:32080/#dsh-access=host-access-token',
    })
    expect(controller.getRendererAccessToken()).toBe('renderer-access-token')
  })

  it('refuses an FRP backend without distinct remote and local credentials', async () => {
    for (const protectedLocation of [
      location(43128, undefined, 'host-access-token'),
      location(43128, undefined, 'shared-access-token', 'shared-access-token'),
    ]) {
      const backend = new ScriptedBackend()
      backend.startPlans.push(
        { location: location(43127) },
        { location: protectedLocation },
        { location: location(43129) },
      )
      const { controller, errors, frpc } = createController(backend, FRP_CONFIGURATION)
      await controller.start()

      await expect(controller.setEnabled(true)).resolves.toEqual({
        succeeded: false,
        navigationUrl: new URL('http://127.0.0.1:43129/'),
      })
      expect(errors[0]?.message).toContain('distinct remote and local access tokens')
      expect(frpc.start).not.toHaveBeenCalled()
      expect(controller.getRendererAccessToken()).toBeUndefined()
    }
  })

  it('withdraws the FRP proxy before stopping its protected WebUI', async () => {
    const backend = new ScriptedBackend()
    backend.startPlans.push(
      { location: location(43127) },
      { location: location(43128, undefined, 'host-access-token', 'renderer-access-token') },
      { location: location(43129) },
    )
    const { controller, frpc } = createController(backend, FRP_CONFIGURATION)
    frpc.startPlans.push({ remotePort: 32_080 })
    await controller.start()
    await controller.setEnabled(true)

    await expect(controller.setEnabled(false)).resolves.toEqual({
      succeeded: true,
      navigationUrl: new URL('http://127.0.0.1:43129/'),
    })
    expect(backend.events).toEqual([
      'start:loopback', 'stop', 'start:frp', 'frpc:start:43128',
      'frpc:stop', 'stop', 'start:loopback',
    ])
    expect(controller.getState()).toEqual({
      enabled: false,
      preferredMode: 'frp',
      transitioning: false,
    })
    expect(controller.getRendererAccessToken()).toBeUndefined()
  })

  it('rolls back to loopback when frpc cannot publish the proxy', async () => {
    const backend = new ScriptedBackend()
    backend.startPlans.push(
      { location: location(43127) },
      { location: location(43128, undefined, 'host-access-token', 'renderer-access-token') },
      { location: location(43129) },
    )
    const { controller, errors, fatalErrors, frpc } = createController(backend, FRP_CONFIGURATION)
    frpc.startPlans.push({ error: new Error('frps rejected remote port') })
    await controller.start()

    await expect(controller.setEnabled(true)).resolves.toEqual({
      succeeded: false,
      navigationUrl: new URL('http://127.0.0.1:43129/'),
    })
    expect(backend.events).toEqual([
      'start:loopback', 'stop', 'start:frp', 'frpc:start:43128',
      'stop', 'start:loopback',
    ])
    expect(errors[0]?.message).toContain('frps rejected remote port')
    expect(fatalErrors).toEqual([])
    expect(controller.getState()).toEqual({
      enabled: false,
      preferredMode: 'frp',
      transitioning: false,
    })
  })

  it('returns to loopback after an active frpc process exits unexpectedly', async () => {
    const backend = new ScriptedBackend()
    backend.startPlans.push(
      { location: location(43127) },
      { location: location(43128, undefined, 'host-access-token', 'renderer-access-token') },
      { location: location(43129) },
    )
    const { controller, errors, fatalErrors, frpc, recoveryUrls } = createController(
      backend,
      FRP_CONFIGURATION,
    )
    frpc.startPlans.push({ remotePort: 32_080 })
    await controller.start()
    await controller.setEnabled(true)

    frpc.crash(new Error('control connection closed'))

    await vi.waitFor(() => {
      expect(controller.getState()).toEqual({
        enabled: false,
        preferredMode: 'frp',
        transitioning: false,
      })
    })
    expect(backend.events).toEqual([
      'start:loopback', 'stop', 'start:frp', 'frpc:start:43128',
      'stop', 'start:loopback',
    ])
    expect(errors[0]?.message).toContain('control connection closed')
    expect(fatalErrors).toEqual([])
    expect(recoveryUrls).toEqual([new URL('http://127.0.0.1:43129/')])
  })

  it('serializes preference persistence with exposure changes', async () => {
    const backend = new ScriptedBackend()
    backend.startPlans.push({ location: location(43127) })
    const { controller } = createController(backend)
    const saving = deferred()
    await controller.start()

    const update = controller.setConfiguration(FRP_CONFIGURATION, () => saving.promise)
    await vi.waitFor(() => {
      expect(controller.getState()).toMatchObject({ preferredMode: 'lan', transitioning: true })
    })
    await expect(controller.setEnabled(true)).resolves.toEqual({ succeeded: false })
    saving.resolve()
    await expect(update).resolves.toBe(true)
    expect(controller.getConfiguration()).toBe(FRP_CONFIGURATION)
    expect(controller.getState()).toEqual({
      enabled: false,
      preferredMode: 'frp',
      transitioning: false,
    })
  })

  it('still stops the backend when a concurrent preference save fails during shutdown', async () => {
    const backend = new ScriptedBackend()
    backend.startPlans.push({ location: location(43127) })
    const { controller } = createController(backend)
    const saving = deferred()
    await controller.start()

    const update = controller.setConfiguration(FRP_CONFIGURATION, async () => {
      await saving.promise
      throw new Error('settings disk unavailable')
    })
    await vi.waitFor(() => { expect(controller.getState().transitioning).toBe(true) })
    const shutdown = controller.shutdown()
    saving.resolve()

    await expect(update).rejects.toThrow('settings disk unavailable')
    await expect(shutdown).resolves.toBeUndefined()
    expect(backend.events).toEqual(['start:loopback', 'stop'])
  })

  it('allows shutdown to retry after process cleanup fails', async () => {
    const backend = new ScriptedBackend()
    backend.startPlans.push({ location: location(43127) })
    backend.stopPlans.push(
      { error: new Error('tree still running') },
      {},
    )
    const { controller } = createController(backend)
    await controller.start()

    await expect(controller.shutdown()).rejects.toThrow('tree still running')
    await expect(controller.shutdown()).resolves.toBeUndefined()
    expect(backend.events).toEqual(['start:loopback', 'stop', 'stop'])
    expect(controller.getState()).toEqual({
      enabled: false,
      preferredMode: 'lan',
      transitioning: false,
    })
  })

  it('waits for an active restart before shutting down the resulting backend', async () => {
    const backend = new ScriptedBackend()
    const lanReady = deferred()
    backend.startPlans.push(
      { location: location(43127) },
      {
        location: location(43128, 'http://192.168.1.5:43128/#dsh-access=token'),
        wait: lanReady.promise,
      },
    )
    const { controller } = createController(backend)
    await controller.start()
    const enabling = controller.setEnabled(true)
    await vi.waitFor(() => { expect(backend.events).toEqual(['start:loopback', 'stop', 'start:lan']) })

    const shutdown = controller.shutdown()
    await expect(controller.setEnabled(false)).resolves.toEqual({ succeeded: false })
    expect(backend.stop).toHaveBeenCalledOnce()
    lanReady.resolve()

    await expect(enabling).resolves.toMatchObject({ succeeded: true })
    await shutdown
    expect(backend.events).toEqual(['start:loopback', 'stop', 'start:lan', 'stop'])
    expect(controller.getState()).toEqual({
      enabled: false,
      preferredMode: 'lan',
      transitioning: false,
    })
  })
})

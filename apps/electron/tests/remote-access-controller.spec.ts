import { describe, expect, it, vi } from 'vitest'
import type { ElectronDirectoryPickerHandler } from '../src/directory-picker-bridge.ts'
import type { WebBackendLocation, WebBackendMode } from '../src/backend.ts'
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

function deferred(): Deferred {
  let resolve!: () => void
  const promise = new Promise<void>((done) => { resolve = done })
  return { promise, resolve }
}

function location(port: number, remoteAccessUrl?: string): WebBackendLocation {
  return {
    loopbackUrl: new URL(`http://127.0.0.1:${String(port)}/`),
    ...remoteAccessUrl === undefined ? {} : { remoteAccessUrl: new URL(remoteAccessUrl) },
  }
}

class ScriptedBackend {
  readonly events: string[] = []
  readonly startPlans: StartPlan[] = []
  readonly stopPlans: StopPlan[] = []
  readonly start = vi.fn(async (
    mode: WebBackendMode,
    _cwd: string,
    _onUnexpectedExit: (code: number | null, signal: NodeJS.Signals | null) => void,
    _pickDirectory: ElectronDirectoryPickerHandler,
  ): Promise<WebBackendLocation> => {
    this.events.push(`start:${mode}`)
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

function createController(backend: ScriptedBackend) {
  const errors: Error[] = []
  const fatalErrors: Error[] = []
  const unexpectedExits: [number | null, NodeJS.Signals | null][] = []
  const controller = new RemoteAccessController({
    backend,
    cwd: '/work',
    onTransitionError: (error, fatal) => {
      errors.push(error)
      if (fatal) fatalErrors.push(error)
    },
    onUnexpectedExit: (code, signal) => void unexpectedExits.push([code, signal]),
    pickDirectory: async () => null,
  })
  return { controller, errors, fatalErrors, unexpectedExits }
}

describe('RemoteAccessController', () => {
  it('starts in loopback mode with remote access disabled', async () => {
    const backend = new ScriptedBackend()
    backend.startPlans.push({ location: location(43127) })
    const { controller } = createController(backend)

    await expect(controller.start()).resolves.toEqual(location(43127))
    expect(backend.events).toEqual(['start:loopback'])
    expect(controller.getState()).toEqual({ enabled: false, transitioning: false })
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
    expect(controller.getState()).toEqual({ enabled: false, transitioning: true })
    await expect(controller.setEnabled(false)).resolves.toEqual({ succeeded: false })

    lanReady.resolve()
    await expect(enabling).resolves.toEqual({
      succeeded: true,
      navigationUrl: new URL('http://127.0.0.1:43128/'),
    })
    expect(controller.getState()).toEqual({
      enabled: true,
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
    expect(controller.getState()).toEqual({ enabled: false, transitioning: false })
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
    expect(controller.getState()).toEqual({ enabled: false, transitioning: false })
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
    expect(controller.getState()).toEqual({ enabled: false, transitioning: false })
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
    expect(controller.getState()).toEqual({ enabled: false, transitioning: false })
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
    expect(controller.getState()).toEqual({ enabled: false, transitioning: false })
    expect(backend.events).toEqual(['start:loopback', 'stop'])
    expect(errors[0]?.message).toContain('process tree remained alive')
    expect(errors[0]?.message).toContain('must exit')
    expect(errors[0]?.message).not.toContain('previous mode was restored')
    expect(fatalErrors).toEqual(errors)
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
    expect(controller.getState()).toEqual({ enabled: false, transitioning: false })
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
    expect(controller.getState()).toEqual({ enabled: false, transitioning: false })
  })
})

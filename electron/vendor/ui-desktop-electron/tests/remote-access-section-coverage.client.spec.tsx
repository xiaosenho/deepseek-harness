// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ElectronDesktopState, ElectronFrpConfiguration } from '../src/bridge-contract.ts'
import type { DesktopControlSnapshot } from '../src/client/desktop-controller.ts'
import { en } from '../src/client/locales.ts'
import {
  RemoteAccessSection,
  type RemoteAccessSectionProps,
} from '../src/client/RemoteAccessSection.tsx'

afterEach(cleanup)

const unusedHook = (() => { throw new Error('unused standard-kit hook') }) as never
const t: RemoteAccessSectionProps['t'] = key => (en as Record<string, string>)[key] ?? key

function frp(overrides: Partial<ElectronFrpConfiguration> = {}): ElectronFrpConfiguration {
  return {
    serverAddress: 'frps.example.com',
    serverPort: 7_000,
    remotePort: 7_400,
    publicOrigin: 'https://harness.example.com',
    executablePath: 'frpc',
    tlsTrustedCaFile: '/etc/frp/ca.crt',
    tlsServerName: '',
    authTokenConfigured: false,
    allowInsecureHttp: false,
    ...overrides,
  }
}

function ready(
  remoteAccess: Partial<ElectronDesktopState['remoteAccess']> = {},
  update: ElectronDesktopState['update'] = { status: 'current' },
): DesktopControlSnapshot {
  return {
    phase: 'ready',
    value: {
      currentVersion: '0.1.0',
      remoteAccess: {
        enabled: false,
        preferredMode: 'frp',
        transitioning: false,
        frp: frp(),
        ...remoteAccess,
      },
      update,
    },
  }
}

function snapshotHook(snapshot: DesktopControlSnapshot): RemoteAccessSectionProps['useDesktopControl'] {
  return function useDesktopControl<S>(selector: (value: DesktopControlSnapshot) => S): S {
    return selector(snapshot)
  }
}

type Operations = Pick<
  RemoteAccessSectionProps,
  | 'setRemoteAccessEnabled'
  | 'saveRemoteAccessConfiguration'
  | 'selectRemoteAccessFile'
  | 'copyRemoteAccessUrl'
>

function mount(snapshot: DesktopControlSnapshot, overrides: Partial<Operations> = {}) {
  const operations: Operations = {
    setRemoteAccessEnabled: vi.fn(() => Promise.resolve(true)),
    saveRemoteAccessConfiguration: vi.fn(() => Promise.resolve()),
    selectRemoteAccessFile: vi.fn(() => Promise.resolve(null)),
    copyRemoteAccessUrl: vi.fn(() => Promise.resolve(true)),
    ...overrides,
  }
  const props = (value: DesktopControlSnapshot): RemoteAccessSectionProps => ({
    useSessions: unusedHook,
    useWorkspaces: unusedHook,
    close: vi.fn(),
    useDesktopControl: snapshotHook(value),
    ...operations,
    checkForUpdates: vi.fn(() => Promise.resolve()),
    installUpdate: vi.fn(() => Promise.resolve(true)),
    t,
  })
  const view = render(<RemoteAccessSection {...props(snapshot)} />)
  return {
    ...view,
    operations,
    rerender(next: DesktopControlSnapshot) {
      view.rerender(<RemoteAccessSection {...props(next)} />)
    },
  }
}

function input(label: string): HTMLInputElement {
  return screen.getByLabelText(label) as HTMLInputElement
}

function submitFrpForm(): void {
  const form = input(en.serverAddress).closest('form')
  if (form === null) throw new Error('FRP form is absent')
  fireEvent.submit(form)
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => { resolve = done })
  return { promise, resolve }
}

describe('RemoteAccessSection coverage tails', () => {
  it('shows a late bridge failure and keeps the retained form inert', async () => {
    const saveRemoteAccessConfiguration = vi.fn(() => Promise.resolve())
    const view = mount(ready(), { saveRemoteAccessConfiguration })
    await screen.findByLabelText(en.serverAddress)
    view.rerender({ phase: 'failed' })

    expect(screen.getByRole('alert').textContent).toBe(en.operationFailed)
    expect(screen.getByText(en.remoteOff)).toBeTruthy()
    submitFrpForm()
    expect(saveRemoteAccessConfiguration).not.toHaveBeenCalled()
  })

  it('reports every FRP validation error in priority order', async () => {
    const selectRemoteAccessFile = vi.fn<RemoteAccessSectionProps['selectRemoteAccessFile']>()
      .mockResolvedValueOnce(' ')
      .mockResolvedValueOnce('frpc')
    mount(ready(), { selectRemoteAccessFile })
    await screen.findByLabelText(en.serverAddress)

    fireEvent.change(input(en.serverAddress), { target: { value: '' } })
    expect(screen.getByRole('alert').textContent).toBe(en.serverAddressInvalid)
    fireEvent.change(input(en.serverAddress), { target: { value: 'frps.example.com' } })

    fireEvent.change(input(en.serverPort), { target: { value: 'seven-thousand' } })
    expect(screen.getByRole('alert').textContent).toBe(en.serverPortInvalid)
    fireEvent.change(input(en.serverPort), { target: { value: '7000' } })

    fireEvent.change(input(en.remotePort), { target: { value: '-1' } })
    expect(screen.getByRole('alert').textContent).toBe(en.remotePortInvalid)
    fireEvent.change(input(en.remotePort), { target: { value: '7400' } })

    const executableButton = screen.getAllByRole('button', { name: en.selectFile })[0]!
    fireEvent.click(executableButton)
    await waitFor(() => {
      expect(screen.getByRole('alert').textContent).toBe(en.executableInvalid)
    })
    fireEvent.click(executableButton)
    await waitFor(() => {
      expect(input(en.frpcExecutable)).toHaveProperty('value', 'frpc')
    })

    fireEvent.change(input(en.publicOrigin), { target: { value: 'not a URL' } })
    expect(screen.getByRole('alert').textContent).toBe(en.publicOriginInvalid)
    fireEvent.change(input(en.publicOrigin), { target: { value: 'https://harness.example.com' } })

    fireEvent.change(input(en.remotePort), { target: { value: '0' } })
    expect(screen.getByRole('alert').textContent).toBe(en.automaticOriginInvalid)
    fireEvent.change(input(en.remotePort), { target: { value: '7400' } })

    fireEvent.change(input(en.tlsServerName), { target: { value: 'https://frps.example.com' } })
    expect(screen.getByRole('alert').textContent).toBe(en.tlsServerNameInvalid)
    fireEvent.change(input(en.tlsServerName), { target: { value: '' } })

    fireEvent.change(input(en.publicOrigin), { target: { value: 'http://harness.example.com' } })
    expect(screen.getByRole('alert').textContent).toBe(en.plaintextRequired)
    fireEvent.click(input(en.plaintextAcknowledgement))
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('reports a native file-selector failure', async () => {
    const selectRemoteAccessFile = vi.fn(() => Promise.reject(new Error('dialog failed')))
    mount(ready(), { selectRemoteAccessFile })
    await screen.findByLabelText(en.frpcExecutable)

    fireEvent.click(screen.getAllByRole('button', { name: en.selectFile })[0]!)
    expect((await screen.findByRole('alert')).textContent).toBe(en.operationFailed)
  })

  it('rejects invalid and clean form submissions before IPC', async () => {
    const saveRemoteAccessConfiguration = vi.fn(() => Promise.resolve())
    mount(ready(), { saveRemoteAccessConfiguration })
    await screen.findByLabelText(en.serverAddress)

    submitFrpForm()
    fireEvent.change(input(en.serverPort), { target: { value: 'invalid' } })
    submitFrpForm()

    expect(saveRemoteAccessConfiguration).not.toHaveBeenCalled()
  })

  it('rejects a submit while remote access is enabled', async () => {
    const saveRemoteAccessConfiguration = vi.fn(() => Promise.resolve())
    mount(ready({
      activeMode: 'frp',
      enabled: true,
      publicEndpoint: 'https://harness.example.com/',
    }), { saveRemoteAccessConfiguration })
    await screen.findByLabelText(en.serverAddress)

    submitFrpForm()

    expect(saveRemoteAccessConfiguration).not.toHaveBeenCalled()
  })

  it('reports a failed configuration save', async () => {
    const saveRemoteAccessConfiguration = vi.fn(() => Promise.reject(new Error('disk full')))
    mount(ready(), { saveRemoteAccessConfiguration })
    await screen.findByLabelText(en.serverAddress)
    fireEvent.change(input(en.serverPort), { target: { value: '7001' } })

    submitFrpForm()

    expect((await screen.findByRole('alert')).textContent).toBe(en.operationFailed)
    expect(saveRemoteAccessConfiguration).toHaveBeenCalledOnce()
  })

  it('covers LAN status and both copy failure results', async () => {
    const copyRemoteAccessUrl = vi.fn()
      .mockResolvedValueOnce(false)
      .mockRejectedValueOnce(new Error('clipboard unavailable'))
    mount(ready({
      activeMode: 'lan',
      enabled: true,
      preferredMode: 'lan',
      publicEndpoint: 'http://192.0.2.10:8080/',
    }), { copyRemoteAccessUrl })

    expect(screen.getByText(en.remoteOnLan)).toBeTruthy()
    const copy = screen.getByRole('button', { name: en.copyUrl })
    fireEvent.click(copy)
    expect((await screen.findByRole('alert')).textContent).toBe(en.operationFailed)
    fireEvent.click(copy)
    await waitFor(() => { expect(copyRemoteAccessUrl).toHaveBeenCalledTimes(2) })
    expect(screen.getByRole('alert').textContent).toBe(en.operationFailed)
  })

  it('renders the transition status independently of local pending state', () => {
    mount(ready({ transitioning: true }))
    expect(screen.getByText(en.remoteChanging)).toBeTruthy()
  })

  it('supports cancel and non-pending Escape on the LAN enable confirmation', () => {
    mount(ready({ preferredMode: 'lan' }))
    const toggle = screen.getByRole('switch', { name: en.remoteEnable })

    fireEvent.click(toggle)
    expect(screen.getByText(en.remoteEnableConfirmLan)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: en.cancel }))
    expect(screen.queryByRole('dialog')).toBeNull()

    fireEvent.click(toggle)
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('keeps the dialog open during a pending enable operation', async () => {
    const pending = deferred<boolean>()
    const setRemoteAccessEnabled = vi.fn(() => pending.promise)
    mount(ready({ preferredMode: 'lan' }), { setRemoteAccessEnabled })
    fireEvent.click(screen.getByRole('switch', { name: en.remoteEnable }))
    fireEvent.click(screen.getByRole('button', { name: en.confirmEnable }))
    await waitFor(() => {
      expect(screen.getByRole<HTMLButtonElement>('button', { name: en.confirmEnable }).disabled).toBe(true)
    })

    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.getByRole('dialog')).toBeTruthy()
    await act(async () => { pending.resolve(true); await pending.promise })
    await waitFor(() => { expect(screen.queryByRole('dialog')).toBeNull() })
  })

  it.each([
    ['a false enable result', () => Promise.resolve(false)],
    ['a rejected enable request', () => Promise.reject(new Error('backend failed'))],
  ])('reports %s', async (_label, operation) => {
    mount(ready({ preferredMode: 'lan' }), { setRemoteAccessEnabled: vi.fn(operation) })
    fireEvent.click(screen.getByRole('switch', { name: en.remoteEnable }))
    fireEvent.click(screen.getByRole('button', { name: en.confirmEnable }))

    expect((await screen.findByRole('alert')).textContent).toBe(en.operationFailed)
  })
})

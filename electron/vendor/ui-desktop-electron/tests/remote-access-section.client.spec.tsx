// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ElectronDesktopState, ElectronFrpConfiguration } from '../src/bridge-contract.ts'
import type {} from '../src/client/index.ts'
import type { DesktopControlSnapshot } from '../src/client/desktop-controller.ts'
import {
  RemoteAccessSection,
  type RemoteAccessSectionProps,
} from '../src/client/RemoteAccessSection.tsx'
import { en } from '../src/client/locales.ts'

afterEach(cleanup)

const unusedHook = (() => { throw new Error('RemoteAccessSection must not read global hooks') }) as never
const t: RemoteAccessSectionProps['t'] = key => (en as Record<string, string>)[key] ?? key

function frp(overrides: Partial<ElectronFrpConfiguration> = {}): ElectronFrpConfiguration {
  return {
    serverAddress: '',
    serverPort: 7_000,
    remotePort: 0,
    publicOrigin: '',
    executablePath: 'frpc',
    tlsTrustedCaFile: '',
    tlsServerName: '',
    authTokenConfigured: false,
    allowInsecureHttp: false,
    ...overrides,
  }
}

function ready(
  overrides: Partial<ElectronDesktopState['remoteAccess']> = {},
): DesktopControlSnapshot {
  return {
    phase: 'ready',
    value: {
      currentVersion: '0.1.0',
      remoteAccess: {
        enabled: false,
        preferredMode: 'lan',
        transitioning: false,
        frp: frp(),
        ...overrides,
      },
      update: { status: 'current' },
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

function mount(initial: DesktopControlSnapshot, overrides: Partial<Operations> = {}) {
  let snapshot = initial
  const operations: Operations = {
    setRemoteAccessEnabled: vi.fn(() => Promise.resolve(true)),
    saveRemoteAccessConfiguration: vi.fn(() => Promise.resolve()),
    selectRemoteAccessFile: vi.fn(() => Promise.resolve(null)),
    copyRemoteAccessUrl: vi.fn(() => Promise.resolve(true)),
    ...overrides,
  }
  const props = (): RemoteAccessSectionProps => ({
    useSessions: unusedHook,
    useWorkspaces: unusedHook,
    close: vi.fn(),
    useDesktopControl: snapshotHook(snapshot),
    ...operations,
    checkForUpdates: vi.fn(() => Promise.resolve()),
    installUpdate: vi.fn(() => Promise.resolve(true)),
    t,
  })
  const view = render(<RemoteAccessSection {...props()} />)
  return {
    ...view,
    operations,
    rerender(next: DesktopControlSnapshot) {
      snapshot = next
      view.rerender(<RemoteAccessSection {...props()} />)
    },
  }
}

describe('RemoteAccessSection FRP settings', () => {
  it('renders only the redacted secret state from a stored FRP configuration', async () => {
    const view = mount(ready({
      preferredMode: 'frp',
      frp: frp({
        serverAddress: 'frps.example.com',
        remotePort: 7_400,
        publicOrigin: 'https://harness.example.com',
        tlsTrustedCaFile: '/etc/frp/ca.crt',
        authTokenConfigured: true,
      }),
    }))

    expect(await screen.findByLabelText(en.serverAddress)).toHaveProperty('value', 'frps.example.com')
    const token = screen.getByLabelText(en.authToken)
    expect(token).toHaveProperty('type', 'password')
    expect(token).toHaveProperty('value', '')
    expect(token).toHaveProperty('placeholder', en.tokenConfigured)
    expect(token.closest('label')).toBeNull()
    expect(screen.getByRole('button', { name: en.clearToken }).closest('label')).toBeNull()
    expect(view.container.textContent).not.toContain('dsh-access')
  })

  it('validates and saves a public server draft with a one-way token replacement', async () => {
    const saveRemoteAccessConfiguration = vi.fn<RemoteAccessSectionProps['saveRemoteAccessConfiguration']>(
      () => Promise.resolve(),
    )
    const selectRemoteAccessFile = vi.fn<RemoteAccessSectionProps['selectRemoteAccessFile']>(
      () => Promise.resolve('/etc/frp/ca.crt'),
    )
    const view = mount(ready(), { saveRemoteAccessConfiguration, selectRemoteAccessFile })

    fireEvent.click(screen.getByRole('button', { name: en.modeFrp }))
    const save = screen.getByRole('button', { name: en.saveConfiguration })
    expect(save).toHaveProperty('disabled', true)
    expect(screen.getByRole('switch', { name: en.remoteEnable })).toHaveProperty('disabled', true)

    fireEvent.change(screen.getByLabelText(en.serverAddress), { target: { value: '203.0.113.10' } })
    fireEvent.change(screen.getByLabelText(en.remotePort), { target: { value: '7400' } })
    fireEvent.click(screen.getAllByRole('button', { name: en.selectFile })[1]!)
    await waitFor(() => {
      expect(screen.getByLabelText(en.trustedCaFile)).toHaveProperty('value', '/etc/frp/ca.crt')
    })
    fireEvent.change(screen.getByLabelText(en.authToken), { target: { value: 'frps-secret' } })
    fireEvent.click(screen.getByLabelText(en.plaintextAcknowledgement))

    expect(save).toHaveProperty('disabled', false)
    expect(view.container.textContent).not.toContain('frps-secret')
    fireEvent.click(save)

    await waitFor(() => {
      expect(saveRemoteAccessConfiguration).toHaveBeenCalledWith({
        mode: 'frp',
        frp: {
          serverAddress: '203.0.113.10',
          serverPort: 7_000,
          remotePort: 7_400,
          publicOrigin: '',
          executablePath: 'frpc',
          tlsTrustedCaFile: '/etc/frp/ca.crt',
          tlsServerName: '',
          allowInsecureHttp: true,
          authToken: { action: 'replace', value: 'frps-secret' },
        },
      })
    })
  })

  it('selects both persisted FRP paths and leaves them unchanged after cancellation', async () => {
    const selectRemoteAccessFile = vi.fn<RemoteAccessSectionProps['selectRemoteAccessFile']>()
      .mockResolvedValueOnce('/Applications/frpc')
      .mockResolvedValueOnce(null)
    mount(ready({ preferredMode: 'frp', frp: frp() }), { selectRemoteAccessFile })
    await screen.findByLabelText(en.frpcExecutable)

    const buttons = screen.getAllByRole('button', { name: en.selectFile })
    fireEvent.click(buttons[0]!)
    await waitFor(() => {
      expect(screen.getByLabelText(en.frpcExecutable)).toHaveProperty('value', '/Applications/frpc')
    })
    fireEvent.click(buttons[1]!)
    await waitFor(() => { expect(selectRemoteAccessFile).toHaveBeenCalledTimes(2) })
    expect(screen.getByLabelText(en.trustedCaFile)).toHaveProperty('value', '')
    expect(selectRemoteAccessFile.mock.calls).toEqual([
      ['frpc-executable'],
      ['trusted-ca'],
    ])
  })

  it('clears a stored authentication token only through the explicit action', async () => {
    const saveRemoteAccessConfiguration = vi.fn<RemoteAccessSectionProps['saveRemoteAccessConfiguration']>(
      () => Promise.resolve(),
    )
    mount(ready({
      preferredMode: 'frp',
      frp: frp({
        serverAddress: 'frps.example.com',
        remotePort: 7_400,
        publicOrigin: 'https://harness.example.com',
        tlsTrustedCaFile: '/etc/frp/ca.crt',
        authTokenConfigured: true,
      }),
    }), { saveRemoteAccessConfiguration })
    await screen.findByLabelText(en.authToken)

    fireEvent.change(screen.getByLabelText(en.remotePort), { target: { value: '7401' } })
    fireEvent.click(screen.getByRole('button', { name: en.clearToken }))
    fireEvent.click(screen.getByRole('button', { name: en.saveConfiguration }))

    await waitFor(() => { expect(saveRemoteAccessConfiguration).toHaveBeenCalledOnce() })
    expect(saveRemoteAccessConfiguration.mock.calls[0]?.[0].frp.authToken).toEqual({ action: 'clear' })
  })

  it('saves a switch back to LAN before enabling it', async () => {
    const saveRemoteAccessConfiguration = vi.fn(() => Promise.resolve())
    mount(ready({
      preferredMode: 'frp',
      frp: frp({
        serverAddress: 'frps.example.com',
        remotePort: 7_400,
        publicOrigin: 'https://harness.example.com',
        tlsTrustedCaFile: '/etc/frp/ca.crt',
        authTokenConfigured: true,
      }),
    }), { saveRemoteAccessConfiguration })
    await screen.findByLabelText(en.serverAddress)

    fireEvent.click(screen.getByRole('button', { name: en.modeLan }))
    expect(screen.getByRole('switch', { name: en.remoteEnable })).toHaveProperty('disabled', true)
    fireEvent.click(screen.getByRole('button', { name: en.saveConfiguration }))

    await waitFor(() => {
      expect(saveRemoteAccessConfiguration).toHaveBeenCalledWith({
        mode: 'lan',
        frp: {
          serverAddress: 'frps.example.com',
          serverPort: 7_000,
          remotePort: 7_400,
          publicOrigin: 'https://harness.example.com',
          executablePath: 'frpc',
          tlsTrustedCaFile: '/etc/frp/ca.crt',
          tlsServerName: '',
          allowInsecureHttp: false,
          authToken: { action: 'keep' },
        },
      })
    })
  })

  it('confirms FRP enable and disable while exposing only the public endpoint', async () => {
    const setRemoteAccessEnabled = vi.fn(() => Promise.resolve(true))
    const copyRemoteAccessUrl = vi.fn(() => Promise.resolve(true))
    const configuration = frp({
      serverAddress: 'frps.example.com',
      remotePort: 7_400,
      publicOrigin: 'https://harness.example.com',
      tlsTrustedCaFile: '/etc/frp/ca.crt',
    })
    const view = mount(ready({ preferredMode: 'frp', frp: configuration }), {
      copyRemoteAccessUrl,
      setRemoteAccessEnabled,
    })
    await screen.findByLabelText(en.serverAddress)

    fireEvent.click(screen.getByRole('switch', { name: en.remoteEnable }))
    expect(screen.getByText(en.remoteEnableConfirmFrp)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: en.confirmEnable }))
    await waitFor(() => { expect(setRemoteAccessEnabled).toHaveBeenCalledWith(true) })

    view.rerender(ready({
      activeMode: 'frp',
      enabled: true,
      preferredMode: 'frp',
      publicEndpoint: 'https://harness.example.com/',
      frp: configuration,
    }))
    expect(screen.getByText('https://harness.example.com/')).toBeTruthy()
    expect(view.container.textContent).not.toContain('#dsh-access=')
    expect(screen.getByLabelText(en.serverAddress)).toHaveProperty('disabled', true)

    fireEvent.click(screen.getByRole('button', { name: en.copyUrl }))
    await waitFor(() => { expect(copyRemoteAccessUrl).toHaveBeenCalledOnce() })
    expect(await screen.findByRole('button', { name: en.copied })).toBeTruthy()

    fireEvent.click(screen.getByRole('switch', { name: en.remoteDisable }))
    fireEvent.click(screen.getByRole('button', { name: en.confirmDisable }))
    await waitFor(() => {
      expect(setRemoteAccessEnabled).toHaveBeenNthCalledWith(2, false)
    })
  })
})

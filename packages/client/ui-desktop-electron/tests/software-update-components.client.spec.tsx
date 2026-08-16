// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ElectronDesktopState, ElectronUpdateState } from '../src/bridge-contract.ts'
import type { DesktopControlSnapshot } from '../src/client/desktop-controller.ts'
import { en } from '../src/client/locales.ts'
import { SoftwareInfoItem, type SoftwareInfoItemProps } from '../src/client/SoftwareInfoItem.tsx'
import { UpdateBadge, type UpdateBadgeProps } from '../src/client/UpdateBadge.tsx'

afterEach(cleanup)

const unusedHook = (() => { throw new Error('unused standard-kit hook') }) as never
const kit = { useSessions: unusedHook, useWorkspaces: unusedHook }
const t = ((key: keyof typeof en) => en[key]) as SoftwareInfoItemProps['t']

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((done, fail) => {
    resolve = done
    reject = fail
  })
  return { promise, reject, resolve }
}

function desktopState(update: ElectronUpdateState): ElectronDesktopState {
  return {
    currentVersion: '0.1.0',
    remoteAccess: {
      enabled: false,
      preferredMode: 'lan',
      transitioning: false,
      frp: {
        serverAddress: '',
        serverPort: 7_000,
        remotePort: 0,
        publicOrigin: '',
        executablePath: 'frpc',
        tlsTrustedCaFile: '',
        tlsServerName: '',
        authTokenConfigured: false,
        allowInsecureHttp: false,
      },
    },
    update,
  }
}

function useSnapshot(
  snapshot: DesktopControlSnapshot,
): SoftwareInfoItemProps['useDesktopControl'] {
  return ((selector: (value: DesktopControlSnapshot) => unknown) => selector(snapshot)) as never
}

function softwareProps(update: ElectronUpdateState): SoftwareInfoItemProps {
  return {
    ...kit,
    t,
    useDesktopControl: useSnapshot({ phase: 'ready', value: desktopState(update) }),
    setRemoteAccessEnabled: vi.fn(() => Promise.resolve(true)),
    saveRemoteAccessConfiguration: vi.fn(() => Promise.resolve()),
    selectRemoteAccessFile: vi.fn(() => Promise.resolve(null)),
    copyRemoteAccessUrl: vi.fn(() => Promise.resolve(true)),
    checkForUpdates: vi.fn(() => Promise.resolve()),
    installUpdate: vi.fn(() => Promise.resolve(true)),
  }
}

function badgeProps(
  update: ElectronUpdateState,
  installUpdate: UpdateBadgeProps['installUpdate'] = vi.fn(() => Promise.resolve(true)),
): UpdateBadgeProps {
  return {
    ...kit,
    wide: true,
    t,
    useDesktopControl: useSnapshot({ phase: 'ready', value: desktopState(update) }),
    checkForUpdates: vi.fn(() => Promise.resolve()),
    installUpdate,
    setRemoteAccessEnabled: vi.fn(() => Promise.resolve(true)),
    saveRemoteAccessConfiguration: vi.fn(() => Promise.resolve()),
    selectRemoteAccessFile: vi.fn(() => Promise.resolve(null)),
    copyRemoteAccessUrl: vi.fn(() => Promise.resolve(true)),
  }
}

describe('SoftwareInfoItem', () => {
  it('renders a stable title while the desktop bridge is not ready', () => {
    render(<SoftwareInfoItem
      {...softwareProps({ status: 'idle' })}
      useDesktopControl={useSnapshot({ phase: 'loading' })}
    />)

    expect(screen.getByRole('heading', { name: 'Software information' })).toBeTruthy()
    expect(screen.queryByText('Current version')).toBeNull()
  })

  it.each([
    [{ status: 'idle' }, 'No release is currently available', true],
    [{ status: 'checking' }, 'Checking for updates…', false],
    [{ status: 'current' }, 'This is the latest version', true],
    [{ status: 'disabled' }, 'In-app updates are unavailable on this platform', false],
    [{ status: 'unsupported' }, 'In-app updates are unavailable on this platform', false],
    [{ status: 'no-release' }, 'No release is currently available', true],
    [{ status: 'failed', detail: 'network failed' }, 'The update check failed', true],
  ] satisfies readonly [ElectronUpdateState, string, boolean][])(
    'renders the $status updater state',
    (update, label, offersCheck) => {
      render(<SoftwareInfoItem {...softwareProps(update)} />)

      expect(screen.getByText(label)).toBeTruthy()
      expect(screen.queryByRole('button', { name: 'Check for updates' }) !== null).toBe(offersCheck)
      expect(screen.getByText('0.1.0')).toBeTruthy()
    },
  )

  it('shows release notes and runs a prepared update', async () => {
    const installing = deferred<boolean>()
    const installUpdate = vi.fn(() => installing.promise)
    render(<SoftwareInfoItem
      {...softwareProps({ status: 'ready', version: '0.2.0', changelog: 'Faster startup.' })}
      installUpdate={installUpdate}
    />)

    expect(screen.getByText('Version 0.2.0 is available')).toBeTruthy()
    expect(screen.getByText('Faster startup.')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Check for updates' })).toBeNull()
    const install = screen.getByRole('button', { name: 'Install and restart' })
    fireEvent.click(install)
    await waitFor(() => { expect((install as HTMLButtonElement).disabled).toBe(true) })
    expect(installUpdate).toHaveBeenCalledOnce()

    await act(async () => { installing.resolve(true); await installing.promise })
    await waitFor(() => { expect((install as HTMLButtonElement).disabled).toBe(false) })
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('reports a failed check and clears the error before retrying', async () => {
    const checkForUpdates = vi.fn()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce(undefined)
    render(<SoftwareInfoItem
      {...softwareProps({ status: 'idle' })}
      checkForUpdates={checkForUpdates}
    />)

    const check = screen.getByRole('button', { name: 'Check for updates' })
    fireEvent.click(check)
    expect((await screen.findByRole('alert')).textContent).toBe('The operation failed. Try again.')

    fireEvent.click(check)
    await waitFor(() => { expect(screen.queryByRole('alert')).toBeNull() })
    expect(checkForUpdates).toHaveBeenCalledTimes(2)
  })
})

describe('UpdateBadge', () => {
  it('stays absent before bridge readiness and without a prepared update', () => {
    const { container, rerender } = render(<UpdateBadge
      {...badgeProps({ status: 'idle' })}
      useDesktopControl={useSnapshot({ phase: 'failed' })}
    />)
    expect(container.firstChild).toBeNull()

    rerender(<UpdateBadge {...badgeProps({ status: 'current' })} />)
    expect(container.firstChild).toBeNull()
  })

  it('opens release notes, blocks dismissal during install, and closes after success', async () => {
    const installing = deferred<boolean>()
    const installUpdate = vi.fn(() => installing.promise)
    render(<UpdateBadge
      {...badgeProps({ status: 'ready', version: '0.2.0', changelog: 'Faster startup.' }, installUpdate)}
    />)

    const badge = screen.getByRole('button', { name: 'Version 0.2.0 is available' })
    fireEvent.click(badge)
    expect(screen.getByRole('dialog', { name: 'Software update' })).toBeTruthy()
    expect(screen.getByText('Faster startup.')).toBeTruthy()

    const install = screen.getByRole('button', { name: 'Install and restart' })
    fireEvent.click(install)
    await waitFor(() => { expect((install as HTMLButtonElement).disabled).toBe(true) })
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.getByRole('dialog', { name: 'Software update' })).toBeTruthy()

    await act(async () => { installing.resolve(true); await installing.promise })
    await waitFor(() => { expect((install as HTMLButtonElement).disabled).toBe(false) })
    fireEvent.keyDown(document, { key: 'Escape' })
    await waitFor(() => { expect(screen.queryByRole('dialog')).toBeNull() })
  })

  it('allows cancellation before installation', () => {
    render(<UpdateBadge {...badgeProps({ status: 'ready', version: '0.2.0', changelog: 'Notes.' })} />)
    fireEvent.click(screen.getByRole('button', { name: 'Version 0.2.0 is available' }))
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it.each([
    ['a rejected install', () => Promise.reject(new Error('launch failed'))],
    ['an install that does not start', () => Promise.resolve(false)],
  ])('reports %s', async (_label, installUpdate) => {
    render(<UpdateBadge
      {...badgeProps(
        { status: 'ready', version: '0.2.0', changelog: 'Notes.' },
        vi.fn(installUpdate),
      )}
    />)
    fireEvent.click(screen.getByRole('button', { name: 'Version 0.2.0 is available' }))
    fireEvent.click(screen.getByRole('button', { name: 'Install and restart' }))

    expect((await screen.findByRole('alert')).textContent).toBe('The operation failed. Try again.')
  })
})

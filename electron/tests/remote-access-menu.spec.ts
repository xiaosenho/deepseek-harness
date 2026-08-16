import { describe, expect, it, vi, type Mock } from 'vitest'
import {
  changeRemoteAccessFromMenu,
  copyRemoteAccessUrl,
  showRemoteAccessDetails,
  type NativeRemoteAccessOptions,
} from '../src/remote-access-menu.ts'
import type {
  RemoteAccessState,
  RemoteAccessTransitionResult,
} from '../src/remote-access-controller.ts'

const REMOTE_URL = 'http://192.168.1.5:43128/#dsh-access=fresh-token'

function options(initial: RemoteAccessState = {
  enabled: false,
  preferredMode: 'lan',
  transitioning: false,
}): NativeRemoteAccessOptions & {
  navigate: Mock<(url: URL) => void>
  refreshMenu: Mock<() => void>
  setEnabled: Mock<(enabled: boolean) => Promise<RemoteAccessTransitionResult>>
  showMessageBox: Mock<NativeRemoteAccessOptions['showMessageBox']>
  writeText: Mock<(text: string) => void>
  setState: (state: RemoteAccessState) => void
} {
  let state = initial
  const setEnabled = vi.fn(async (enabled: boolean): Promise<RemoteAccessTransitionResult> => {
    const preferredMode = state.preferredMode
    state = enabled
      ? { enabled: true, mode: preferredMode, preferredMode, transitioning: false, url: REMOTE_URL }
      : { enabled: false, preferredMode, transitioning: false }
    return {
      succeeded: true,
      navigationUrl: new URL(enabled
        ? 'http://127.0.0.1:43128/'
        : 'http://127.0.0.1:43129/'),
    }
  })
  const navigate = vi.fn<(url: URL) => void>()
  const refreshMenu = vi.fn<() => void>()
  const showMessageBox = vi.fn<NativeRemoteAccessOptions['showMessageBox']>()
    .mockResolvedValue({ checkboxChecked: false, response: 1 })
  const writeText = vi.fn<(text: string) => void>()
  return {
    applicationName: 'DeepSeek Harness',
    controller: {
      getState: () => state,
      setEnabled,
    },
    navigate,
    refreshMenu,
    showMessageBox,
    writeText,
    setEnabled,
    setState: (next) => { state = next },
  }
}

describe('native Electron remote-access commands', () => {
  it('leaves the loopback backend unchanged when start is cancelled', async () => {
    const o = options()
    await expect(changeRemoteAccessFromMenu(true, o)).resolves.toBe(false)
    expect(o.showMessageBox).toHaveBeenCalledWith(expect.objectContaining({
      message: 'Start remote access?',
      defaultId: 1,
    }))
    expect(o.setEnabled).not.toHaveBeenCalled()
    expect(o.refreshMenu).not.toHaveBeenCalled()
  })

  it('warns that FRP publishes publicly and plaintext HTTP can be intercepted', async () => {
    const o = options({ enabled: false, preferredMode: 'frp', transitioning: false })

    await expect(changeRemoteAccessFromMenu(true, o)).resolves.toBe(false)
    const dialog = o.showMessageBox.mock.calls[0]?.[0]
    expect(dialog).toMatchObject({
      message: 'Publish remote access through FRP?',
      defaultId: 1,
    })
    expect(dialog?.detail).toMatch(/public FRP server.*plaintext HTTP.*interception/u)
    expect(o.setEnabled).not.toHaveBeenCalled()
  })

  it('starts access, refreshes native state, navigates, and presents the URL', async () => {
    const o = options()
    o.showMessageBox
      .mockResolvedValueOnce({ checkboxChecked: false, response: 0 })
      .mockResolvedValueOnce({ checkboxChecked: false, response: 1 })

    await expect(changeRemoteAccessFromMenu(true, o)).resolves.toBe(true)
    expect(o.setEnabled).toHaveBeenCalledWith(true)
    expect(o.refreshMenu).toHaveBeenCalledTimes(2)
    expect(o.navigate).toHaveBeenCalledWith(new URL('http://127.0.0.1:43128/'))
    const details = o.showMessageBox.mock.calls.at(-1)?.[0]
    expect(details?.message).toBe('Remote access is ready.')
    expect(details?.detail).toContain(REMOTE_URL)
    expect(o.writeText).not.toHaveBeenCalled()
  })

  it('copies the URL from the ready dialog', async () => {
    const o = options({
      enabled: true,
      mode: 'lan',
      preferredMode: 'lan',
      transitioning: false,
      url: REMOTE_URL,
    })
    o.showMessageBox.mockResolvedValueOnce({ checkboxChecked: false, response: 0 })

    await expect(showRemoteAccessDetails(o)).resolves.toBe(true)
    expect(o.writeText).toHaveBeenCalledWith(REMOTE_URL)
  })

  it('stops access and navigates to the replacement loopback origin', async () => {
    const o = options({
      enabled: true,
      mode: 'lan',
      preferredMode: 'lan',
      transitioning: false,
      url: REMOTE_URL,
    })
    o.showMessageBox.mockResolvedValueOnce({ checkboxChecked: false, response: 0 })

    await expect(changeRemoteAccessFromMenu(false, o)).resolves.toBe(true)
    expect(o.showMessageBox).toHaveBeenCalledTimes(1)
    expect(o.showMessageBox).toHaveBeenCalledWith(expect.objectContaining({
      message: 'Stop remote access?',
    }))
    expect(o.navigate).toHaveBeenCalledWith(new URL('http://127.0.0.1:43129/'))
  })

  it('loads a recovered origin after a failed change without presenting details', async () => {
    const o = options()
    o.showMessageBox.mockResolvedValueOnce({ checkboxChecked: false, response: 0 })
    o.setEnabled.mockImplementationOnce(async () => ({
      succeeded: false,
      navigationUrl: new URL('http://127.0.0.1:43130/'),
    }))

    await expect(changeRemoteAccessFromMenu(true, o)).resolves.toBe(false)
    expect(o.navigate).toHaveBeenCalledWith(new URL('http://127.0.0.1:43130/'))
    expect(o.showMessageBox).toHaveBeenCalledTimes(1)
  })

  it('refreshes the menu when a transition throws', async () => {
    const o = options()
    o.showMessageBox.mockResolvedValueOnce({ checkboxChecked: false, response: 0 })
    o.setEnabled.mockRejectedValueOnce(new Error('unexpected transition failure'))

    await expect(changeRemoteAccessFromMenu(true, o)).rejects.toThrow('unexpected transition failure')
    expect(o.refreshMenu).toHaveBeenCalledTimes(2)
  })

  it.each([
    { enabled: false, preferredMode: 'lan', transitioning: true } as const,
    {
      enabled: true,
      mode: 'lan',
      preferredMode: 'lan',
      transitioning: false,
      url: REMOTE_URL,
    } as const,
  ])('rejects an obsolete transition request from state $enabled/$transitioning', async (state) => {
    const o = options(state)
    await expect(changeRemoteAccessFromMenu(state.enabled, o)).resolves.toBe(false)
    expect(o.showMessageBox).not.toHaveBeenCalled()
  })

  it('rechecks state after confirmation before starting a transition', async () => {
    const o = options()
    o.showMessageBox.mockImplementationOnce(async () => {
      o.setState({ enabled: false, preferredMode: 'lan', transitioning: true })
      return { checkboxChecked: false, response: 0 }
    })

    await expect(changeRemoteAccessFromMenu(true, o)).resolves.toBe(false)
    expect(o.setEnabled).not.toHaveBeenCalled()
    expect(o.refreshMenu).toHaveBeenCalledTimes(1)
  })

  it('does not start a transport selected after its confirmation dialog opened', async () => {
    const o = options()
    o.showMessageBox.mockImplementationOnce(async () => {
      o.setState({ enabled: false, preferredMode: 'frp', transitioning: false })
      return { checkboxChecked: false, response: 0 }
    })

    await expect(changeRemoteAccessFromMenu(true, o)).resolves.toBe(false)
    expect(o.setEnabled).not.toHaveBeenCalled()
    expect(o.refreshMenu).toHaveBeenCalledTimes(1)
  })

  it('does not navigate when a rejected transition has no recovery URL', async () => {
    const o = options()
    o.showMessageBox.mockResolvedValueOnce({ checkboxChecked: false, response: 0 })
    o.setEnabled.mockResolvedValueOnce({ succeeded: false })

    await expect(changeRemoteAccessFromMenu(true, o)).resolves.toBe(false)
    expect(o.navigate).not.toHaveBeenCalled()
  })

  it.each([
    { enabled: false, preferredMode: 'lan', transitioning: false } as const,
    {
      enabled: true,
      mode: 'frp',
      preferredMode: 'frp',
      transitioning: true,
      url: REMOTE_URL,
    } as const,
    { enabled: true, mode: 'frp', preferredMode: 'frp', transitioning: false } as const,
  ])('refuses details and copy without one settled URL', async (state) => {
    const o = options(state)
    await expect(showRemoteAccessDetails(o)).resolves.toBe(false)
    await expect(copyRemoteAccessUrl(o)).resolves.toBe(false)
    expect(o.showMessageBox).not.toHaveBeenCalled()
    expect(o.writeText).not.toHaveBeenCalled()
  })

  it('refuses to copy a URL that rotated while its detail dialog was open', async () => {
    const o = options({
      enabled: true,
      mode: 'lan',
      preferredMode: 'lan',
      transitioning: false,
      url: REMOTE_URL,
    })
    o.showMessageBox.mockImplementationOnce(async () => {
      o.setState({
        enabled: true,
        mode: 'lan',
        preferredMode: 'lan',
        transitioning: false,
        url: 'http://192.168.1.5:43129/#dsh-access=replacement',
      })
      return { checkboxChecked: false, response: 0 }
    })

    await expect(showRemoteAccessDetails(o)).resolves.toBe(false)
    expect(o.showMessageBox).toHaveBeenLastCalledWith(expect.objectContaining({
      message: 'The remote access URL changed.',
    }))
    expect(o.writeText).not.toHaveBeenCalled()
  })

  it.each([new Error('clipboard denied'), 'clipboard unavailable'])(
    'reports clipboard failure %s through a native dialog',
    async (failure) => {
      const o = options({
        enabled: true,
        mode: 'lan',
        preferredMode: 'lan',
        transitioning: false,
        url: REMOTE_URL,
      })
      o.writeText.mockImplementationOnce(() => { throw failure })

      await expect(copyRemoteAccessUrl(o)).resolves.toBe(false)
      expect(o.showMessageBox).toHaveBeenCalledWith(expect.objectContaining({
        message: 'The remote access URL could not be copied.',
        detail: failure instanceof Error ? failure.message : failure,
      }))
    },
  )
})

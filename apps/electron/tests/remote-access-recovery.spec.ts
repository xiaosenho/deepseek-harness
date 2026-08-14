import { describe, expect, it, vi } from 'vitest'
import {
  FatalRemoteAccessRecovery,
  quitAfterFatalRemoteAccessFailure,
} from '../src/remote-access-recovery.ts'

describe('fatal Electron remote-access recovery', () => {
  it('waits for user acknowledgement before quitting', async () => {
    let acknowledge!: () => void
    const showFailure = vi.fn(() => new Promise<void>((resolve) => { acknowledge = resolve }))
    const quit = vi.fn()

    const recovery = quitAfterFatalRemoteAccessFailure(showFailure, quit)
    expect(showFailure).toHaveBeenCalledOnce()
    expect(quit).not.toHaveBeenCalled()
    acknowledge()
    await recovery
    expect(quit).toHaveBeenCalledOnce()
  })

  it('still quits when the native error dialog fails', async () => {
    const dialogError = new Error('dialog unavailable')
    const write = vi.spyOn(console, 'error').mockImplementation(() => {})
    const quit = vi.fn()
    try {
      await quitAfterFatalRemoteAccessFailure(async () => { throw dialogError }, quit)
      expect(write).toHaveBeenCalledWith(
        'Failed to show the fatal Electron remote-access error.',
        dialogError,
      )
      expect(quit).toHaveBeenCalledOnce()
    } finally {
      write.mockRestore()
    }
  })

  it('coalesces repeated fatal reports for the application lifetime', async () => {
    let acknowledge!: () => void
    const recovery = new FatalRemoteAccessRecovery()
    const showFailure = vi.fn(() => new Promise<void>((resolve) => { acknowledge = resolve }))
    const quit = vi.fn()

    const first = recovery.run(showFailure, quit)
    const second = recovery.run(vi.fn(), vi.fn())
    expect(second).toBe(first)
    expect(showFailure).toHaveBeenCalledOnce()
    acknowledge()
    await Promise.all([first, second])
    expect(quit).toHaveBeenCalledOnce()

    await recovery.run(vi.fn(), vi.fn())
    expect(showFailure).toHaveBeenCalledOnce()
    expect(quit).toHaveBeenCalledOnce()
  })
})

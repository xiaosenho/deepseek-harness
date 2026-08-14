import { describe, expect, it, vi } from 'vitest'
import { ExitBarrier } from '../src/exit-barrier.ts'

describe('Electron exit barrier', () => {
  it('coalesces shutdown attempts and becomes ready only after shutdown finishes', async () => {
    let finishStopping: (() => void) | undefined
    const stop = vi.fn(() => new Promise<void>((resolve) => { finishStopping = resolve }))
    const barrier = new ExitBarrier()

    const first = barrier.prepare(stop)
    const second = barrier.prepare(stop)

    await vi.waitFor(() => { expect(stop).toHaveBeenCalledOnce() })
    expect(barrier.canExit).toBe(false)
    expect(first).toBe(second)
    finishStopping?.()
    await Promise.all([first, second])

    expect(barrier.canExit).toBe(true)
    await barrier.prepare(stop)
    expect(stop).toHaveBeenCalledOnce()
  })

  it('keeps exit blocked and permits a retry after shutdown fails', async () => {
    const stop = vi.fn()
      .mockRejectedValueOnce(new Error('tree still running'))
      .mockResolvedValueOnce(undefined)
    const barrier = new ExitBarrier()

    await expect(barrier.prepare(stop)).rejects.toThrow('tree still running')
    expect(barrier.canExit).toBe(false)

    await barrier.prepare(stop)
    expect(stop).toHaveBeenCalledTimes(2)
    expect(barrier.canExit).toBe(true)
  })
})

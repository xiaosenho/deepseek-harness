import { describe, expect, it, vi } from 'vitest'
import { ExitBarrier } from '../src/exit-barrier.ts'

describe('ExitBarrier', () => {
  it('joins one shutdown operation and becomes ready', async () => {
    const barrier = new ExitBarrier()
    const stop = vi.fn(async () => {})

    await barrier.prepare(stop)
    expect(barrier.canExit).toBe(true)
    expect(stop).toHaveBeenCalledOnce()
    await barrier.prepare(stop)
    expect(stop).toHaveBeenCalledOnce()
  })

  it('allows a failed shutdown to be retried', async () => {
    const barrier = new ExitBarrier()
    let attempts = 0
    const stop = vi.fn(async () => {
      attempts += 1
      if (attempts === 1) throw new Error('shutdown failed')
    })

    await expect(barrier.prepare(stop)).rejects.toThrow('shutdown failed')
    expect(barrier.canExit).toBe(false)
    await expect(barrier.prepare(stop)).resolves.toBeUndefined()
    expect(stop).toHaveBeenCalledTimes(2)
  })
})

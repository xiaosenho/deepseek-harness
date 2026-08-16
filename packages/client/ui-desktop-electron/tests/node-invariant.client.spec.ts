import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import InvariantRegistry from '@deepseek-ai/dsh-invariants'
import { apply as applyNode } from '../src/index.ts'
import * as DesktopInvariant from '../src/invariant.ts'

describe('desktop Electron host entry', () => {
  it('contributes no Host behavior', () => {
    expect(applyNode).not.toThrow()
  })
})

describe('desktop Electron invariant companion', () => {
  it('reserves package ownership with its explained empty installer', async () => {
    const ctx = new Context()
    await ctx.plugin(InvariantRegistry, { enabled: true })
    const fiber = ctx.plugin(DesktopInvariant)

    await expect(fiber.await()).resolves.toBeDefined()
    expect(DesktopInvariant.name).toBe('client-ui-desktop-electron-invariant')
    expect(DesktopInvariant.inject).toEqual(['invariants'])
    await fiber.dispose()
  })
})

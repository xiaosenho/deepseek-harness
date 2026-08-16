/** Registration of the Electron directory-picker invariant companion. */

import { Context } from '@deepseek-ai/cordis'
import InvariantRegistry from '@deepseek-ai/dsh-invariants'
import { describe, expect, it } from 'vitest'
import * as ElectronDirectoryPickerInvariant from '../src/invariant.ts'

describe('Electron directory-picker invariant companion', () => {
  it('registers its package-owned empty installer', async () => {
    const ctx = new Context()
    await ctx.plugin(InvariantRegistry, { enabled: true })
    const fiber = ctx.plugin(ElectronDirectoryPickerInvariant)
    await expect(fiber.await()).resolves.toBeDefined()
    await fiber.dispose()
    await expect(ctx.plugin(ElectronDirectoryPickerInvariant).await()).resolves.toBeDefined()
    await ctx.fiber.dispose()
  })
})

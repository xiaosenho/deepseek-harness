// @vitest-environment jsdom
import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import {
  BrowseDirectoryFlow,
  NativeDirectoryFlow,
} from '@deepseek-ai/dsh-client-directory-picker-flows'
import { SlotRegistry } from '@deepseek-ai/dsh-client-runtime/client'
import type { DirectoryListing } from '@deepseek-ai/dsh-client-runtime/client'
import { apply, inject } from '../src/client/index.ts'
import { apply as nodeApply } from '../src/index.ts'

const HOLES = ['conversation.hero.workspace.directoryFlow', 'sidebar.workspaces.directoryFlow'] as const

const listing: DirectoryListing = {
  path: '/home/u',
  home: '/home/u',
  crumbs: [{ name: 'u', path: '/home/u', hidden: false }],
  entries: [],
  truncated: false,
}

async function mounted(isLoopback: boolean) {
  const ctx = new Context()
  await ctx.plugin(SlotRegistry).await()
  ctx.provide('locale', new LocaleRuntime(ctx))
  const pickDirectory = vi.fn(async () => '/home/u/native')
  const listDirectory = vi.fn(async () => listing)
  const createDirectory = vi.fn(async (path: string, name: string) => `${path}/${name}`)
  ctx.provide('connection', { isLoopback } as never)
  ctx.provide('workspaces', { pickDirectory, listDirectory, createDirectory } as never)
  const slots = ctx.get('slots') as SlotRegistry
  slots.register({
    name: 'root',
    children: Object.fromEntries(HOLES.map(name => [name, { kind: 'single', scope: 'root' }])),
  } as never, () => null)
  const fiber = ctx.plugin({ inject: [...inject], apply })
  await fiber.await()
  return { fiber, slots, pickDirectory, listDirectory, createDirectory }
}

describe('directory-picker-electron client half', () => {
  it('declares connection routing and both selected flow dependencies', () => {
    expect(inject).toEqual(['connection', 'slots', 'workspaces', 'locale'])
  })

  it('installs only the native flow on loopback pages', async () => {
    const b = await mounted(true)
    for (const hole of HOLES) {
      const entries = b.slots.entries(hole)
      expect(entries).toHaveLength(1)
      expect(entries[0]?.component).toBe(NativeDirectoryFlow)
    }
    const injected = b.slots.entries(HOLES[0])[0]?.inject?.() as { pick: () => Promise<string | null> }
    await expect(injected.pick()).resolves.toBe('/home/u/native')
    expect(b.listDirectory).not.toHaveBeenCalled()
    expect(b.createDirectory).not.toHaveBeenCalled()
  })

  it('installs only the browse flow on non-loopback pages', async () => {
    const b = await mounted(false)
    for (const hole of HOLES) {
      const entries = b.slots.entries(hole)
      expect(entries).toHaveLength(1)
      expect(entries[0]?.component).toBe(BrowseDirectoryFlow)
    }
    const injected = b.slots.entries(HOLES[1])[0]?.inject?.() as {
      listDirectory: (path?: string) => Promise<DirectoryListing>
      createDirectory: (path: string, name: string) => Promise<string>
      t: (key: string) => string
    }
    await expect(injected.listDirectory()).resolves.toBe(listing)
    await expect(injected.createDirectory('/home/u', 'fresh')).resolves.toBe('/home/u/fresh')
    expect(injected.t('browser.title')).toBe('Select Workspace Directory')
    expect(b.pickDirectory).not.toHaveBeenCalled()
  })

  it('removes the selected pair with the plugin fiber', async () => {
    for (const isLoopback of [true, false]) {
      const b = await mounted(isLoopback)
      await b.fiber.dispose()
      for (const hole of HOLES) expect(b.slots.entries(hole)).toHaveLength(0)
    }
  })
})

describe('directory-picker-electron node half', () => {
  it('is an inert loader seat', () => {
    expect(() => { nodeApply() }).not.toThrow()
  })
})

import { join, relative } from 'node:path'
import { pathToFileURL } from 'node:url'
import { act } from '@testing-library/react'
import { expect } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import ClientModuleRegistry from '@deepseek-ai/dsh-client-modules'
import type { WebBootEntry } from '@deepseek-ai/dsh-client-modules/client'
import {
  assembledBootArtifactsAvailable,
  mountAssembledAppAndWait,
  type AssembledBootPlugin,
} from './assembled-boot.ts'

/** Electron selector package discovered by the host-side client catalog. */
const ELECTRON_DIRECTORY_PICKER_ID = '@deepseek-ai/dsh-client-ui-directory-picker-electron'

const ELECTRON_DIRECTORY_PICKER_BUNDLE = 'packages/client/ui-directory-picker-electron/lib/client.js'

/** Single directory-flow slots filled as one pair by the selector. */
const DIRECTORY_FLOW_HOLES = [
  'conversation.hero.workspace.directoryFlow',
  'sidebar.workspaces.directoryFlow',
] as const

/** Result of one assembled selector boot. */
export interface ElectronDirectoryPickerBoot {
  /** Settled browser Cordis context. */
  context: Context
  /** Host-generated catalog row consumed by the browser boot. */
  catalogEntry: WebBootEntry
}

interface ConnectionProbe {
  readonly isLoopback: boolean
}

interface SlotProbe {
  entries(key: string): readonly { component: unknown }[]
}

interface LoaderProbe {
  entries(): Iterable<{
    options: { name?: string }
    fiber?: { dispose(): Promise<void> }
  }>
}

/**
 * Whether every bundle used by the assembled selector test exists.
 * @returns true after the relevant client bundles have been built.
 */
export function electronDirectoryPickerArtifactsAvailable(): boolean {
  return assembledBootArtifactsAvailable([ELECTRON_DIRECTORY_PICKER_BUNDLE])
}

/** Build the selector row through the production host-side dsh.client scanner. */
function selectorCatalogPlugin(): AssembledBootPlugin {
  const ctx = new Context()
  ctx.baseUrl = `${pathToFileURL(join(process.cwd(), 'apps/electron')).href}/`
  ctx.provide('loader', {
    *entries() {
      yield {
        options: { name: ELECTRON_DIRECTORY_PICKER_ID },
        fiber: {},
        disabled: false,
      }
    },
  } as never)
  ctx.provide('webServer', {
    port: 0,
    register: () => () => {},
    tapIndex: () => () => {},
  } as never)
  const registry = new ClientModuleRegistry(ctx)
  const catalogEntry = registry.graph().entries.find(entry => entry.id === ELECTRON_DIRECTORY_PICKER_ID)
  const clientPath = registry.clientPath(ELECTRON_DIRECTORY_PICKER_ID)
  if (catalogEntry === undefined || clientPath === undefined) {
    throw new Error('Electron directory-picker selector was absent from the generated client catalog')
  }
  return {
    ...catalogEntry,
    bundlePath: relative(process.cwd(), clientPath),
  }
}

/**
 * Boot the actual selector catalog row and built client bundle through
 * AppWebEntry and ClientModuleSystem.
 * @returns the settled context and catalog row.
 */
export async function mountElectronDirectoryPicker(): Promise<ElectronDirectoryPickerBoot> {
  const plugin = selectorCatalogPlugin()
  const context = await mountAssembledAppAndWait([plugin])
  const { bundlePath: _bundlePath, ...catalogEntry } = plugin
  return { context, catalogEntry }
}

/** Name a function component stored behind the type-erased slot ledger. */
function componentName(component: unknown): string | undefined {
  return typeof component === 'function' ? component.name : undefined
}

/**
 * Assert one authority's selected flow pair and the selector fiber's cleanup.
 * @param boot - settled assembled boot.
 * @param expected - authority classification and inlined component name.
 * @returns resolves after the selector fiber and its pair are removed.
 */
export async function assertElectronDirectoryPickerSelection(
  boot: ElectronDirectoryPickerBoot,
  expected: {
    isLoopback: boolean
    componentName: 'BrowseDirectoryFlow' | 'NativeDirectoryFlow'
  },
): Promise<void> {
  const { context, catalogEntry } = boot
  const connection = context.get('connection') as ConnectionProbe
  const slots = context.get('slots') as SlotProbe

  expect(connection.isLoopback).toBe(expected.isLoopback)
  expect(catalogEntry.id).toBe(ELECTRON_DIRECTORY_PICKER_ID)
  expect(catalogEntry.inject).toEqual([
    '@deepseek-ai/dsh-client-connection',
    '@deepseek-ai/dsh-client-runtime',
    '@deepseek-ai/dsh-client-ui-workspace',
    '@deepseek-ai/dsh-client-locale',
  ])
  expect(catalogEntry.url).toBe(
    `/plugins/${ELECTRON_DIRECTORY_PICKER_ID}/client.js?rev=${catalogEntry.rev}`,
  )
  expect(context.modules.loadCache.has(ELECTRON_DIRECTORY_PICKER_ID)).toBe(true)
  for (const hole of DIRECTORY_FLOW_HOLES) {
    const entries = slots.entries(hole)
    expect(entries).toHaveLength(1)
    expect(componentName(entries[0]?.component)).toBe(expected.componentName)
  }

  const loader = (context as unknown as { loader: LoaderProbe }).loader
  const selector = [...loader.entries()]
    .find(entry => entry.options.name === ELECTRON_DIRECTORY_PICKER_ID)
  expect(selector?.fiber).toBeDefined()
  await act(async () => { await selector?.fiber?.dispose() })
  for (const hole of DIRECTORY_FLOW_HOLES) expect(slots.entries(hole)).toHaveLength(0)
}

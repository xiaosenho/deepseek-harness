/**
 * REAL-composition coverage for the Electron directory-picker overlay:
 * the shipped patch is applied by Include and both replacement packages pass
 * through the vendored Loader before their active entries and capability are
 * observed.
 */

import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
import Include from '@deepseek-ai/cordis-plugin-include'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import { assertEntriesActivated, loadOverlayPatches } from '@deepseek-ai/dsh-app-boot'
import * as ElectronDirectoryPickerClient from '@deepseek-ai/dsh-client-ui-directory-picker-electron'
import ElectronDirectoryPicker from '@deepseek-ai/dsh-host-directory-picker-electron'
import { afterEach, describe, expect, it } from 'vitest'

const AUTO = '@deepseek-ai/dsh-host-directory-picker-auto'
const HOST = '@deepseek-ai/dsh-host-directory-picker-electron'
const CLIENT = '@deepseek-ai/dsh-client-ui-directory-picker-electron'
const OVERLAY_PATH = fileURLToPath(new URL('../resources/electron-directory-picker.cordis.patch.yml', import.meta.url))

const originalSend = Object.getOwnPropertyDescriptor(process, 'send')
const originalConnected = Object.getOwnPropertyDescriptor(process, 'connected')

let root: string | undefined
let context: Context | undefined

/** Restore one process property exactly as the test worker received it. */
function restoreProcessProperty(name: 'send' | 'connected', descriptor: PropertyDescriptor | undefined): void {
  if (descriptor === undefined) {
    Reflect.deleteProperty(process, name)
  } else {
    Object.defineProperty(process, name, descriptor)
  }
}

/** Provide the parent IPC facts the real Electron host provider requires. */
function installProcessIpcStub(): void {
  Object.defineProperty(process, 'connected', {
    configurable: true,
    value: true,
    writable: true,
  })
  Object.defineProperty(process, 'send', {
    configurable: true,
    value: (_message: unknown, callback?: (error: Error | null) => void): boolean => {
      callback?.(null)
      return true
    },
    writable: true,
  })
}

afterEach(async () => {
  const activeContext = context
  context = undefined
  try {
    await activeContext?.fiber.dispose()
  } finally {
    restoreProcessProperty('send', originalSend)
    restoreProcessProperty('connected', originalConnected)
    if (root !== undefined) await rm(root, { recursive: true, force: true })
    root = undefined
  }
})

describe('Electron directory-picker real Loader composition', () => {
  it('declares both overlay plugins in the Web profile bundle resolver', () => {
    const manifest = JSON.parse(readFileSync(fileURLToPath(new URL(
      '../../packages/bundle/web-app/package.json',
      import.meta.url,
    )), 'utf8')) as { dependencies: Record<string, string> }
    expect(manifest.dependencies[HOST]).toBe('workspace:^')
    expect(manifest.dependencies[CLIENT]).toBe('workspace:^')
    // The shell packages the same pair so the main-process bridge resolves
    // them at runtime and the builder ships them inside the app bundle.
    const shell = JSON.parse(readFileSync(fileURLToPath(new URL(
      '../package.json',
      import.meta.url,
    )), 'utf8')) as { dependencies: Record<string, string> }
    expect(shell.dependencies[HOST]).toBe('workspace:^')
    expect(shell.dependencies[CLIENT]).toBe('workspace:^')
  })

  it('replaces the adaptive row with the native-browse host and client selector', async () => {
    root = await mkdtemp(join(tmpdir(), 'dsh-electron-picker-loader-'))
    const configPath = join(root, 'cordis.yml')
    await writeFile(configPath, [
      '- id: directory-picker',
      `  name: '${AUTO}'`,
      '',
    ].join('\n'))
    installProcessIpcStub()

    context = new Context()
    context.baseUrl = pathToFileURL(root).href + '/'
    await context.plugin(Loader)
    context.loader.builtins.include = Include
    const imports: string[] = []
    const modules = new Map<string, unknown>([
      [HOST, ElectronDirectoryPicker],
      [CLIENT, ElectronDirectoryPickerClient],
    ])
    context.loader.internal = {
      version: 'v2',
      async import(specifier: string) {
        imports.push(specifier)
        if (!modules.has(specifier)) throw new Error(`unexpected Loader import: ${specifier}`)
        return modules.get(specifier)
      },
    } as unknown as NonNullable<typeof context.loader.internal>

    await context.loader.create({
      name: 'cordis:include',
      config: {
        path: pathToFileURL(configPath).href,
        patches: loadOverlayPatches('electron picker composition', OVERLAY_PATH),
      },
    })
    await context.loader.await()
    await assertEntriesActivated(context, 'electron picker composition')

    const entries = new Map([...context.loader.entries()].map(entry => [entry.options.id, entry]))
    expect(entries.get('directory-picker')).toMatchObject({ disabled: true, fiber: undefined })
    expect(entries.get('directory-picker-electron')?.fiber).toBeDefined()
    expect(entries.get('ui-directory-picker-electron')?.fiber).toBeDefined()
    expect(new Set(imports)).toEqual(new Set([HOST, CLIENT]))
    expect(context.get('directoryPicker')).toBeInstanceOf(ElectronDirectoryPicker)
    expect(context.directoryPicker.capability().kind).toBe('native-browse')
  })
})

/** Electron network overlays composed through the production Include patch algorithm. */

import { fileURLToPath } from 'node:url'
import { loadOverlayPatches } from '@deepseek-ai/dsh-app-boot'
import { applyEntryPatches, type PatchOptions } from '@deepseek-ai/cordis-plugin-include'
import { describe, expect, it } from 'vitest'

const LOOPBACK_OVERLAY = fileURLToPath(
  new URL('../resources/loopback-access.cordis.patch.yml', import.meta.url),
)
const LAN_OVERLAY = fileURLToPath(
  new URL('../resources/lan-access.cordis.patch.yml', import.meta.url),
)
const REVERSE_OVERLAY = fileURLToPath(
  new URL('../resources/reverse-access.cordis.patch.yml', import.meta.url),
)
const BASE_ENTRIES = [
  {
    id: 'webserver',
    name: '@deepseek-ai/dsh-host-webserver',
    config: { host: '127.0.0.1', port: 3080 },
  },
  {
    id: 'connection',
    name: '@deepseek-ai/dsh-client-connection',
    config: { trustedHosts: [] },
  },
]
const USER_NETWORK_PATCHES: PatchOptions[] = [
  { id: 'webserver', config: { host: '0.0.0.0', port: 7777 } },
  {
    id: 'connection',
    config: {
      loopbackAccessToken: 'stale-local-token',
      remoteAccessToken: 'stale-user-token',
      trustedHosts: ['untrusted.example'],
    },
  },
]

function composeNetworkOverlay(path: string): Map<string, PatchOptions> {
  let warned = false
  const entries = applyEntryPatches(
    BASE_ENTRIES,
    [...USER_NETWORK_PATCHES, ...loadOverlayPatches('electron network composition', path)],
    () => { warned = true },
  )
  expect(warned).toBe(false)
  return new Map(entries.map(entry => [entry.id ?? '', entry]))
}

describe('Electron network overlay composition', () => {
  it('reasserts loopback binding and removes lower-layer remote credentials', () => {
    const entries = composeNetworkOverlay(LOOPBACK_OVERLAY)

    expect(entries.get('webserver')?.config).toEqual({
      host: '127.0.0.1',
      port: { __jsExpr: 'ctx.webStartup.port ?? 0' },
    })
    expect(entries.get('connection')?.config).toEqual({ trustedHosts: [] })
    expect(entries.get('connection')?.config).not.toHaveProperty('remoteAccessToken')
    expect(entries.get('connection')?.config).not.toHaveProperty('loopbackAccessToken')
  })

  it('reasserts LAN binding and replaces lower-layer credentials with the launch token', () => {
    const entries = composeNetworkOverlay(LAN_OVERLAY)

    expect(entries.get('webserver')?.config).toEqual({
      host: '0.0.0.0',
      port: { __jsExpr: 'ctx.webStartup.port ?? 0' },
    })
    expect(entries.get('connection')?.config).toEqual({
      remoteAccessToken: {
        __jsExpr: "process.env.DSH_ELECTRON_REMOTE_ACCESS_TOKEN ?? ''",
      },
      trustedHosts: { __jsExpr: 'ctx.webRuntime.trustedHosts' },
    })
  })

  it('keeps reverse access on loopback and trusts only the launch authority and token', () => {
    const entries = composeNetworkOverlay(REVERSE_OVERLAY)

    expect(entries.get('webserver')?.config).toEqual({
      host: '127.0.0.1',
      port: { __jsExpr: 'ctx.webStartup.port ?? 0' },
    })
    expect(entries.get('connection')?.config).toEqual({
      loopbackAccessToken: {
        __jsExpr: "process.env.DSH_ELECTRON_LOOPBACK_ACCESS_TOKEN ?? ''",
      },
      remoteAccessToken: {
        __jsExpr: "process.env.DSH_ELECTRON_REMOTE_ACCESS_TOKEN ?? ''",
      },
      trustedHosts: {
        __jsExpr: '[process.env.DSH_ELECTRON_REMOTE_ACCESS_AUTHORITY]',
      },
    })
  })
})

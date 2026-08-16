import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { checkWebKernelUpdate, readWebKernelInfo } from '../src/web-kernel-info.ts'

const VALID = {
  productName: 'DeepSeek Harness',
  version: '0.1.0-rc.6',
  webKernelCommit: 'a'.repeat(40),
  builtAt: '2026-08-16T00:00:00.000Z',
}

let dir: string | undefined

afterEach(async () => {
  if (dir !== undefined) {
    await rm(dir, { recursive: true, force: true })
    dir = undefined
  }
})

async function recordPath(content: string): Promise<string> {
  dir = await mkdtemp(join(tmpdir(), 'dsh-kernel-info-'))
  const path = join(dir, 'version.json')
  await writeFile(path, content)
  return path
}

describe('readWebKernelInfo', () => {
  it('reads a valid build-time record', async () => {
    expect(readWebKernelInfo(await recordPath(JSON.stringify(VALID)))).toEqual(VALID)
  })

  it('returns null for a missing file', () => {
    expect(readWebKernelInfo('/nonexistent/version.json')).toBeNull()
  })

  it('returns null for malformed content', async () => {
    expect(readWebKernelInfo(await recordPath('{not json'))).toBeNull()
  })

  it('returns null when required fields are absent', async () => {
    expect(readWebKernelInfo(await recordPath(JSON.stringify({ version: '1' })))).toBeNull()
  })
})

describe('checkWebKernelUpdate', () => {
  const pinned = 'b'.repeat(40)
  const fetchOf = (impl: () => Promise<Response>) => impl as never

  it('reports current when upstream master equals the pin', async () => {
    const result = await checkWebKernelUpdate(pinned, fetchOf(async () => new Response(pinned, { status: 200 })), 'https://api.example')
    expect(result).toEqual({ status: 'current' })
  })

  it('reports update-available with the latest commit', async () => {
    const latest = 'c'.repeat(40)
    const result = await checkWebKernelUpdate(pinned, fetchOf(async () => new Response(latest, { status: 200 })), 'https://api.example')
    expect(result).toEqual({ status: 'update-available', latestCommit: latest })
  })

  it('reports failed on a non-OK response', async () => {
    const result = await checkWebKernelUpdate(pinned, fetchOf(async () => new Response('nope', { status: 403 })), 'https://api.example')
    expect(result.status).toBe('failed')
  })

  it('reports failed on a network error', async () => {
    const result = await checkWebKernelUpdate(pinned, fetchOf(async () => { throw new Error('boom') }), 'https://api.example')
    expect(result.status).toBe('failed')
  })

  it('reports unknown for an invalid pin', async () => {
    expect(await checkWebKernelUpdate('short', fetchOf(async () => new Response('x', { status: 200 })))).toEqual({ status: 'unknown' })
  })
})

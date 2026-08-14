import { basename } from 'node:path'
import { describe, expect, it } from 'vitest'
import { buildBackendArgs } from '../src/backend.ts'

describe('buildBackendArgs', () => {
  it('pins the browse directory picker on Windows', () => {
    const args = buildBackendArgs('win32', 'dsh.js')

    expect(args.slice(0, 3)).toEqual(['--expose-internals', 'dsh.js', 'web'])
    expect(args.slice(3, 5)).toEqual([
      '--patch',
      expect.stringContaining('windows-directory-picker.cordis.patch.yml'),
    ])
    expect(args.slice(5)).toEqual(['--host', '127.0.0.1', '--port', '0'])
    expect(basename(args[4] ?? '')).toBe('windows-directory-picker.cordis.patch.yml')
  })

  it('keeps the adaptive picker on macOS and Linux', () => {
    expect(buildBackendArgs('darwin', 'dsh.js')).toEqual([
      '--expose-internals', 'dsh.js', 'web', '--host', '127.0.0.1', '--port', '0',
    ])
    expect(buildBackendArgs('linux', 'dsh.js')).toEqual([
      '--expose-internals', 'dsh.js', 'web', '--host', '127.0.0.1', '--port', '0',
    ])
  })
})

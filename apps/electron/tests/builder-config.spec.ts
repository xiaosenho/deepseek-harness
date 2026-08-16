import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import config from '../electron-builder.config.mjs'

const electronRoot = resolve(import.meta.dirname, '..')

describe('Electron Builder runtime closure', () => {
  it('packages the CommonJS preload used by the sandboxed window', () => {
    expect(config.files).toContain('lib/*.cjs')
    expect(readFileSync(resolve(electronRoot, 'src/main.ts'), 'utf8')).toContain(
      "preload: join(app.getAppPath(), 'lib', 'preload.cjs')",
    )
  })

  it('packages every direct workspace dependency and its runtime closure', () => {
    const destinations = config.extraResources.map(resource => resource.to)
    expect(destinations).toContain('app/node_modules/@deepseek-ai/dsh')
    expect(destinations).toContain('app/node_modules/@deepseek-ai/dsh-client-connection')
    expect(destinations).toContain('app/node_modules/@deepseek-ai/dsh-client-ui-desktop-electron')
    expect(destinations).toContain('app/node_modules/@deepseek-ai/dsh-host-directory-picker-electron')
    expect(destinations).toContain('app/node_modules/@deepseek-ai/dsh-client-ui-directory-picker-electron')
  })

  it('generates desktop update metadata and both macOS delivery artifacts', () => {
    expect(config.detectUpdateChannel).toBe(false)
    expect(config.publish).toEqual({
      provider: 'generic',
      url: 'https://application-1305333896.cos.ap-guangzhou.myqcloud.com/',
    })
    expect(config.mac.target.map(target => target.target)).toEqual(['dmg', 'zip'])
    expect(config.win.target.map(target => target.target)).toEqual(['nsis'])
  })

  it('ships the exact Sharp Windows license and source materials', () => {
    expect(config.extraResources).toContainEqual({
      from: 'legal',
      to: 'legal',
      filter: ['**/*'],
    })
    const manifest = JSON.parse(readFileSync(resolve(electronRoot, 'package.json'), 'utf8')) as {
      optionalDependencies: Record<string, string>
    }
    const notice = readFileSync(resolve(electronRoot, 'legal/SHARP-LIBVIPS-NOTICE.md'), 'utf8')
    expect(notice).toContain(`@img/sharp-win32-x64 ${manifest.optionalDependencies['@img/sharp-win32-x64']}`)
    expect(notice).toContain('libvips 8.18.3')
    expect(readFileSync(resolve(electronRoot, 'legal/LGPL-3.0.txt'), 'utf8')).toContain('GNU LESSER GENERAL PUBLIC LICENSE')
    expect(readFileSync(resolve(electronRoot, 'legal/GPL-3.0.txt'), 'utf8')).toContain('GNU GENERAL PUBLIC LICENSE')
  })
})

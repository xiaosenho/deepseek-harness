import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  defaultRemoteAccessConfiguration,
  frpPublicOrigin,
  frpTrustedAuthority,
  normalizeFrpServerAddress,
  normalizeRemoteAccessConfiguration,
  redactRemoteAccessConfiguration,
  RemoteAccessConfigurationStore,
  type RemoteAccessConfiguration,
  type RemoteAccessSecretCodec,
} from '../src/remote-access-config.ts'

const roots: string[] = []

const codec: RemoteAccessSecretCodec = {
  encrypt: value => `encrypted:${Buffer.from(value).toString('base64url')}`,
  decrypt: (value) => {
    if (!value.startsWith('encrypted:')) throw new Error('secret ciphertext is invalid')
    return Buffer.from(value.slice('encrypted:'.length), 'base64url').toString()
  },
}

function frpInput(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    serverAddress: '  FRPS.Example.COM  ',
    serverPort: 7_000,
    remotePort: 32_080,
    publicOrigin: '',
    executablePath: ' /opt/frpc ',
    tlsTrustedCaFile: ' /etc/frp/ca.crt ',
    tlsServerName: ' TLS.Example.COM ',
    allowInsecureHttp: true,
    authToken: { action: 'keep' },
    ...overrides,
  }
}

function configuration(): RemoteAccessConfiguration {
  return {
    mode: 'frp',
    frp: {
      serverAddress: 'frps.example.com',
      serverPort: 7_000,
      remotePort: 32_080,
      publicOrigin: '',
      executablePath: '/opt/frpc',
      tlsTrustedCaFile: '/etc/frp/ca.crt',
      tlsServerName: 'tls.example.com',
      allowInsecureHttp: true,
      authToken: 'shared-frps-secret',
    },
  }
}

async function temporaryFile(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'dsh-electron-remote-config-'))
  roots.push(root)
  return join(root, 'settings', 'remote-access.json')
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

describe('Electron remote-access configuration validation', () => {
  it('defaults to disabled LAN preferences without inventing an FRP endpoint', () => {
    const defaults = defaultRemoteAccessConfiguration('/bundled/frpc')

    expect(defaults).toEqual({
      mode: 'lan',
      frp: {
        serverAddress: '',
        serverPort: 7_000,
        remotePort: 0,
        publicOrigin: '',
        executablePath: '/bundled/frpc',
        tlsTrustedCaFile: '',
        tlsServerName: '',
        allowInsecureHttp: false,
      },
    })
    expect(redactRemoteAccessConfiguration(defaults).frp.authTokenConfigured).toBe(false)
  })

  it('normalizes an IPC draft and applies explicit secret operations', () => {
    const replaced = normalizeRemoteAccessConfiguration({
      mode: 'frp',
      frp: frpInput({ authToken: { action: 'replace', value: '  new-secret  ' } }),
    }, defaultRemoteAccessConfiguration())

    expect(replaced).toEqual({
      mode: 'frp',
      frp: {
        serverAddress: 'frps.example.com',
        serverPort: 7_000,
        remotePort: 32_080,
        publicOrigin: '',
        executablePath: '/opt/frpc',
        tlsTrustedCaFile: '/etc/frp/ca.crt',
        tlsServerName: 'tls.example.com',
        allowInsecureHttp: true,
        authToken: 'new-secret',
      },
    })
    expect(redactRemoteAccessConfiguration(replaced)).toMatchObject({
      mode: 'frp',
      frp: { authTokenConfigured: true },
    })

    const kept = normalizeRemoteAccessConfiguration({ mode: 'frp', frp: frpInput() }, replaced)
    expect(kept.frp.authToken).toBe('new-secret')
    const cleared = normalizeRemoteAccessConfiguration({
      mode: 'frp',
      frp: frpInput({ authToken: { action: 'clear' } }),
    }, kept)
    expect(cleared.frp).not.toHaveProperty('authToken')
  })

  it.each([
    [frpInput({ allowInsecureHttp: false }), /plaintext public access requires explicit acknowledgement/u],
    [frpInput({ serverAddress: 'https://frps.example.com' }), /bare IP address or hostname/u],
    [frpInput({ serverPort: 0 }), /frps port must be between 1 and 65535/u],
    [frpInput({ remotePort: 65_536 }), /FRP public port must be between 0 and 65535/u],
    [frpInput({ publicOrigin: 'https://remote.example.com/path' }), /only an HTTP or HTTPS authority/u],
    [frpInput({ publicOrigin: 'https://remote.example.com', remotePort: 0 }), /automatic public ports/u],
    [frpInput({ tlsTrustedCaFile: '' }), /trusted CA file must not be empty/u],
    [frpInput({ tlsServerName: 'https://frps.example.com' }), /TLS server name must be a bare IP address or hostname/u],
    [frpInput({ authToken: { action: 'replace', value: '' } }), /authentication token must not be empty/u],
  ])('rejects an unsafe or malformed FRP draft %#', (frp, expected) => {
    expect(() => normalizeRemoteAccessConfiguration({ mode: 'frp', frp }, configuration()))
      .toThrow(expected)
  })

  it('rejects unexpected IPC fields and non-canonical server inputs', () => {
    expect(() => normalizeRemoteAccessConfiguration({
      mode: 'frp',
      frp: frpInput(),
      enabled: true,
    }, configuration())).toThrow('unexpected field enabled')
    expect(() => normalizeFrpServerAddress('0.0.0.0')).toThrow('must name one server')
    expect(normalizeFrpServerAddress('2001:db8::1')).toBe('2001:db8::1')
  })

  it('derives trusted and public authorities for fixed, assigned, and HTTPS endpoints', () => {
    const fixed = configuration().frp
    expect(frpTrustedAuthority(fixed)).toBe('frps.example.com:32080')
    expect(frpPublicOrigin(fixed, 32_080).href).toBe('http://frps.example.com:32080/')

    const assigned = { ...fixed, remotePort: 0, serverAddress: '2001:db8::1' }
    expect(frpTrustedAuthority(assigned)).toBe('[2001:db8::1]')
    expect(frpPublicOrigin(assigned, 31_337).href).toBe('http://[2001:db8::1]:31337/')

    const terminated = {
      ...fixed,
      publicOrigin: 'https://harness.example.com',
      allowInsecureHttp: false,
    }
    expect(frpTrustedAuthority(terminated)).toBe('harness.example.com')
    expect(frpPublicOrigin(terminated, 32_080).href).toBe('https://harness.example.com/')
  })
})

describe('Electron remote-access configuration persistence', () => {
  it('returns the supplied first-run defaults when no file exists', async () => {
    const filename = await temporaryFile()
    const defaults = defaultRemoteAccessConfiguration('/bundled/frpc')

    await expect(new RemoteAccessConfigurationStore(filename, codec).load(defaults))
      .resolves.toBe(defaults)
  })

  it('atomically stores only encrypted secrets and restores the complete configuration', async () => {
    const filename = await temporaryFile()
    const store = new RemoteAccessConfigurationStore(filename, codec)
    const value = configuration()

    await store.save(value)

    const source = await readFile(filename, 'utf8')
    expect(source).not.toContain('shared-frps-secret')
    expect(source).toContain('encryptedAuthToken')
    expect(source).not.toContain('"enabled"')
    await expect(store.load(defaultRemoteAccessConfiguration())).resolves.toEqual(value)
    if (process.platform !== 'win32') {
      expect((await stat(filename)).mode & 0o777).toBe(0o600)
      expect((await stat(dirname(filename))).mode & 0o777).toBe(0o700)
    }
  })

  it.each([
    ['not JSON\n', /not valid JSON/u],
    ['{"version":3,"mode":"lan","frp":{}}\n', /version is unsupported/u],
    ['{"version":2,"mode":"lan","frp":{},"enabled":true}\n', /unexpected field enabled/u],
  ])('fails loud for invalid stored settings %#', async (source, expected) => {
    const filename = await temporaryFile()
    await mkdir(dirname(filename), { recursive: true })
    await writeFile(filename, source)

    await expect(new RemoteAccessConfigurationStore(filename, codec).load(
      defaultRemoteAccessConfiguration(),
    )).rejects.toThrow(expected)
  })

  it('contains decryption failures instead of replacing an unreadable secret', async () => {
    const filename = await temporaryFile()
    await mkdir(dirname(filename), { recursive: true })
    await writeFile(filename, `${JSON.stringify({
      version: 2,
      mode: 'lan',
      frp: {
        ...configuration().frp,
        authToken: undefined,
        encryptedAuthToken: 'not-our-ciphertext',
      },
    })}\n`)

    await expect(new RemoteAccessConfigurationStore(filename, codec).load(
      defaultRemoteAccessConfiguration(),
    )).rejects.toThrow('secret ciphertext is invalid')
  })
})

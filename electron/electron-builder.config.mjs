/** Electron Builder assembly for the shell plus the pinned Web kernel closure. */

import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const appDir = dirname(fileURLToPath(import.meta.url))
const workspaceRoot = resolve(appDir, '..')
const kernelRoot = join(workspaceRoot, 'deepseek-harness-web')
const appManifest = JSON.parse(readFileSync(join(appDir, 'package.json'), 'utf8'))

function childDirectories(parent) {
  return readdirSync(parent, { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .map(entry => join(parent, entry.name))
}

/** Every runtime workspace package: the shell's vendor/ plus the pinned kernel. */
function workspacePackageDirectories() {
  const shellVendor = childDirectories(join(appDir, 'vendor'))
  const kernelVendor = childDirectories(join(kernelRoot, 'vendor'))
  const kernelPackages = childDirectories(join(kernelRoot, 'packages')).flatMap(childDirectories)
  const kernelApps = childDirectories(join(kernelRoot, 'apps'))
  const kernelNative = childDirectories(join(kernelRoot, 'native')).flatMap((dir) => {
    const nested = join(dir, 'packages')
    return [dir, ...existsSync(nested) ? childDirectories(nested) : []]
  })
  return [...shellVendor, ...kernelVendor, ...kernelPackages, ...kernelApps, ...kernelNative]
    .filter(dir => existsSync(join(dir, 'package.json')))
}

const workspacePackages = new Map(workspacePackageDirectories().map((dir) => {
  const manifest = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'))
  return [manifest.name, { dir, manifest }]
}))

function runtimeWorkspacePackages() {
  const selected = new Set()
  const pending = Object.entries(appManifest.dependencies ?? {})
    .filter(([, version]) => typeof version === 'string' && version.startsWith('workspace:'))
    .map(([name]) => name)
  while (pending.length > 0) {
    const name = pending.pop()
    if (name === undefined || selected.has(name)) continue
    const record = workspacePackages.get(name)
    if (record === undefined) throw new Error(`Electron runtime workspace package not found: ${name}`)
    selected.add(name)
    const dependencies = { ...record.manifest.dependencies, ...record.manifest.peerDependencies }
    for (const [dependency, version] of Object.entries(dependencies)) {
      if (record.manifest.peerDependenciesMeta?.[dependency]?.optional === true) continue
      if (typeof version === 'string' && version.startsWith('workspace:')) pending.push(dependency)
    }
  }
  return [...selected].sort().map(name => workspacePackages.get(name))
}

function packageFilter(files = ['lib']) {
  return ['package.json', ...files.flatMap(file => file.startsWith('!') ? [file] : [file, `${file}/**/*`])]
}

const workspaceRuntime = runtimeWorkspacePackages().map(({ dir, manifest }) => ({
  from: relative(appDir, dir),
  to: `app/node_modules/${manifest.name}`,
  filter: packageFilter(manifest.files),
}))

const legalResources = {
  from: 'legal',
  to: 'legal',
  filter: ['**/*'],
}

export default {
  appId: 'ai.deepseek.harness',
  artifactName: 'deepseek-harness-${version}-${os}-${arch}.${ext}',
  asar: false,
  detectUpdateChannel: false,
  npmRebuild: false,
  directories: { output: '../../dist/electron' },
  files: ['lib/*.cjs', 'lib/*.js', 'resources/*.yml', 'package.json'],
  extraResources: [...workspaceRuntime, legalResources],
  publish: {
    provider: 'generic',
    url: 'https://application-1305333896.cos.ap-guangzhou.myqcloud.com/',
  },
  mac: {
    category: 'public.app-category.developer-tools',
    icon: 'build/icon.png',
    target: [
      { target: 'dmg', arch: ['arm64'] },
      { target: 'zip', arch: ['arm64'] },
    ],
  },
  dmg: {
    title: 'DeepSeek Harness ${version}',
  },
  win: {
    icon: 'build/icon.png',
    target: [{ target: 'nsis', arch: ['x64'] }],
  },
  nsis: {
    oneClick: false,
    allowToChangeInstallationDirectory: true,
    createDesktopShortcut: true,
    createStartMenuShortcut: true,
    shortcutName: 'DeepSeek Harness',
  },
  linux: {
    category: 'Development',
    target: ['AppImage', 'deb'],
  },
}

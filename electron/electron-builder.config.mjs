/** Electron Builder assembly for the shell plus the workspace dsh runtime closure. */

import { createRequire } from 'node:module'
import { existsSync, readFileSync, readdirSync, realpathSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const appDir = dirname(fileURLToPath(import.meta.url))
const workspaceRoot = resolve(appDir, '..')
const appManifest = JSON.parse(readFileSync(join(appDir, 'package.json'), 'utf8'))

function childDirectories(parent) {
  if (!existsSync(parent)) return []
  return readdirSync(parent, { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .map(entry => join(parent, entry.name))
}

/** Every runtime workspace package reachable from the shell dependency tree. */
function workspacePackageDirectories() {
  const vendor = childDirectories(join(workspaceRoot, 'vendor'))
  const packages = childDirectories(join(workspaceRoot, 'packages')).flatMap(childDirectories)
  const apps = childDirectories(join(workspaceRoot, 'apps'))
  const native = childDirectories(join(workspaceRoot, 'native')).flatMap((dir) => {
    const nested = join(dir, 'packages')
    return [dir, ...existsSync(nested) ? childDirectories(nested) : []]
  })
  return [...vendor, ...packages, ...apps, ...native]
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

function packageDirectoryIfNamed(dir, name) {
  const manifestPath = join(dir, 'package.json')
  if (!existsSync(manifestPath)) return undefined
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
  return manifest.name === name ? realpathSync(dir) : undefined
}

function resolveInstalledDependency(fromDir, name) {
  const candidates = [join(fromDir, 'node_modules', name), join(dirname(fromDir), name)]
  for (const candidate of candidates) {
    if (!existsSync(candidate)) continue
    const found = packageDirectoryIfNamed(candidate, name)
    if (found !== undefined) return found
  }

  const require = createRequire(join(fromDir, 'package.json'))
  let entry
  try {
    entry = require.resolve(name)
  } catch {
    try {
      // Binary-only packages (no main/index.js, e.g. @vscode/ripgrep-darwin-arm64)
      // fail bare resolution; package.json always resolves to their directory.
      entry = require.resolve(`${name}/package.json`)
    } catch {
      return undefined
    }
  }
  let dir = dirname(entry)
  for (;;) {
    const found = packageDirectoryIfNamed(dir, name)
    if (found !== undefined) return found
    const parent = dirname(dir)
    if (parent === dir) return undefined
    dir = parent
  }
}

function runtimeDependencyNames(manifest) {
  const peerDependencies = Object.keys(manifest.peerDependencies ?? {})
    .filter(name => manifest.peerDependenciesMeta?.[name]?.optional !== true)
  return [
    ...Object.keys(manifest.dependencies ?? {}),
    ...peerDependencies,
    ...Object.keys(manifest.optionalDependencies ?? {}),
  ]
}

function collectExternalClosure(fromDir, selected) {
  const manifest = JSON.parse(readFileSync(join(fromDir, 'package.json'), 'utf8'))
  for (const name of runtimeDependencyNames(manifest)) {
    if (workspacePackages.has(name) || selected.has(name)) continue
    const realDir = resolveInstalledDependency(fromDir, name)
    if (realDir === undefined) continue
    selected.set(name, realDir)
    collectExternalClosure(realDir, selected)
  }
}

function workspaceRuntimeResources() {
  const records = runtimeWorkspacePackages()
  const resources = records.map(({ dir, manifest }) => ({
    from: relative(appDir, dir),
    to: `app/node_modules/${manifest.name}`,
    filter: packageFilter(manifest.files),
  }))

  const ownerDependencies = new Map()
  const versionsByName = new Map()
  for (const record of records) {
    const selected = new Map()
    collectExternalClosure(record.dir, selected)
    ownerDependencies.set(record.manifest.name, selected)
    for (const [name, realDir] of selected) {
      const versions = versionsByName.get(name) ?? new Set()
      versions.add(realDir)
      versionsByName.set(name, versions)
    }
  }

  const topLevelVersions = new Map()
  for (const [name, versions] of versionsByName) {
    const ordered = [...versions].sort()
    resources.push({
      from: relative(appDir, ordered[0]),
      to: `app/node_modules/${name}`,
    })
    if (ordered.length > 1) topLevelVersions.set(name, ordered[0])
  }

  for (const record of records) {
    const selected = ownerDependencies.get(record.manifest.name) ?? new Map()
    for (const [name, realDir] of selected) {
      const topLevel = topLevelVersions.get(name)
      if (topLevel !== undefined && realDir !== topLevel) {
        resources.push({
          from: relative(appDir, realDir),
          to: `app/node_modules/${record.manifest.name}/node_modules/${name}`,
        })
      }
    }
  }

  return resources
}

export default {
  appId: 'ai.deepseek.harness',
  productName: 'DeepSeek Harness',
  artifactName: 'deepseek-harness-${version}-${os}-${arch}.${ext}',
  asar: false,
  detectUpdateChannel: false,
  npmRebuild: false,
  directories: { output: 'dist' },
  files: ['lib/*.js', 'package.json'],
  extraResources: workspaceRuntimeResources(),
  publish: {
    provider: 'generic',
    url: 'https://application-1305333896.cos.ap-guangzhou.myqcloud.com/',
  },
  mac: {
    category: 'public.app-category.developer-tools',
    icon: 'build/icon.icns',
    extendInfo: {
      // Squirrel.Mac 直接内容写入：原子替换整个 bundle（rename），
      // 避免默认的逐文件移动（慢、会跳过被占用文件导致部分替换）。
      SquirrelMacEnableDirectContentsWrite: true,
    },
    target: [
      { target: 'dmg', arch: ['arm64'] },
      { target: 'zip', arch: ['arm64'] },
    ],
  },
  dmg: {
    title: 'DeepSeek Harness ${version}',
  },
  win: {
    icon: 'build/icon.ico',
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
    icon: 'build/icon.png',
    target: ['AppImage', 'deb'],
  },
}

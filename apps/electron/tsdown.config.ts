import { defineConfig } from 'tsdown'

/** Bundle the Electron main-process entry while leaving its runtime external. */
export default defineConfig([
  {
    entry: ['lib/types/src/main.js'],
    outDir: 'lib',
    format: ['esm'],
    platform: 'node',
    target: 'es2024',
    fixedExtension: false,
    dts: false,
    clean: false,
    deps: { neverBundle: ['electron', 'electron/common', 'electron/main'] },
  },
  {
    entry: ['lib/types/src/preload.js'],
    outDir: 'lib',
    format: ['cjs'],
    platform: 'node',
    target: 'es2024',
    fixedExtension: false,
    dts: false,
    clean: false,
    deps: { neverBundle: ['electron'] },
  },
])

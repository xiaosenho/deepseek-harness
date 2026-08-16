import { defineConfig } from 'tsdown'

/** Node-only DOCX tool plugin; the root bundle also serves the invariant subpath. */
export default defineConfig([
  {
    entry: ['lib/types/index.js', 'lib/types/invariant.js'],
    outDir: 'lib',
    format: ['esm'],
    platform: 'node',
    target: 'es2024',
    fixedExtension: false,
    dts: false,
    clean: false,
  },
])

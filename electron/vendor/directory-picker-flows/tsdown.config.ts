import { clientOnly } from '../tsdown.client.ts'

export default clientOnly([{
  entry: ['lib/types/index.js', 'lib/types/invariant.js'],
  outDir: 'lib',
  format: ['esm'],
  platform: 'neutral',
  target: 'es2024',
  fixedExtension: false,
  dts: false,
  clean: false,
  plugins: [{
    name: 'dsh-css-stub',
    resolveId(source: string) {
      if (!source.endsWith('.css')) return null
      return `\0dsh-css-stub:${source}.mjs`
    },
    load(id: string) {
      if (!id.startsWith('\0dsh-css-stub:')) return null
      return 'export default {};'
    },
  }],
}])

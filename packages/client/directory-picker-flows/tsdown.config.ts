import { clientCssModulesInlinePlugin, clientOnly, staticLinkedRosterMarker } from '../tsdown.client.ts'

export default clientOnly([{
  entry: ['lib/types/index.js', 'lib/types/invariant.js'],
  outDir: 'lib',
  format: ['esm'],
  platform: 'neutral',
  target: 'es2024',
  fixedExtension: false,
  dts: false,
  clean: false,
  // The sheet ships inside the artifact: consumers inline this library into
  // their client bundles, so the style injector and hashed class map must
  // already be part of the emitted code rather than a runtime external. The
  // roster marker puts this library on the static-assembly roster: consumers
  // treat it as a static client input (dev-only) instead of a dynamic
  // relationship, and its bare imports stay for consumers to resolve.
  plugins: [clientCssModulesInlinePlugin('@deepseek-ai/dsh-client-directory-picker-flows'), staticLinkedRosterMarker()],
}])

import { defineConfig } from 'vitest/config'

/** Electron shell unit tests: pure policy modules, no Electron runtime needed. */
export default defineConfig({
  test: {
    include: ['tests/**/*.spec.ts'],
    environment: 'node',
  },
})

import { defineConfig } from 'vitest/config'
import { sharedSourceAliases } from '../../scripts/shared-source-aliases.mjs'

export default defineConfig({
  root: import.meta.dirname,
  resolve: {
    alias: Object.entries(sharedSourceAliases).map(([find, replacement]) => ({
      find: new RegExp(`^${find}$`),
      replacement
    }))
  },
  test: {
    name: 'shared',
    environment: 'node',
    include: ['test/**/*.test.ts'],
    testTimeout: 10_000,
    hookTimeout: 10_000,
    maxWorkers: 2
  }
})

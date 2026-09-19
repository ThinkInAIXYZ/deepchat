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
    name: 'mcp',
    environment: 'node',
    include: ['test/**/*.test.ts'],
    testTimeout: 15000
  }
})

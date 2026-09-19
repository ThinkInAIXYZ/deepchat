import { defineConfig } from 'vitest/config'
import scope from './test/memory-test-scope.json'
import { memoryResolveConfig, memoryTestDefaults } from './vitest.config.memory-shared'

export default defineConfig({
  resolve: memoryResolveConfig,
  test: {
    ...memoryTestDefaults,
    name: 'memory-behavior',
    include: scope.behavior,
    testTimeout: 10_000,
    hookTimeout: 10_000,
    maxWorkers: 2
  }
})

import { defineConfig } from 'vitest/config'
import scope from './test/memory-test-scope.json'
import { memoryResolveConfig, memoryTestDefaults } from './vitest.config.memory-shared'

export default defineConfig({
  resolve: memoryResolveConfig,
  test: {
    ...memoryTestDefaults,
    name: 'memory-native',
    include: scope.native,
    testTimeout: 30_000,
    hookTimeout: 30_000,
    maxWorkers: 1,
    fileParallelism: false
  }
})

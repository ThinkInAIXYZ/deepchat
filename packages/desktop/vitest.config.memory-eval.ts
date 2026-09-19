import { defineConfig } from 'vitest/config'
import scope from './test/memory-test-scope.json'
import { memoryResolveConfig, memoryTestDefaults } from './vitest.config.memory-shared'

export default defineConfig({
  resolve: memoryResolveConfig,
  test: {
    ...memoryTestDefaults,
    name: 'memory-eval',
    include: scope.eval,
    testTimeout: 120_000,
    hookTimeout: 120_000,
    maxWorkers: 1,
    fileParallelism: false
  }
})

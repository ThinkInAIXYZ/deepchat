import { defineConfig } from 'vitest/config'
import { memoryResolveConfig, memoryTestDefaults } from './vitest.config.memory-shared'

const MEMORY_PERF_TIMEOUT_MS = 120_000

export default defineConfig({
  resolve: memoryResolveConfig,
  test: {
    ...memoryTestDefaults,
    include: ['test/main/performance/memory/**/*.perf.ts'],
    testTimeout: MEMORY_PERF_TIMEOUT_MS,
    hookTimeout: MEMORY_PERF_TIMEOUT_MS,
    maxWorkers: 1,
    fileParallelism: false
  }
})

import { resolve } from 'path'
import { defineConfig } from 'vitest/config'

const MEMORY_PERF_TIMEOUT_MS = 120_000

export default defineConfig({
  resolve: {
    alias: [
      { find: '@/', replacement: resolve('src/main/') + '/' },
      { find: '@shared', replacement: resolve('src/shared') },
      { find: 'electron', replacement: resolve('test/mocks/electron.ts') },
      {
        find: '@electron-toolkit/utils',
        replacement: resolve('test/mocks/electron-toolkit-utils.ts')
      }
    ]
  },
  test: {
    environment: 'node',
    include: ['test/main/performance/memory/**/*.perf.ts'],
    setupFiles: ['./test/setup.ts'],
    globals: true,
    testTimeout: MEMORY_PERF_TIMEOUT_MS,
    hookTimeout: MEMORY_PERF_TIMEOUT_MS,
    maxWorkers: 1,
    fileParallelism: false
  }
})

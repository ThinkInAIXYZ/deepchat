import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['kernelPackage/**/*.test.ts'],
    globals: true,
    testTimeout: 10_000,
    hookTimeout: 10_000
  }
})

import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')

export default defineConfig({
  root: packageRoot,
  test: {
    environment: 'node',
    include: ['test/kernelPackage/**/*.test.ts'],
    globals: true,
    testTimeout: 10_000,
    hookTimeout: 10_000
  }
})

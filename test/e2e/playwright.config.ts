import { defineConfig } from '@playwright/test'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const CONFIG_DIR = dirname(fileURLToPath(import.meta.url))

export default defineConfig({
  testDir: resolve(CONFIG_DIR, 'specs'),
  fullyParallel: false,
  workers: 1,
  retries: 0,
  forbidOnly: !!process.env.CI,
  timeout: 300_000,
  expect: {
    timeout: 30_000
  },
  reporter: [['list'], ['html', { open: 'never' }]],
  outputDir: resolve(CONFIG_DIR, '..', '..', 'test-results', 'e2e'),
  use: {
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    trace: 'retain-on-failure',
    testIdAttribute: 'data-testid'
  }
})

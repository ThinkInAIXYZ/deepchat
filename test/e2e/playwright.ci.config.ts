import { defineConfig } from '@playwright/test'
import baseConfig from './playwright.config'

export default defineConfig({
  ...baseConfig,
  testMatch: ['01-launch.smoke.spec.ts', '04-settings-navigation.smoke.spec.ts'],
  retries: process.env.CI ? 1 : 0,
  reporter: [['list'], ['html', { open: 'never' }]]
})

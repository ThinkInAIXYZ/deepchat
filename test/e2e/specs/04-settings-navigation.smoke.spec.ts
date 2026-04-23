import { test, expect } from '../fixtures/electronApp'
import { openSettings, openSettingsTab } from '../helpers/settings'
import { waitForAppReady } from '../helpers/wait'
import {
  resolveSettingsNavigationPath,
  SETTINGS_NAVIGATION_ITEMS
} from '../../../src/shared/settingsNavigation'

const SETTINGS_TAB_TEST_IDS: Record<string, string> = {
  'settings-common': 'settings-tab-general',
  'settings-display': 'settings-tab-appearance',
  'settings-provider': 'settings-tab-model-providers',
  'settings-mcp': 'settings-tab-mcp',
  'settings-acp': 'settings-tab-acp-agents'
}

const getSettingsTabTestId = (routeName: string) =>
  SETTINGS_TAB_TEST_IDS[routeName] ?? `settings-tab-${routeName.replace(/^settings-/, '')}`

const isExpectedSettingsHash = (actualHash: string, expectedPath: string) => {
  if (actualHash === `#${expectedPath}`) {
    return true
  }

  return expectedPath === '/provider' && actualHash.startsWith('#/provider/')
}

test('设置页所有 tab 导航 @smoke', async ({ app }, testInfo) => {
  await waitForAppReady(app.page)

  const settingsPage = await openSettings(app)
  const pageErrors: string[] = []
  settingsPage.on('pageerror', (error) => {
    pageErrors.push(error.message)
  })

  for (const item of SETTINGS_NAVIGATION_ITEMS) {
    await test.step(`打开 ${item.routeName}`, async () => {
      const tabTestId = getSettingsTabTestId(item.routeName)
      await openSettingsTab(settingsPage, tabTestId)
      await expect(settingsPage.getByTestId(tabTestId)).toHaveClass(/bg-accent/)
      const expectedPath = resolveSettingsNavigationPath(item.routeName)
      await expect
        .poll(() => isExpectedSettingsHash(new URL(settingsPage.url()).hash, expectedPath))
        .toBe(true)
    })
  }

  expect(pageErrors).toEqual([])

  await settingsPage.screenshot({
    path: testInfo.outputPath('settings-navigation.png'),
    fullPage: true
  })
})

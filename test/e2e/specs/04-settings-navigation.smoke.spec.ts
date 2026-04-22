import { test, expect } from '../fixtures/electronApp'
import { openSettings, openSettingsTab } from '../helpers/settings'
import { waitForAppReady } from '../helpers/wait'

test('设置页导航 @smoke', async ({ app }, testInfo) => {
  await waitForAppReady(app.page)

  const settingsPage = await openSettings(app)

  await openSettingsTab(settingsPage, 'settings-tab-general')
  await expect(settingsPage.getByTestId('settings-general-page')).toBeVisible()

  await openSettingsTab(settingsPage, 'settings-tab-model-providers')
  await expect(settingsPage.getByTestId('settings-provider-page')).toBeVisible()

  await openSettingsTab(settingsPage, 'settings-tab-appearance')
  await expect(settingsPage.getByTestId('settings-appearance-page')).toBeVisible()

  await openSettingsTab(settingsPage, 'settings-tab-mcp')
  await expect(settingsPage.getByTestId('settings-mcp-page')).toBeVisible()

  await openSettingsTab(settingsPage, 'settings-tab-acp-agents')
  await expect(settingsPage.getByTestId('settings-acp-page')).toBeVisible()

  await settingsPage.screenshot({
    path: testInfo.outputPath('settings-navigation.png'),
    fullPage: true
  })
})

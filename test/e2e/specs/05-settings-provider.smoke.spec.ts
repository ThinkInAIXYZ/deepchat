import { test, expect } from '../fixtures/electronApp'
import {
  openSettings,
  openSettingsTab,
  selectProvider,
  verifyProviderConnection
} from '../helpers/settings'
import { E2E_TARGET_MODEL_ID, E2E_TARGET_PROVIDER_ID } from '../helpers/testData'
import { waitForAppReady } from '../helpers/wait'

test('服务商连通性检查 @smoke', async ({ app }) => {
  test.skip(
    process.env.RUN_PROVIDER_INTEGRATION !== 'true',
    'Set RUN_PROVIDER_INTEGRATION=true to run the live provider connectivity smoke check.'
  )

  await waitForAppReady(app.page)

  const settingsPage = await openSettings(app)
  await openSettingsTab(settingsPage, 'settings-tab-model-providers')
  await expect(settingsPage.getByTestId('settings-provider-page')).toBeVisible()

  await selectProvider(settingsPage, E2E_TARGET_PROVIDER_ID)
  await verifyProviderConnection(settingsPage, E2E_TARGET_MODEL_ID)
})

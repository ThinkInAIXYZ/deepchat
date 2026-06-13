import { test, expect } from '../fixtures/electronApp'
import { openSettings } from '../helpers/settings'
import { waitForAppReady } from '../helpers/wait'

test('settings consumes pending provider install preview without applying it @smoke', async ({
  app
}) => {
  await waitForAppReady(app.page)

  const preview = {
    kind: 'custom',
    name: 'DeepChat E2E Provider Preview',
    type: 'openai-compatible',
    baseUrl: 'https://e2e-provider.example.com/v1',
    apiKey: 'sk-e2e-provider-preview-1234567',
    maskedApiKey: 'sk-e...4567',
    iconModelId: 'openai'
  }

  await expect
    .poll(
      async () =>
        await app.page.evaluate(async (preview) => {
          const result = (await window.deepchat.invoke(
            'window.requeuePendingSettingsProviderInstall',
            {
              preview
            }
          )) as {
            queued?: unknown
          }

          return result.queued
        }, preview),
      {
        timeout: 30_000,
        intervals: [500, 1_000]
      }
    )
    .toBe(true)

  const settingsPage = await openSettings(app)

  await expect(settingsPage.getByTestId('settings-provider-page')).toBeVisible({
    timeout: 30_000
  })
  await expect(settingsPage.getByText(preview.name)).toBeVisible({ timeout: 30_000 })
  await expect(settingsPage.getByText(preview.baseUrl)).toBeVisible({ timeout: 30_000 })
  await expect(settingsPage.getByText(preview.maskedApiKey)).toBeVisible({ timeout: 30_000 })

  const pendingAfterDialogOpened = await settingsPage.evaluate(async () => {
    const result = (await window.deepchat.invoke(
      'window.consumePendingSettingsProviderInstall',
      {}
    )) as {
      preview?: unknown
    }

    return result.preview
  })

  expect(pendingAfterDialogOpened).toBeNull()
})

import { test, expect } from '../fixtures/electronApp'
import type { Page } from '@playwright/test'
import { openSettings, openSettingsTab } from '../helpers/settings'
import { waitForAppReady } from '../helpers/wait'

const readPrivacyMode = async (page: Page) => {
  return await page.evaluate(async () => {
    const result = (await window.deepchat.invoke('settings.getSnapshot', {
      keys: ['privacyModeEnabled']
    })) as {
      values?: {
        privacyModeEnabled?: unknown
      }
    }

    return result.values?.privacyModeEnabled === true
  })
}

const writePrivacyMode = async (page: Page, value: boolean) => {
  await page.evaluate(async (nextValue) => {
    await window.deepchat.invoke('settings.update', {
      changes: [
        {
          key: 'privacyModeEnabled',
          value: nextValue
        }
      ]
    })
  }, value)
}

test('data settings privacy mode uses typed settings route and restores state @smoke', async ({
  app
}) => {
  await waitForAppReady(app.page)

  const settingsPage = await openSettings(app)
  const originalValue = await readPrivacyMode(settingsPage)
  const targetValue = !originalValue

  try {
    await openSettingsTab(settingsPage, 'settings-tab-database')
    await expect(settingsPage.getByTestId('settings-data-page')).toBeVisible({ timeout: 30_000 })

    const privacySwitch = settingsPage.getByTestId('privacy-mode-switch')
    await expect(privacySwitch).toBeVisible({ timeout: 30_000 })
    await expect(privacySwitch).toHaveAttribute('aria-checked', String(originalValue))

    await privacySwitch.click()
    await expect(privacySwitch).toHaveAttribute('aria-checked', String(targetValue), {
      timeout: 10_000
    })

    await expect
      .poll(() => readPrivacyMode(settingsPage), {
        timeout: 10_000,
        intervals: [250, 500, 1_000]
      })
      .toBe(targetValue)
  } finally {
    await writePrivacyMode(settingsPage, originalValue)
    await expect
      .poll(() => readPrivacyMode(settingsPage), {
        timeout: 10_000,
        intervals: [250, 500, 1_000]
      })
      .toBe(originalValue)
  }
})

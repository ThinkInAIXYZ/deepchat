import { test, expect } from '../fixtures/electronApp'
import type { Page } from '@playwright/test'
import { openSettings, openSettingsTab } from '../helpers/settings'
import { waitForAppReady } from '../helpers/wait'

type NowledgeMemConfig = {
  apiKey?: string
  baseUrl: string
  timeout: number
}

const E2E_API_KEY = 'e2e-nowledge-mem-key'

const normalizeConfig = (config: NowledgeMemConfig): Required<NowledgeMemConfig> => ({
  apiKey: config.apiKey ?? '',
  baseUrl: config.baseUrl,
  timeout: config.timeout
})

const readNowledgeMemConfig = async (page: Page): Promise<NowledgeMemConfig> => {
  const result = (await page.evaluate(async () => {
    return window.deepchat.invoke('nowledgeMem.getConfig', {})
  })) as { config: NowledgeMemConfig }

  return result.config
}

const updateNowledgeMemConfig = async (
  page: Page,
  config: NowledgeMemConfig
): Promise<NowledgeMemConfig> => {
  const result = (await page.evaluate(async (nextConfig) => {
    return window.deepchat.invoke('nowledgeMem.updateConfig', { config: nextConfig })
  }, config)) as { config: NowledgeMemConfig }

  return result.config
}

test('nowledge mem settings saves config through typed routes @smoke', async ({ app }) => {
  await waitForAppReady(app.page)

  const settingsPage = await openSettings(app)
  await openSettingsTab(settingsPage, 'settings-tab-knowledge-base')
  await expect(settingsPage.getByTestId('settings-knowledge-base-page')).toBeVisible({
    timeout: 30_000
  })

  const originalConfig = normalizeConfig(await readNowledgeMemConfig(settingsPage))
  const restoreConfig: Required<NowledgeMemConfig> = {
    ...originalConfig,
    apiKey: originalConfig.apiKey === E2E_API_KEY ? '' : originalConfig.apiKey
  }
  const e2eConfig: Required<NowledgeMemConfig> = {
    ...restoreConfig,
    apiKey: E2E_API_KEY,
    baseUrl: `http://127.0.0.1:14242/e2e-${Date.now()}`
  }

  try {
    await settingsPage.getByTestId('nowledge-mem-panel-toggle').click()

    const baseUrlInput = settingsPage.getByTestId('nowledge-mem-base-url-input')
    const apiKeyInput = settingsPage.getByTestId('nowledge-mem-api-key-input')

    await expect(baseUrlInput).toBeVisible({ timeout: 30_000 })
    await expect(apiKeyInput).toBeVisible({ timeout: 30_000 })

    await baseUrlInput.fill(e2eConfig.baseUrl)
    await apiKeyInput.fill(e2eConfig.apiKey ?? '')
    await settingsPage.getByTestId('nowledge-mem-save-button').click()

    await expect
      .poll(
        async () => {
          const savedConfig = await readNowledgeMemConfig(settingsPage)
          return normalizeConfig(savedConfig)
        },
        {
          timeout: 30_000,
          intervals: [250, 500, 1_000]
        }
      )
      .toEqual(e2eConfig)
  } finally {
    await updateNowledgeMemConfig(settingsPage, restoreConfig)
  }

  await expect
    .poll(
      async () => {
        const restoredConfig = await readNowledgeMemConfig(settingsPage)
        return normalizeConfig(restoredConfig)
      },
      {
        timeout: 30_000,
        intervals: [250, 500, 1_000]
      }
    )
    .toEqual(restoreConfig)
})

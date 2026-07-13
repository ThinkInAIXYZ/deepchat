import { test, expect } from '../fixtures/electronApp'
import { openSettings, openSettingsTab } from '../helpers/settings'
import { waitForAppReady } from '../helpers/wait'

test('provider settings read-only routes expose provider and model snapshots @smoke', async ({
  app
}) => {
  await waitForAppReady(app.page)

  const settingsPage = await openSettings(app)
  await openSettingsTab(settingsPage, 'settings-tab-model-providers')
  await expect(settingsPage.getByTestId('settings-provider-page')).toBeVisible({
    timeout: 30_000
  })
  await expect
    .poll(async () => await settingsPage.locator('[data-provider-id]').count(), {
      timeout: 30_000,
      intervals: [500, 1_000, 2_000]
    })
    .toBeGreaterThan(0)

  const snapshot = await settingsPage.evaluate(async () => {
    type ProviderSummary = {
      id?: unknown
      name?: unknown
      apiType?: unknown
      apiKey?: unknown
      enable?: unknown
      rateLimit?: {
        enabled?: unknown
        qpsLimit?: unknown
      }
    }

    type ProviderModel = {
      id?: unknown
      providerId?: unknown
      enabled?: unknown
    }

    const listed = (await window.deepchat.invoke('providers.listSummaries', {})) as {
      providers?: ProviderSummary[]
    }
    const defaults = (await window.deepchat.invoke('providers.listDefaults', {})) as {
      providers?: ProviderSummary[]
    }
    const providerRows = Array.from(document.querySelectorAll('[data-provider-id]'))
      .map((element) => element.getAttribute('data-provider-id'))
      .filter((providerId): providerId is string => Boolean(providerId))

    const providers = Array.isArray(listed.providers) ? listed.providers : []
    const defaultProviders = Array.isArray(defaults.providers) ? defaults.providers : []
    const selectedProvider =
      providers.find(
        (provider) => typeof provider.id === 'string' && providerRows.includes(provider.id)
      ) ??
      providers.find((provider) => typeof provider.id === 'string' && provider.id !== 'acp') ??
      providers.find((provider) => typeof provider.id === 'string')
    const selectedProviderId =
      typeof selectedProvider?.id === 'string' ? selectedProvider.id : undefined

    let models: {
      customModelCount: number
      providerModelCount: number
      customModelProviderIdsValid: boolean
      providerModelProviderIdsValid: boolean
    } | null = null
    let rateLimit: {
      configEnabledType: string
      configQpsType: string
      currentQpsType: string
      queueLengthType: string
      lastRequestTimeType: string
    } | null = null

    if (selectedProviderId) {
      const modelSnapshot = (await window.deepchat.invoke('providers.listModels', {
        providerId: selectedProviderId
      })) as {
        providerModels?: ProviderModel[]
        customModels?: ProviderModel[]
      }
      const providerModels = Array.isArray(modelSnapshot.providerModels)
        ? modelSnapshot.providerModels
        : []
      const customModels = Array.isArray(modelSnapshot.customModels)
        ? modelSnapshot.customModels
        : []

      models = {
        customModelCount: customModels.length,
        providerModelCount: providerModels.length,
        customModelProviderIdsValid: customModels.every(
          (model) => typeof model.providerId === 'string'
        ),
        providerModelProviderIdsValid: providerModels.every(
          (model) => typeof model.providerId === 'string'
        )
      }

      const rateLimitSnapshot = (await window.deepchat.invoke('providers.getRateLimitStatus', {
        providerId: selectedProviderId
      })) as {
        status?: {
          config?: {
            enabled?: unknown
            qpsLimit?: unknown
          }
          currentQps?: unknown
          queueLength?: unknown
          lastRequestTime?: unknown
        }
      }

      rateLimit = {
        configEnabledType: typeof rateLimitSnapshot.status?.config?.enabled,
        configQpsType: typeof rateLimitSnapshot.status?.config?.qpsLimit,
        currentQpsType: typeof rateLimitSnapshot.status?.currentQps,
        queueLengthType: typeof rateLimitSnapshot.status?.queueLength,
        lastRequestTimeType: typeof rateLimitSnapshot.status?.lastRequestTime
      }
    }

    return {
      defaultProviderCount: defaultProviders.length,
      providerCount: providers.length,
      providerRowsCount: providerRows.length,
      selectedProviderId,
      selectedProviderVisible: selectedProviderId
        ? providerRows.includes(selectedProviderId)
        : false,
      summaries: providers.slice(0, 8).map((provider) => ({
        apiTypeType: typeof provider.apiType,
        enableType: typeof provider.enable,
        hasApiKey: typeof provider.apiKey === 'string' && provider.apiKey.length > 0,
        id: provider.id,
        nameType: typeof provider.name,
        rateLimitEnabledType: typeof provider.rateLimit?.enabled,
        rateLimitQpsType: typeof provider.rateLimit?.qpsLimit
      })),
      models,
      rateLimit
    }
  })

  expect(snapshot.providerCount).toBeGreaterThan(0)
  expect(snapshot.defaultProviderCount).toBeGreaterThan(0)
  expect(snapshot.providerRowsCount).toBeGreaterThan(0)
  expect(typeof snapshot.selectedProviderId).toBe('string')
  expect(snapshot.selectedProviderVisible).toBe(true)

  for (const provider of snapshot.summaries) {
    expect(typeof provider.id).toBe('string')
    expect(provider.apiTypeType).toBe('string')
    expect(provider.enableType).toBe('boolean')
    expect(provider.nameType).toBe('string')
    expect(
      provider.rateLimitEnabledType === 'boolean' || provider.rateLimitEnabledType === 'undefined'
    ).toBe(true)
    expect(
      provider.rateLimitQpsType === 'number' || provider.rateLimitQpsType === 'undefined'
    ).toBe(true)
  }

  expect(snapshot.models).toBeTruthy()
  expect(snapshot.models?.providerModelCount).toBeGreaterThanOrEqual(0)
  expect(snapshot.models?.customModelCount).toBeGreaterThanOrEqual(0)
  expect(snapshot.models?.providerModelProviderIdsValid).toBe(true)
  expect(snapshot.models?.customModelProviderIdsValid).toBe(true)

  expect(snapshot.rateLimit).toBeTruthy()
  expect(snapshot.rateLimit?.configEnabledType).toBe('boolean')
  expect(snapshot.rateLimit?.configQpsType).toBe('number')
  expect(snapshot.rateLimit?.currentQpsType).toBe('number')
  expect(snapshot.rateLimit?.queueLengthType).toBe('number')
  expect(snapshot.rateLimit?.lastRequestTimeType).toBe('number')
})

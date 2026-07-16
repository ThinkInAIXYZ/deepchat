import { describe, expect, it, vi } from 'vitest'
import { createProviderRoutes } from '@/provider/routes'
import {
  modelsGetProviderCatalogRoute,
  providersImportApplyRoute,
  providersImportScanRoute,
  providersListSummariesRoute,
  providersUpdateRoute
} from '@shared/contracts/routes'
import { ModelType } from '@shared/model'

const context = { webContentsId: 42, windowId: 7 }

function createRoutes(deps: {
  providerSettings: Record<string, unknown>
  providerRuntime?: Record<string, unknown>
  providerImportService?: Record<string, unknown>
}) {
  return createProviderRoutes({
    providerSettings: deps.providerSettings as any,
    providerRuntime: (deps.providerRuntime ?? {}) as any,
    acpProviderAdminPort: {} as any,
    providerImportService: (deps.providerImportService ?? {}) as any,
    scheduler: {
      timeout: async <T>({ task }: { task: Promise<T> }) => await task
    },
    recordSettingsActivity: vi.fn(async () => undefined)
  })
}

describe('Provider routes', () => {
  it('applies provider updates through the runtime owner', async () => {
    const provider = {
      id: 'openai',
      name: 'OpenAI',
      apiType: 'openai',
      apiKey: '',
      baseUrl: '',
      enable: true
    }
    const providerSettings = {
      getProviderById: vi.fn(() => ({ ...provider, enable: false }))
    }
    const providerRuntime = {
      updateProviderAtomic: vi.fn(() => true)
    }
    const routes = createRoutes({ providerSettings, providerRuntime })

    const result = await routes.get(providersUpdateRoute.name)?.(
      { providerId: 'openai', updates: { enable: false } },
      context
    )

    expect(providerRuntime.updateProviderAtomic).toHaveBeenCalledWith('openai', { enable: false })
    expect(result).toMatchObject({
      provider: { id: 'openai', enable: false },
      requiresRebuild: true
    })
  })

  it('returns lightweight provider summaries without model arrays', async () => {
    const routes = createRoutes({
      providerSettings: {
        getProviders: vi.fn(() => [
          {
            id: 'openai',
            name: 'OpenAI',
            apiType: 'openai',
            apiKey: 'sk-test',
            baseUrl: 'https://api.openai.com/v1',
            enable: true,
            models: [{ id: 'gpt-5.4', name: 'GPT-5.4', group: 'default' }],
            customModels: [{ id: 'custom', name: 'Custom', group: 'custom' }],
            enabledModels: ['gpt-5.4'],
            disabledModels: ['custom']
          }
        ])
      }
    })

    const result = (await routes.get(providersListSummariesRoute.name)?.({}, context)) as {
      providers: Array<Record<string, unknown>>
    }

    expect(result.providers).toEqual([
      expect.objectContaining({
        id: 'openai',
        name: 'OpenAI',
        apiType: 'openai',
        apiKey: 'sk-test',
        baseUrl: 'https://api.openai.com/v1',
        enable: true
      })
    ])
    expect(result.providers[0]).not.toHaveProperty('models')
    expect(result.providers[0]).not.toHaveProperty('customModels')
    expect(result.providers[0]).not.toHaveProperty('enabledModels')
    expect(result.providers[0]).not.toHaveProperty('disabledModels')
  })

  it('dispatches provider import scan and apply through ProviderImportService', async () => {
    const providerImportService = {
      scan: vi.fn(() => ({
        sessionId: 'scan-1',
        sourceOrder: ['cc-switch', 'alma', 'cherry-studio', 'hermes', 'openclaw'],
        sources: [],
        providers: []
      })),
      apply: vi.fn(() => ({
        summary: {
          imported: 0,
          created: 0,
          updated: 0,
          skipped: 0,
          overwritten: 0,
          models: 0
        },
        results: []
      }))
    }
    const routes = createRoutes({ providerSettings: {}, providerImportService })
    const applyInput = {
      sessionId: 'scan-1',
      selections: [
        {
          sourceId: 'hermes',
          providerIds: ['hermes:openai'],
          providerOptions: {
            'hermes:openai': { targetApiType: 'anthropic' }
          }
        }
      ]
    }

    const scanResult = await routes.get(providersImportScanRoute.name)?.({}, context)
    const applyResult = await routes.get(providersImportApplyRoute.name)?.(applyInput, context)

    expect(scanResult).toMatchObject({ sessionId: 'scan-1' })
    expect(applyResult).toMatchObject({ summary: { imported: 0 } })
    expect(providerImportService.scan).toHaveBeenCalledTimes(1)
    expect(providerImportService.apply).toHaveBeenCalledWith(applyInput)
  })

  it('includes Provider DB-only models when resolving persisted model status', async () => {
    const providerSettings = {
      getProviderModels: vi.fn(() => [
        { id: 'gpt-5', name: 'GPT-5', group: 'default', providerId: 'aihubmix' }
      ]),
      getCustomModels: vi.fn(() => [
        {
          id: 'custom-chat',
          name: 'Custom Chat',
          group: 'custom',
          providerId: 'aihubmix',
          isCustom: true
        }
      ]),
      getDbProviderModels: vi.fn(() => [
        {
          id: 'text-embedding-3-small',
          name: 'text-embedding-3-small',
          group: 'default',
          providerId: 'aihubmix',
          enabled: false,
          isCustom: false,
          type: ModelType.Embedding
        },
        {
          id: 'gpt-5',
          name: 'GPT-5',
          group: 'default',
          providerId: 'aihubmix',
          enabled: false,
          isCustom: false,
          type: ModelType.Chat
        }
      ]),
      getBatchModelStatus: vi.fn((_providerId: string, modelIds: string[]) =>
        Object.fromEntries(modelIds.map((modelId) => [modelId, modelId.includes('embedding')]))
      )
    }
    const routes = createRoutes({ providerSettings })

    const result = (await routes.get(modelsGetProviderCatalogRoute.name)?.(
      { providerId: 'aihubmix' },
      context
    )) as { catalog: { modelStatusMap: Record<string, boolean> } }

    expect(providerSettings.getBatchModelStatus).toHaveBeenCalledWith('aihubmix', [
      'gpt-5',
      'custom-chat',
      'text-embedding-3-small'
    ])
    expect(result.catalog.modelStatusMap['text-embedding-3-small']).toBe(true)
  })
})

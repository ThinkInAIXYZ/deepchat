import { describe, expect, it, vi } from 'vitest'
import { createRendererRouteContext } from '@/routes/routeRegistry'
import { createProviderRoutes } from '@/provider/routes'
import {
  modelsGetCapabilitiesRoute,
  modelsGetProviderCatalogRoute,
  modelsListRuntimeRoute,
  modelsSetStatusRoute,
  providersImportApplyRoute,
  providersImportScanRoute,
  providersListSummariesRoute,
  providersRemoveRoute,
  providersUpdateRoute
} from '@shared/contracts/routes'
import { JsonValueSchema } from '@shared/contracts/json'
import { ModelType } from '@shared/model'

const context = createRendererRouteContext(42, 7)

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
  it('prevents CLI removal of built-in providers', async () => {
    const removeProviderAtomic = vi.fn()
    const routes = createRoutes({
      providerSettings: {
        getProviderById: vi.fn(() => ({ id: 'openai', custom: false }))
      },
      providerRuntime: { removeProviderAtomic }
    })

    await expect(
      routes.get(providersRemoveRoute.name)?.(
        { providerId: 'openai' },
        {
          caller: {
            kind: 'cli',
            principal: 'human',
            connectionId: 'connection-1',
            scopes: ['providers:write']
          }
        }
      )
    ).rejects.toMatchObject({ code: 'conflict' })
    expect(removeProviderAtomic).not.toHaveBeenCalled()
  })

  it('prevents CLI status records for unknown models', async () => {
    const updateModelStatus = vi.fn()
    const routes = createRoutes({
      providerSettings: { isKnownModel: vi.fn(() => false) },
      providerRuntime: { updateModelStatus }
    })

    await expect(
      routes.get(modelsSetStatusRoute.name)?.(
        { providerId: 'provider-1', modelId: 'unknown-model', enabled: true },
        {
          caller: {
            kind: 'cli',
            principal: 'human',
            connectionId: 'connection-1',
            scopes: ['providers:write']
          }
        }
      )
    ).rejects.toMatchObject({ code: 'not_found' })
    expect(updateModelStatus).not.toHaveBeenCalled()
  })

  it('returns JSON-safe runtime models across providers', async () => {
    const getModelList = vi.fn(async (providerId: string) => {
      if (providerId === 'empty-provider') return []
      if (providerId === 'custom-provider') {
        return [
          {
            id: 'custom-model',
            name: 'Custom model',
            group: 'custom',
            providerId,
            enabled: false,
            isCustom: true,
            vision: false,
            functionCall: true,
            reasoning: false,
            enableSearch: true,
            type: ModelType.Chat,
            contextLength: 128_000,
            maxTokens: 16_384,
            description: 'User-defined model',
            supportedEndpointTypes: ['openai-response', 'anthropic'],
            selectableEndpointTypes: ['openai-response'],
            endpointType: 'openai-response',
            ownedBy: 'model-owner',
            internalCredential: 'must-not-leak'
          }
        ]
      }
      return [
        {
          id: 'builtin-model',
          name: 'Built-in model',
          group: 'default',
          providerId,
          enabled: undefined,
          isCustom: undefined,
          vision: undefined,
          functionCall: undefined,
          reasoning: undefined,
          enableSearch: undefined,
          contextLength: undefined,
          maxTokens: undefined,
          description: undefined
        }
      ]
    })
    const routes = createRoutes({ providerSettings: {}, providerRuntime: { getModelList } })
    const invoke = async (providerId: string) =>
      await routes.get(modelsListRuntimeRoute.name)?.({ providerId }, context)

    const builtinResult = await invoke('builtin-provider')
    const customResult = await invoke('custom-provider')
    const emptyResult = await invoke('empty-provider')

    expect(builtinResult).toEqual({
      models: [
        {
          id: 'builtin-model',
          name: 'Built-in model',
          group: 'default',
          providerId: 'builtin-provider'
        }
      ]
    })
    expect(customResult).toEqual({
      models: [
        {
          id: 'custom-model',
          name: 'Custom model',
          group: 'custom',
          providerId: 'custom-provider',
          enabled: false,
          isCustom: true,
          vision: false,
          functionCall: true,
          reasoning: false,
          enableSearch: true,
          type: ModelType.Chat,
          contextLength: 128_000,
          maxTokens: 16_384,
          description: 'User-defined model',
          supportedEndpointTypes: ['openai-response', 'anthropic'],
          selectableEndpointTypes: ['openai-response'],
          endpointType: 'openai-response',
          ownedBy: 'model-owner'
        }
      ]
    })
    expect(emptyResult).toEqual({ models: [] })
    for (const result of [builtinResult, customResult, emptyResult]) {
      expect(JsonValueSchema.safeParse(result).success).toBe(true)
      expect(JSON.stringify(result)).not.toContain('must-not-leak')
    }
  })

  it('returns one authoritative capability snapshot and forwards draft route metadata', async () => {
    const snapshot = {
      identity: {
        providerId: 'anthropic',
        requestModelId: 'claude-opus-4-8',
        catalogMatched: true,
        catalogModelId: 'claude-opus-4-8'
      },
      requestPolicy: {
        temperature: { mode: 'passthrough' },
        topP: { mode: 'passthrough' },
        reasoning: { mode: 'passthrough' },
        legacyThinking: { mode: 'passthrough' }
      },
      supportsAudioInput: false,
      supportsReasoning: true,
      reasoningPortrait: {
        supported: true,
        defaultEnabled: false,
        mode: 'effort'
      },
      thinkingBudgetRange: {},
      supportsSearch: false,
      searchDefaults: {},
      temperatureCapability: false,
      supportsTemperatureControl: false,
      supportsReasoningEffort: true,
      reasoningEffortDefault: 'high',
      supportsVerbosity: false,
      verbosityDefault: undefined
    } as const
    const getCapabilitySnapshot = vi.fn(() => snapshot)
    const routes = createRoutes({
      providerSettings: {
        getCapabilitySnapshot
      }
    })
    const routeOverride = {
      endpointType: 'anthropic' as const,
      supportedEndpointTypes: ['openai-response', 'anthropic'] as const,
      type: ModelType.Chat,
      ownedBy: 'anthropic'
    }

    const result = await routes.get(modelsGetCapabilitiesRoute.name)?.(
      {
        providerId: 'new-api',
        modelId: 'claude-opus-4-8',
        routeOverride,
        reasoningEnabled: false
      },
      context
    )

    expect(getCapabilitySnapshot).toHaveBeenCalledTimes(1)
    expect(getCapabilitySnapshot).toHaveBeenCalledWith({
      providerId: 'new-api',
      modelId: 'claude-opus-4-8',
      routeOverride,
      reasoningEnabled: false
    })
    expect(result).toEqual({
      capabilities: {
        ...snapshot,
        temperatureCapability: false
      }
    })
  })

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

  it('rejects invalid custom headers before updating the runtime', async () => {
    const updateProviderAtomic = vi.fn()
    const routes = createRoutes({
      providerSettings: {},
      providerRuntime: { updateProviderAtomic }
    })

    await expect(
      routes.get(providersUpdateRoute.name)?.(
        {
          providerId: 'openai',
          updates: { customHeaders: { Authorization: 'Bearer unsafe' } }
        },
        context
      )
    ).rejects.toThrow('Invalid custom request headers: reserved_name')
    expect(updateProviderAtomic).not.toHaveBeenCalled()
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
            customHeaders: { 'X-Tenant-ID': 'team-a' },
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
        customHeaders: { 'X-Tenant-ID': 'team-a' },
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

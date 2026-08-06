import { describe, expect, it, vi } from 'vitest'
import {
  modelsGetPublicConfigRoute,
  modelsSetPublicConfigRoute,
  providersAddPublicRoute,
  providersSetCredentialRoute,
  providersTestPublicConnectionRoute,
  providersUpdatePublicRoute
} from '@shared/contracts/routes'
import type { LLM_PROVIDER, ModelConfig } from '@shared/types/provider'
import { createCliProviderModelAdminRoutes } from '@/cli/providerModelAdminRoutes'
import type { CliRouteCaller, RouteContext } from '@/routes/routeRegistry'

const caller: CliRouteCaller = {
  kind: 'cli',
  principal: 'human',
  connectionId: 'connection-1',
  scopes: ['providers:write', 'providers:credential']
}

function createHarness(initialProviders: LLM_PROVIDER[] = []) {
  const providers = new Map(initialProviders.map((provider) => [provider.id, provider]))
  const defaultModelConfig: ModelConfig = {
    maxTokens: 4096,
    contextLength: 32768,
    vision: false,
    functionCall: true,
    reasoning: true,
    type: 'chat' as ModelConfig['type']
  }
  const modelConfigs = new Map<string, ModelConfig>()
  const setModelConfig = vi.fn((modelId: string, providerId: string, config: ModelConfig) => {
    modelConfigs.set(`${providerId}:${modelId}`, config)
  })
  const addProviderAtomic = vi.fn((provider: LLM_PROVIDER) => providers.set(provider.id, provider))
  const updateProviderAtomic = vi.fn((providerId: string, updates: Partial<LLM_PROVIDER>) => {
    const provider = providers.get(providerId)
    if (!provider) return false
    providers.set(providerId, { ...provider, ...updates })
    return 'apiType' in updates || 'baseUrl' in updates
  })
  const check = vi.fn(async () => ({
    isOk: false,
    errorMsg: 'Request failed with Authorization: Bearer super-secret'
  }))
  const recordSettingsActivity = vi.fn()
  const log = { warn: vi.fn() }
  const routes = createCliProviderModelAdminRoutes({
    providerSettings: {
      getProviderById: (providerId) => providers.get(providerId),
      getModelConfig: (modelId, providerId) =>
        modelConfigs.get(`${providerId}:${modelId}`) ?? defaultModelConfig,
      isKnownModel: (_providerId, modelId) => modelId === 'model-1',
      setModelConfig
    },
    providerRuntime: { addProviderAtomic, check, updateProviderAtomic },
    scheduler: {
      timeout: async <T>({ task }: { task: Promise<T> }) => await task
    },
    recordSettingsActivity,
    createProviderId: () => 'provider-generated',
    log
  })
  const invoke = async (method: string, input: unknown, context: RouteContext = { caller }) => {
    const route = routes.get(method as never)
    if (!route) throw new Error(`Missing route: ${method}`)
    return await route(input, context)
  }
  return {
    providers,
    addProviderAtomic,
    check,
    updateProviderAtomic,
    setModelConfig,
    recordSettingsActivity,
    modelConfigs,
    log,
    invoke
  }
}

describe('CLI provider administration routes', () => {
  it('adds only a credential-free custom provider and returns a redacted summary', async () => {
    const harness = createHarness()

    await expect(
      harness.invoke(providersAddPublicRoute.name, {
        name: 'Private endpoint',
        apiType: 'openai-completions',
        baseUrl: 'https://models.example/v1',
        enabled: true
      })
    ).resolves.toEqual({
      provider: {
        id: 'provider-generated',
        name: 'Private endpoint',
        apiType: 'openai-completions',
        enabled: true,
        custom: true,
        storedCredentialConfigured: false
      }
    })
    expect(harness.addProviderAtomic).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'provider-generated',
        apiKey: '',
        custom: true
      })
    )
  })

  it('updates only allowlisted fields and protects built-in provider identity', async () => {
    const custom: LLM_PROVIDER = {
      id: 'custom-1',
      name: 'Custom',
      apiType: 'openai',
      apiKey: 'secret',
      baseUrl: 'https://old.example/v1',
      enable: true,
      custom: true
    }
    const builtin: LLM_PROVIDER = { ...custom, id: 'builtin-1', custom: false }
    const harness = createHarness([custom, builtin])

    await expect(
      harness.invoke(providersUpdatePublicRoute.name, {
        providerId: custom.id,
        updates: { apiType: 'anthropic', enabled: false }
      })
    ).resolves.toMatchObject({
      provider: {
        id: custom.id,
        apiType: 'anthropic',
        enabled: false,
        storedCredentialConfigured: true
      },
      requiresRebuild: true
    })
    expect(harness.providers.get(custom.id)?.apiKey).toBe('secret')

    await expect(
      harness.invoke(providersUpdatePublicRoute.name, {
        providerId: builtin.id,
        updates: { apiType: 'gemini' }
      })
    ).rejects.toMatchObject({ code: 'conflict' })
  })

  it('sets and clears API keys without returning credential material', async () => {
    const provider: LLM_PROVIDER = {
      id: 'provider-1',
      name: 'Provider',
      apiType: 'openai',
      apiKey: '',
      baseUrl: 'https://api.example/v1',
      enable: true,
      custom: true
    }
    const harness = createHarness([provider])

    const setResult = await harness.invoke(providersSetCredentialRoute.name, {
      providerId: provider.id,
      action: 'set',
      kind: 'api-key',
      value: 'super-secret '
    })
    expect(setResult).toEqual({
      providerId: provider.id,
      action: 'set',
      kind: 'api-key',
      storedApiKeyConfigured: true
    })
    expect(JSON.stringify(setResult)).not.toContain('super-secret')
    expect(harness.providers.get(provider.id)?.apiKey).toBe('super-secret ')

    await expect(
      harness.invoke(providersSetCredentialRoute.name, {
        providerId: provider.id,
        action: 'clear',
        kind: 'api-key'
      })
    ).resolves.toMatchObject({ action: 'clear', storedApiKeyConfigured: false })
    expect(harness.providers.get(provider.id)?.apiKey).toBe('')
  })

  it('redacts provider implementation errors from public connection tests', async () => {
    const provider: LLM_PROVIDER = {
      id: 'provider-1',
      name: 'Provider',
      apiType: 'openai',
      apiKey: 'super-secret',
      baseUrl: 'https://api.example/v1',
      enable: true,
      custom: true
    }
    const harness = createHarness([provider])

    const result = await harness.invoke(providersTestPublicConnectionRoute.name, {
      providerId: provider.id
    })
    expect(result).toEqual({ isOk: false, errorMsg: 'Provider connection failed' })
    expect(JSON.stringify(result)).not.toContain('super-secret')
  })

  it('rejects renderer callers and URLs that can hide credential material', async () => {
    const harness = createHarness()

    await expect(
      harness.invoke(
        providersAddPublicRoute.name,
        {
          name: 'Provider',
          apiType: 'openai',
          baseUrl: 'https://api.example/v1'
        },
        { caller: { kind: 'renderer', webContentsId: 1, windowId: 1 } }
      )
    ).rejects.toMatchObject({ code: 'permission_denied' })
    expect(
      providersAddPublicRoute.input.safeParse({
        name: 'Provider',
        apiType: 'openai',
        baseUrl: 'https://user:password@api.example/v1?api_key=secret'
      }).success
    ).toBe(false)
    expect(
      providersSetCredentialRoute.input.safeParse({
        providerId: 'provider-1',
        action: 'set',
        kind: 'api-key',
        value: '密'.repeat(22_000)
      }).success
    ).toBe(false)
  })

  it('returns validation failures for malformed provider URLs', () => {
    const addResult = providersAddPublicRoute.input.safeParse({
      name: 'Provider',
      apiType: 'openai',
      baseUrl: 'not-a-url'
    })
    const updateResult = providersUpdatePublicRoute.input.safeParse({
      providerId: 'provider-1',
      updates: { baseUrl: 'not-a-url' }
    })

    expect(addResult.success).toBe(false)
    expect(updateResult.success).toBe(false)
    expect(
      providersAddPublicRoute.input.safeParse({
        name: 'Local provider',
        apiType: 'openai',
        baseUrl: 'http://localhost:11434'
      }).success
    ).toBe(true)
  })

  it('uses strict public model config input and strips main-owned identity fields', async () => {
    const provider: LLM_PROVIDER = {
      id: 'provider-1',
      name: 'Provider',
      apiType: 'openai',
      apiKey: '',
      baseUrl: 'https://api.example/v1',
      enable: true,
      custom: true
    }
    const harness = createHarness([provider])
    const config = {
      maxTokens: 2048,
      contextLength: 16384,
      vision: false,
      functionCall: false,
      reasoning: false,
      type: 'chat'
    }

    await expect(
      harness.invoke(modelsSetPublicConfigRoute.name, {
        providerId: provider.id,
        modelId: 'model-1',
        config
      })
    ).resolves.toEqual({ config })
    expect(harness.modelConfigs.get(`${provider.id}:model-1`)).toEqual(config)
    expect(
      modelsSetPublicConfigRoute.input.safeParse({
        providerId: provider.id,
        modelId: 'model-1',
        config: { ...config, conversationId: 'private-session', futureSecret: 'secret' }
      }).success
    ).toBe(false)

    harness.modelConfigs.set(`${provider.id}:model-1`, {
      ...config,
      conversationId: 'private-session',
      ownedBy: 'internal-owner'
    } as ModelConfig)
    const result = await harness.invoke(modelsGetPublicConfigRoute.name, {
      providerId: provider.id,
      modelId: 'model-1'
    })
    expect(result).toEqual({ config })
    expect(JSON.stringify(result)).not.toContain('private-session')
  })

  it('normalizes mutation storage failures without exposing their details', async () => {
    const privateFailure = 'EIO /private/provider.json?token=secret'
    const provider: LLM_PROVIDER = {
      id: 'provider-1',
      name: 'Provider',
      apiType: 'openai',
      apiKey: '',
      baseUrl: 'https://api.example/v1',
      enable: true,
      custom: true
    }
    const unavailable = {
      code: 'unavailable',
      httpStatus: 503,
      retriable: true
    }

    const addHarness = createHarness()
    addHarness.addProviderAtomic.mockImplementationOnce(() => {
      throw new Error(privateFailure)
    })
    await expect(
      addHarness.invoke(providersAddPublicRoute.name, {
        name: 'Provider',
        apiType: 'openai',
        baseUrl: 'https://api.example/v1'
      })
    ).rejects.toMatchObject({ ...unavailable, message: 'Could not add provider' })

    const updateHarness = createHarness([provider])
    updateHarness.updateProviderAtomic.mockImplementation(() => {
      throw new Error(privateFailure)
    })
    await expect(
      updateHarness.invoke(providersUpdatePublicRoute.name, {
        providerId: provider.id,
        updates: { name: 'Updated' }
      })
    ).rejects.toMatchObject({ ...unavailable, message: 'Could not update provider' })
    await expect(
      updateHarness.invoke(providersSetCredentialRoute.name, {
        providerId: provider.id,
        action: 'clear',
        kind: 'api-key'
      })
    ).rejects.toMatchObject({
      ...unavailable,
      message: 'Could not update provider credential'
    })

    const modelHarness = createHarness([provider])
    modelHarness.setModelConfig.mockImplementationOnce(() => {
      throw new Error(privateFailure)
    })
    await expect(
      modelHarness.invoke(modelsSetPublicConfigRoute.name, {
        providerId: provider.id,
        modelId: 'model-1',
        config: {
          maxTokens: 2048,
          contextLength: 16384,
          vision: false,
          functionCall: false,
          reasoning: false,
          type: 'chat'
        }
      })
    ).rejects.toMatchObject({
      ...unavailable,
      message: 'Could not update model configuration'
    })

    expect(
      JSON.stringify([
        addHarness.log.warn.mock.calls,
        updateHarness.log.warn.mock.calls,
        modelHarness.log.warn.mock.calls
      ])
    ).not.toContain(privateFailure)
  })
})

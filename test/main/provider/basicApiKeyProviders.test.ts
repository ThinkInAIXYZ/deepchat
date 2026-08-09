import type { ProviderSettingsPort } from '@/provider/settings'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { LLM_PROVIDER } from '@shared/types/provider'
import { AiSdkProvider } from '../../../src/main/provider/providers/aiSdkProvider'
import { resolveAiSdkProviderDefinition } from '../../../src/main/provider/providerRegistry'

const { mockGetProvider, mockRunAiSdkGenerateText } = vi.hoisted(() => ({
  mockGetProvider: vi.fn(),
  mockRunAiSdkGenerateText: vi.fn()
}))

const originalFetch = global.fetch

vi.mock('electron', () => ({
  app: {
    getName: vi.fn(() => 'DeepChat'),
    getVersion: vi.fn(() => '0.0.0-test'),
    getPath: vi.fn(() => '/mock/path'),
    isReady: vi.fn(() => true),
    on: vi.fn()
  }
}))

vi.mock('@shared/logger', () => ({
  default: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    verbose: vi.fn(),
    silly: vi.fn(),
    log: vi.fn()
  }
}))

vi.mock('../../../src/main/platform/proxy', () => ({
  proxyConfig: {
    getProxyUrl: vi.fn().mockReturnValue(null)
  }
}))

vi.mock('../../../src/main/provider/providerDbLoader', () => ({
  providerDbLoader: {
    subscribeCatalogChanges: vi.fn(),
    getDb: vi.fn().mockReturnValue(null),
    getProvider: mockGetProvider,
    getModel: vi.fn()
  }
}))

vi.mock('../../../src/main/provider/aiSdk', () => ({
  runAiSdkCoreStream: vi.fn(),
  runAiSdkDimensions: vi.fn(),
  runAiSdkEmbeddings: vi.fn(),
  runAiSdkGenerateText: mockRunAiSdkGenerateText
}))

const createProvider = (overrides: Partial<LLM_PROVIDER>): LLM_PROVIDER => ({
  id: 'nvidia',
  name: 'NVIDIA',
  apiType: 'openai-completions',
  apiKey: 'test-key',
  baseUrl: 'https://integrate.api.nvidia.com/v1',
  enable: false,
  ...overrides
})

const createProviderSettings = (): ProviderSettingsPort =>
  ({
    getProviderModels: vi.fn().mockReturnValue([]),
    getCustomModels: vi.fn().mockReturnValue([]),
    getModelRouteConfig: vi.fn().mockReturnValue(undefined),
    getModelConfig: vi.fn().mockReturnValue(undefined),
    getSetting: vi.fn().mockReturnValue(undefined),
    setProviderModels: vi.fn(),
    getModelStatus: vi.fn().mockReturnValue(true),
    setModelConfig: vi.fn(),
    hasUserModelConfig: vi.fn().mockReturnValue(false)
  }) as unknown as ProviderSettingsPort

describe('basic API-key provider registrations', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    global.fetch = originalFetch
    mockRunAiSdkGenerateText.mockResolvedValue({ content: 'ok' })
  })

  afterEach(() => {
    global.fetch = originalFetch
  })

  it('resolves OpenAI-compatible providers through provider-db backed definitions', () => {
    const expectations = [
      ['nvidia', 'nvidia', 'microsoft/phi-4-mini-instruct'],
      ['huggingface', 'huggingface', 'Qwen/Qwen3-Coder-Next'],
      ['moonshot-ai', 'moonshot-ai', 'kimi-k2-0905-preview'],
      ['stepfun', 'stepfun', 'step-3.5-flash'],
      ['stepfun-step-plan', 'stepfun-step-plan', 'step-3.7-flash'],
      ['upstage', 'upstage', 'solar-mini'],
      ['alibaba-token-plan', 'alibaba-token-plan', 'deepseek-v4-flash'],
      ['alibaba-token-plan-cn', 'alibaba-token-plan-cn', 'deepseek-v4-flash']
    ] as const

    for (const [providerId, sourceId, checkModelId] of expectations) {
      expect(
        resolveAiSdkProviderDefinition(
          createProvider({
            id: providerId
          })
        )
      ).toMatchObject({
        runtimeKind: 'openai-compatible',
        modelSource: 'provider-db',
        providerDbSourceId: sourceId,
        checkStrategy: 'generate-text',
        credentialStrategy: 'api-key',
        checkModelId
      })
    }
  })

  it('resolves OpenCode Go through its mixed-route provider definition', () => {
    expect(
      resolveAiSdkProviderDefinition(
        createProvider({
          id: 'opencode-go',
          name: 'OpenCode Go',
          baseUrl: 'https://opencode.ai/zen/go/v1'
        })
      )
    ).toMatchObject({
      runtimeKind: 'openai-compatible',
      modelSource: 'opencode-go',
      checkStrategy: 'generate-text',
      credentialStrategy: 'api-key',
      routeStrategy: 'opencode-go',
      embeddingStrategy: 'none',
      checkModelId: 'kimi-k2.7-code'
    })
  })

  it('resolves DaoXE through authenticated OpenAI-compatible model discovery', () => {
    expect(
      resolveAiSdkProviderDefinition(
        createProvider({
          id: 'daoxe',
          name: 'DaoXE',
          baseUrl: 'https://daoxe.com/v1'
        })
      )
    ).toMatchObject({
      runtimeKind: 'openai-compatible',
      modelSource: 'openai',
      checkStrategy: 'fetch-models',
      credentialStrategy: 'api-key',
      routeStrategy: 'none',
      embeddingStrategy: 'openai'
    })
  })

  it('discovers AMD GPU Cloud models through the OpenAI-compatible endpoint', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({
        object: 'list',
        data: [
          { id: 'DeepSeek-V4-Flash', owned_by: 'deepseek' },
          { id: 'Qwen3.6-35B-A3B', owned_by: 'qwen' },
          { id: 'MiniCPM5-1B', owned_by: 'openbmb' },
          { id: 'MiniCPM-V46', owned_by: 'openbmb' }
        ]
      })
    })
    global.fetch = fetchMock as unknown as typeof fetch

    const provider = new AiSdkProvider(
      createProvider({
        id: 'amd-developer',
        name: 'AMD GPU Cloud',
        baseUrl: 'https://developer.amd.com.cn/radeon/api/v1'
      }),
      createProviderSettings()
    )
    const models = await provider.fetchModels()

    expect(resolveAiSdkProviderDefinition(createProvider({ id: 'amd-developer' }))).toMatchObject({
      runtimeKind: 'openai-compatible',
      modelSource: 'openai',
      checkStrategy: 'fetch-models',
      credentialStrategy: 'api-key',
      routeStrategy: 'none',
      embeddingStrategy: 'openai'
    })
    expect(fetchMock).toHaveBeenCalledWith(
      'https://developer.amd.com.cn/radeon/api/v1/models',
      expect.objectContaining({
        method: 'GET',
        headers: expect.objectContaining({
          Authorization: 'Bearer test-key'
        })
      })
    )
    expect(models.map(({ id }) => id)).toEqual([
      'DeepSeek-V4-Flash',
      'Qwen3.6-35B-A3B',
      'MiniCPM5-1B',
      'MiniCPM-V46'
    ])
    expect(models).toEqual([
      expect.objectContaining({
        id: 'DeepSeek-V4-Flash',
        providerId: 'amd-developer',
        ownedBy: 'deepseek'
      }),
      expect.objectContaining({
        id: 'Qwen3.6-35B-A3B',
        providerId: 'amd-developer',
        ownedBy: 'qwen'
      }),
      expect.objectContaining({
        id: 'MiniCPM5-1B',
        providerId: 'amd-developer',
        ownedBy: 'openbmb'
      }),
      expect.objectContaining({
        id: 'MiniCPM-V46',
        providerId: 'amd-developer',
        ownedBy: 'openbmb'
      })
    ])
  })

  it('discovers OrcaRouter models through the OpenAI-compatible endpoint', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({
        object: 'list',
        data: [
          { id: 'anthropic/claude-sonnet-4.6', owned_by: 'anthropic' },
          { id: 'orcarouter/auto', owned_by: 'orcarouter' }
        ]
      })
    })
    global.fetch = fetchMock as unknown as typeof fetch

    const provider = new AiSdkProvider(
      createProvider({
        id: 'orcarouter',
        name: 'OrcaRouter',
        baseUrl: 'https://api.orcarouter.ai/v1'
      }),
      createProviderSettings()
    )
    const models = await provider.fetchModels()

    expect(resolveAiSdkProviderDefinition(createProvider({ id: 'orcarouter' }))).toMatchObject({
      runtimeKind: 'openai-compatible',
      modelSource: 'openai',
      checkStrategy: 'fetch-models',
      routeStrategy: 'none',
      embeddingStrategy: 'openai'
    })
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.orcarouter.ai/v1/models',
      expect.objectContaining({
        method: 'GET',
        headers: expect.objectContaining({
          Authorization: 'Bearer test-key'
        })
      })
    )
    expect(models).toEqual([
      expect.objectContaining({
        id: 'anthropic/claude-sonnet-4.6',
        providerId: 'orcarouter',
        ownedBy: 'anthropic'
      }),
      expect.objectContaining({
        id: 'orcarouter/auto',
        providerId: 'orcarouter',
        ownedBy: 'orcarouter'
      })
    ])
  })

  it('discovers Modelsell models through the OpenAI-compatible endpoint', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({
        object: 'list',
        data: [{ id: 'example-chat-model', owned_by: 'modelsell' }]
      })
    })
    global.fetch = fetchMock as unknown as typeof fetch

    const provider = new AiSdkProvider(
      createProvider({
        id: 'modelsell',
        name: 'Modelsell',
        baseUrl: 'https://modelsell.com/v1'
      }),
      createProviderSettings()
    )
    const models = await provider.fetchModels()

    expect(resolveAiSdkProviderDefinition(createProvider({ id: 'modelsell' }))).toMatchObject({
      runtimeKind: 'openai-compatible',
      modelSource: 'openai',
      checkStrategy: 'fetch-models',
      routeStrategy: 'none',
      embeddingStrategy: 'openai'
    })
    expect(fetchMock).toHaveBeenCalledWith(
      'https://modelsell.com/v1/models',
      expect.objectContaining({
        method: 'GET',
        headers: expect.objectContaining({
          Authorization: 'Bearer test-key'
        })
      })
    )
    expect(models).toEqual([
      expect.objectContaining({
        id: 'example-chat-model',
        providerId: 'modelsell',
        ownedBy: 'modelsell'
      })
    ])
    expect(models[0]).not.toHaveProperty('contextLength')
    expect(models[0]).not.toHaveProperty('maxTokens')
  })

  it('keeps omitted OpenRouter capability metadata sparse', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({
        data: [{ id: 'openai/gpt-future', name: 'GPT Future' }]
      })
    }) as unknown as typeof fetch

    const provider = new AiSdkProvider(
      createProvider({
        id: 'openrouter',
        name: 'OpenRouter',
        baseUrl: 'https://openrouter.ai/api/v1'
      }),
      createProviderSettings()
    )
    const models = await provider.fetchModels()

    expect(models).toEqual([
      expect.objectContaining({
        id: 'openai/gpt-future',
        name: 'GPT Future',
        providerId: 'openrouter'
      })
    ])
    expect(models[0]).not.toHaveProperty('contextLength')
    expect(models[0]).not.toHaveProperty('maxTokens')
    expect(models[0]).not.toHaveProperty('vision')
    expect(models[0]).not.toHaveProperty('functionCall')
    expect(models[0]).not.toHaveProperty('reasoning')
  })

  it('keeps inferred remote capabilities and invalid limits out of provider facts', async () => {
    const cases = [
      { providerId: 'groq', modelId: 'opaque-model' },
      { providerId: 'tokenflux', modelId: 'opaque-model' },
      { providerId: '302ai', modelId: 'gpt-4o-future' }
    ] as const

    for (const { providerId, modelId } of cases) {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue({
          data: [
            {
              id: modelId,
              context_length: -1,
              context_size: Number.NaN,
              context_window: Number.POSITIVE_INFINITY,
              content_length: 0,
              max_tokens: Number.NaN,
              max_output_tokens: -1,
              max_completion_tokens: Number.POSITIVE_INFINITY
            }
          ]
        })
      }) as unknown as typeof fetch

      const provider = new AiSdkProvider(
        createProvider({
          id: providerId,
          name: providerId,
          baseUrl: `https://${providerId}.example/v1`
        }),
        createProviderSettings()
      )
      const models = await provider.fetchModels()

      expect(models).toHaveLength(1)
      expect(models[0]).toMatchObject({ id: modelId, providerId })
      expect(models[0]).not.toHaveProperty('contextLength')
      expect(models[0]).not.toHaveProperty('maxTokens')
      expect(models[0]).not.toHaveProperty('vision')
      expect(models[0]).not.toHaveProperty('functionCall')
      expect(models[0]).not.toHaveProperty('reasoning')
    }
  })

  it('discovers and classifies GreenPT models with flagship models first', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({
        object: 'list',
        data: [
          { id: 'green-rerank', owned_by: 'greenpt' },
          { id: 'other-chat-model', owned_by: 'other' },
          { id: 'green-s', owned_by: 'greenpt' },
          { id: 'green-embedding', owned_by: 'greenpt' },
          { id: 'kimi-k2.7-code', owned_by: 'moonshot' },
          { id: 'glm-5.2', owned_by: 'z.ai' }
        ]
      })
    })
    global.fetch = fetchMock as unknown as typeof fetch

    const provider = new AiSdkProvider(
      createProvider({
        id: 'greenpt',
        name: 'GreenPT',
        baseUrl: 'https://api.greenpt.ai/v1'
      }),
      createProviderSettings()
    )
    const models = await provider.fetchModels()

    expect(resolveAiSdkProviderDefinition(createProvider({ id: 'greenpt' }))).toMatchObject({
      runtimeKind: 'openai-compatible',
      modelSource: 'greenpt',
      checkStrategy: 'fetch-models',
      credentialStrategy: 'api-key',
      embeddingStrategy: 'openai'
    })
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.greenpt.ai/v1/models',
      expect.objectContaining({
        method: 'GET',
        headers: expect.objectContaining({
          Authorization: 'Bearer test-key'
        })
      })
    )
    expect(models.map(({ id }) => id)).toEqual([
      'glm-5.2',
      'kimi-k2.7-code',
      'green-embedding',
      'green-rerank',
      'other-chat-model'
    ])
    expect(models).toEqual([
      expect.objectContaining({ id: 'glm-5.2', type: 'chat' }),
      expect.objectContaining({ id: 'kimi-k2.7-code', type: 'chat' }),
      expect.objectContaining({ id: 'green-embedding', type: 'embedding' }),
      expect.objectContaining({ id: 'green-rerank', type: 'rerank' }),
      expect.objectContaining({ id: 'other-chat-model', type: 'chat' })
    ])
  })

  it('resolves MiniMax global through the Anthropic-compatible runtime', () => {
    expect(
      resolveAiSdkProviderDefinition(
        createProvider({
          id: 'minimax-global',
          name: 'MiniMax Global',
          apiType: 'anthropic',
          baseUrl: 'https://api.minimax.io/anthropic/v1'
        })
      )
    ).toMatchObject({
      runtimeKind: 'anthropic',
      behaviorPreset: 'anthropic',
      modelSource: 'provider-db',
      providerDbSourceId: 'minimax',
      checkStrategy: 'generate-text',
      credentialStrategy: 'api-key',
      checkModelId: 'MiniMax-M2.1'
    })
  })

  it('maps OpenCode Go model records and marks messages models for Anthropic routing', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({
        object: 'list',
        data: [
          { id: 'kimi-k2.7-code', object: 'model', owned_by: 'opencode' },
          { id: 'minimax-m3', object: 'model', owned_by: 'opencode' },
          { id: 'hy3-preview', object: 'model', owned_by: 'opencode' }
        ]
      })
    })
    global.fetch = fetchMock as unknown as typeof fetch

    const provider = new AiSdkProvider(
      createProvider({
        id: 'opencode-go',
        name: 'OpenCode Go',
        baseUrl: 'https://opencode.ai/zen/go/v1'
      }),
      createProviderSettings()
    )
    const models = await provider.fetchModels()

    expect(fetchMock).toHaveBeenCalledWith(
      'https://opencode.ai/zen/go/v1/models',
      expect.objectContaining({
        method: 'GET',
        headers: expect.objectContaining({
          Authorization: 'Bearer test-key'
        })
      })
    )
    expect(models).toEqual([
      expect.objectContaining({
        id: 'kimi-k2.7-code',
        group: 'Chat Completions',
        providerId: 'opencode-go',
        endpointType: 'openai',
        supportedEndpointTypes: ['openai'],
        ownedBy: 'opencode'
      }),
      expect.objectContaining({
        id: 'minimax-m3',
        group: 'Messages',
        providerId: 'opencode-go',
        endpointType: 'anthropic',
        supportedEndpointTypes: ['anthropic'],
        ownedBy: 'opencode'
      }),
      expect.objectContaining({
        id: 'hy3-preview',
        group: 'Chat Completions',
        providerId: 'opencode-go',
        endpointType: 'openai',
        supportedEndpointTypes: ['openai'],
        ownedBy: 'opencode'
      })
    ])
  })

  it('keeps catalog-backed provider models free of duplicated capability state', async () => {
    mockGetProvider.mockReturnValue({
      id: 'nvidia',
      name: 'NVIDIA',
      models: [
        {
          id: 'microsoft/phi-4-mini-instruct',
          display_name: 'Phi-4 Mini',
          tool_call: true,
          reasoning: {
            supported: false
          },
          modalities: {
            input: ['text'],
            output: ['text']
          },
          limit: {
            context: 131072,
            output: 8192
          }
        }
      ]
    })

    const provider = new AiSdkProvider(createProvider({}), createProviderSettings())
    const models = await provider.fetchModels()

    expect(mockGetProvider).toHaveBeenCalledWith('nvidia')
    expect(models).toEqual([
      {
        id: 'microsoft/phi-4-mini-instruct',
        name: 'Phi-4 Mini',
        group: 'default',
        providerId: 'nvidia',
        isCustom: false
      }
    ])
  })

  it('maps StepFun Token Plan models from its dedicated provider DB catalog', async () => {
    mockGetProvider.mockReturnValue({
      id: 'stepfun-step-plan',
      name: 'StepFun Step Plan (China)',
      models: [
        {
          id: 'step-router-v1',
          display_name: 'Step Router v1',
          tool_call: true,
          reasoning: {
            supported: false
          },
          modalities: {
            input: ['text'],
            output: ['text']
          },
          limit: {
            context: 256000,
            output: 256000
          }
        }
      ]
    })

    const provider = new AiSdkProvider(
      createProvider({
        id: 'stepfun-step-plan',
        name: 'StepFun Token Plan',
        baseUrl: 'https://api.stepfun.com/step_plan/v1'
      }),
      createProviderSettings()
    )
    const models = await provider.fetchModels()

    expect(mockGetProvider).toHaveBeenCalledWith('stepfun-step-plan')
    expect(models).toEqual([
      {
        id: 'step-router-v1',
        name: 'Step Router v1',
        group: 'Token Plan',
        providerId: 'stepfun-step-plan',
        isCustom: false
      }
    ])
  })

  it('checks StepFun Token Plan with the recommended model and endpoint', async () => {
    const provider = new AiSdkProvider(
      createProvider({
        id: 'stepfun-step-plan',
        name: 'StepFun Token Plan',
        baseUrl: 'https://api.stepfun.com/step_plan/v1'
      }),
      createProviderSettings()
    )
    ;(provider as any).isInitialized = true

    await expect(provider.check()).resolves.toEqual({
      isOk: true,
      errorMsg: null
    })
    expect(mockRunAiSdkGenerateText).toHaveBeenCalledWith(
      expect.objectContaining({
        providerKind: 'openai-compatible',
        provider: expect.objectContaining({
          id: 'stepfun-step-plan',
          apiKey: 'test-key',
          baseUrl: 'https://api.stepfun.com/step_plan/v1'
        })
      }),
      [{ role: 'user', content: 'Hello' }],
      'step-3.7-flash',
      expect.any(Object),
      0.2,
      16
    )
  })

  it('routes OpenCode Go chat completions models through OpenAI-compatible runtime', async () => {
    const provider = new AiSdkProvider(
      createProvider({
        id: 'opencode-go',
        name: 'OpenCode Go',
        baseUrl: 'https://opencode.ai/zen/go/v1'
      }),
      createProviderSettings()
    )
    ;(provider as any).isInitialized = true

    await expect(provider.check()).resolves.toEqual({
      isOk: true,
      errorMsg: null
    })
    expect(mockRunAiSdkGenerateText).toHaveBeenCalledWith(
      expect.objectContaining({
        providerKind: 'openai-compatible',
        provider: expect.objectContaining({
          id: 'opencode-go',
          apiType: 'openai-completions',
          baseUrl: 'https://opencode.ai/zen/go/v1'
        })
      }),
      [{ role: 'user', content: 'Hello' }],
      'kimi-k2.7-code',
      expect.any(Object),
      0.2,
      16
    )
  })

  it('uses Anthropic behavior for OpenCode Go messages models', async () => {
    const providerSettings = createProviderSettings()
    const provider = new AiSdkProvider(
      createProvider({
        id: 'opencode-go',
        name: 'OpenCode Go',
        baseUrl: 'https://opencode.ai/zen/go/v1'
      }),
      providerSettings
    )
    ;(provider as any).isInitialized = true
    const resolveRouteDecision = vi.spyOn(provider as any, 'resolveRouteDecision')

    await provider.summaryTitles(
      [{ role: 'user', content: 'Explain provider routing' }],
      'minimax-m3'
    )

    expect(mockRunAiSdkGenerateText).toHaveBeenCalledWith(
      expect.objectContaining({
        providerKind: 'anthropic'
      }),
      expect.any(Array),
      'minimax-m3',
      expect.any(Object),
      0.3,
      50
    )
    expect(resolveRouteDecision).toHaveBeenCalledTimes(1)
    expect(providerSettings.getModelConfig).toHaveBeenCalledTimes(1)
  })

  it('keeps local request shortcuts independent from provider initialization', async () => {
    const imageProviderSettings = createProviderSettings()
    vi.mocked(imageProviderSettings.getModelRouteConfig).mockReturnValue({
      endpointType: 'image-generation'
    })
    vi.mocked(imageProviderSettings.getModelConfig).mockReturnValue({
      endpointType: 'image-generation'
    })
    const imageProvider = new AiSdkProvider(
      createProvider({
        id: 'new-api',
        name: 'New API',
        apiType: 'new-api',
        baseUrl: 'https://new-api.example.com'
      }),
      imageProviderSettings
    )
    const compatibleProvider = new AiSdkProvider(createProvider({}), createProviderSettings())
    ;(imageProvider as any).isInitialized = false
    ;(compatibleProvider as any).isInitialized = false

    await expect(
      imageProvider.summaryTitles(
        [{ role: 'user', content: 'Create a quiet mountain landscape' }],
        'image-model'
      )
    ).resolves.toBe('Create a quiet mountain landscape')
    await expect(
      compatibleProvider.suggestions(
        [{ role: 'assistant', content: 'There is no user turn.' }],
        'microsoft/phi-4-mini-instruct'
      )
    ).resolves.toEqual([])
    expect(mockRunAiSdkGenerateText).not.toHaveBeenCalled()
  })

  it('routes OpenCode Go messages models through Anthropic runtime', async () => {
    const provider = new AiSdkProvider(
      createProvider({
        id: 'opencode-go',
        name: 'OpenCode Go',
        baseUrl: 'https://opencode.ai/zen/go/v1'
      }),
      createProviderSettings()
    )
    ;(provider as any).isInitialized = true

    await provider.runText([{ role: 'user', content: 'Hello' }], 'minimax-m3')

    expect(mockRunAiSdkGenerateText).toHaveBeenCalledWith(
      expect.objectContaining({
        providerKind: 'anthropic',
        provider: expect.objectContaining({
          id: 'opencode-go',
          apiType: 'anthropic',
          baseUrl: 'https://opencode.ai/zen/go/v1',
          capabilityProviderId: 'anthropic'
        })
      }),
      [{ role: 'user', content: 'Hello' }],
      'minimax-m3',
      expect.any(Object),
      undefined,
      undefined
    )
  })

  it('uses the configured check model for MiniMax global', async () => {
    const provider = new AiSdkProvider(
      createProvider({
        id: 'minimax-global',
        name: 'MiniMax Global',
        apiType: 'anthropic',
        baseUrl: 'https://api.minimax.io/anthropic/v1'
      }),
      createProviderSettings()
    )
    ;(provider as any).isInitialized = true

    await expect(provider.check()).resolves.toEqual({
      isOk: true,
      errorMsg: null
    })
    expect(mockRunAiSdkGenerateText).toHaveBeenCalledWith(
      expect.objectContaining({
        providerKind: 'anthropic',
        provider: expect.objectContaining({
          id: 'minimax-global',
          baseUrl: 'https://api.minimax.io/anthropic/v1'
        })
      }),
      [{ role: 'user', content: 'Hello' }],
      'MiniMax-M2.1',
      expect.any(Object),
      0.2,
      16
    )
  })
})

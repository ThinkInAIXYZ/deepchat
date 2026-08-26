import type { ProviderSettingsPort } from '@/provider/settings'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ModelType } from '../../../src/shared/model'
import type { LLM_PROVIDER, MODEL_META, OllamaModel } from '@shared/types/provider'
import { OllamaProvider } from '../../../src/main/provider/providers/ollamaProvider'

const { mockExecFile, mockOllamaConstructorOptions, mockOllamaPs } = vi.hoisted(() => ({
  mockExecFile: vi.fn(),
  mockOllamaConstructorOptions: [] as unknown[],
  mockOllamaPs: vi.fn()
}))

vi.mock('node:child_process', () => ({
  execFile: mockExecFile
}))

vi.mock('ollama', () => ({
  Ollama: class MockOllama {
    private readonly options: unknown

    constructor(options?: unknown) {
      this.options = options ?? {}
      mockOllamaConstructorOptions.push(this.options)
    }

    abort = vi.fn()
    ps = vi.fn(() => mockOllamaPs(this.options))
  }
}))

vi.mock('@shared/logger', () => ({
  default: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn()
  }
}))

vi.mock('@electron-toolkit/utils', () => ({
  is: {
    dev: false
  }
}))

vi.mock('../../../src/main/device', () => ({
  DeviceService: {
    getDefaultHeaders: () => ({})
  }
}))

const createModel = (
  name: string,
  options?: {
    family?: string
    parameterSize?: string
    contextLength?: number
    capabilities?: string[]
  }
): OllamaModel => ({
  name,
  model: name,
  size: 1,
  digest: `${name}-digest`,
  modified_at: new Date(),
  details: {
    format: 'gguf',
    family: options?.family ?? 'llama',
    families: [options?.family ?? 'llama'],
    parameter_size: options?.parameterSize ?? '7b',
    quantization_level: 'Q4_K_M'
  },
  model_info: {
    context_length: options?.contextLength ?? 8192,
    embedding_length: options?.capabilities?.includes('embedding') ? 768 : undefined
  },
  capabilities: options?.capabilities ?? ['chat']
})

describe('OllamaProvider.fetchModels', () => {
  let providerSettings: ProviderSettingsPort
  let provider: LLM_PROVIDER
  const originalAllowInsecureTls = process.env.DEEPCHAT_ALLOW_INSECURE_TLS

  beforeEach(() => {
    mockOllamaConstructorOptions.length = 0
    mockOllamaPs.mockReset()
    mockExecFile.mockReset()
    delete process.env.DEEPCHAT_ALLOW_INSECURE_TLS
    mockExecFile.mockImplementation((_command, _args, _options, callback) => {
      callback(null, '', '')
    })
    providerSettings = {
      getProviderModels: vi.fn(() => [
        {
          id: 'deepseek-r1:1.5b',
          name: 'deepseek-r1:1.5b',
          providerId: 'ollama',
          group: 'deepseek',
          contextLength: 16384,
          maxTokens: 4096,
          functionCall: true,
          reasoning: false,
          vision: false,
          type: ModelType.Chat
        } satisfies MODEL_META
      ]),
      getDbProviderModels: vi.fn(() => []),
      getCustomModels: vi.fn(() => []),
      setProviderModels: vi.fn(),
      ensureModelStatus: vi.fn()
    } as unknown as ProviderSettingsPort

    provider = {
      id: 'ollama',
      name: 'Ollama',
      apiType: 'ollama',
      apiKey: '',
      baseUrl: 'http://127.0.0.1:11434',
      enable: false
    }
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    if (originalAllowInsecureTls === undefined) {
      delete process.env.DEEPCHAT_ALLOW_INSECURE_TLS
    } else {
      process.env.DEEPCHAT_ALLOW_INSECURE_TLS = originalAllowInsecureTls
    }
  })

  it('normalizes Ollama SDK host and OpenAI-compatible runtime base URL', () => {
    const ollamaProvider = new OllamaProvider(
      {
        ...provider,
        apiKey: 'test-key',
        baseUrl: 'http://localhost:11434/api'
      },
      providerSettings
    )
    const runtimeContext = (ollamaProvider as any).getAiSdkRuntimeContext('local-custom-model')

    expect(mockOllamaConstructorOptions.at(-1)).toEqual({
      host: 'http://localhost:11434',
      headers: { Authorization: 'Bearer test-key' }
    })
    expect(runtimeContext.providerKind).toBe('openai-compatible')
    expect(runtimeContext.provider.baseUrl).toBe('http://localhost:11434/v1')
    expect(runtimeContext.capabilitySnapshot.identity).toMatchObject({
      providerId: 'ollama',
      requestModelId: 'local-custom-model',
      catalogMatched: false,
      catalogModelId: null
    })
  })

  it('installs an origin-scoped SDK fetch when custom headers are configured', async () => {
    const fetchMock = vi.fn(
      async (_input: string | URL | Request, _init?: RequestInit) =>
        new Response('{}', { status: 200 })
    )
    vi.stubGlobal('fetch', fetchMock)
    new OllamaProvider(
      {
        ...provider,
        customHeaders: { 'X-Tenant-ID': 'team-a' }
      },
      providerSettings
    )

    const options = mockOllamaConstructorOptions.at(-1) as {
      fetch: typeof fetch
    }
    await options.fetch('http://127.0.0.1:11434/api/tags')

    const headers = new Headers(fetchMock.mock.calls[0]?.[1]?.headers)
    expect(headers.get('x-tenant-id')).toBe('team-a')
  })

  it('merges local and running models, keeps running-only models, and preserves capabilities', async () => {
    const ollamaProvider = new OllamaProvider(provider, providerSettings)
    vi.mocked(providerSettings.getProviderModels).mockClear()

    vi.spyOn(ollamaProvider, 'listModels').mockResolvedValue([
      createModel('deepseek-r1:1.5b', {
        family: 'deepseek',
        parameterSize: '1.5b',
        contextLength: 32768,
        capabilities: ['chat', 'tools']
      }),
      createModel('nomic-embed-text:latest', {
        family: 'nomic',
        parameterSize: '335m',
        contextLength: 8192,
        capabilities: ['embedding']
      })
    ])
    vi.spyOn(ollamaProvider, 'listRunningModels').mockResolvedValue([
      createModel('deepseek-r1:1.5b', {
        family: 'deepseek',
        parameterSize: '1.5b',
        contextLength: 32768,
        capabilities: ['chat', 'thinking']
      }),
      createModel('qwen3:8b', {
        family: 'qwen',
        parameterSize: '8b',
        contextLength: 65536,
        capabilities: ['chat']
      })
    ])

    const models = await ollamaProvider.fetchModels()

    expect(models.map((model) => model.id)).toEqual([
      'deepseek-r1:1.5b',
      'nomic-embed-text:latest',
      'qwen3:8b'
    ])
    expect(models).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'deepseek-r1:1.5b',
          functionCall: true,
          reasoning: true,
          contextLength: 32768,
          type: ModelType.Chat
        }),
        expect.objectContaining({
          id: 'nomic-embed-text:latest',
          type: ModelType.Embedding
        }),
        expect.objectContaining({
          id: 'qwen3:8b',
          group: 'qwen'
        })
      ])
    )
    expect(providerSettings.getProviderModels).not.toHaveBeenCalled()
    expect(providerSettings.ensureModelStatus).toHaveBeenCalledWith(
      'ollama',
      'deepseek-r1:1.5b',
      true
    )
    expect(providerSettings.ensureModelStatus).toHaveBeenCalledWith(
      'ollama',
      'nomic-embed-text:latest',
      true
    )
    expect(providerSettings.ensureModelStatus).toHaveBeenCalledWith('ollama', 'qwen3:8b', true)
    expect(providerSettings.setProviderModels).toHaveBeenCalledWith('ollama', models)
  })

  it('does not promote catalog fallback capabilities into provider facts', async () => {
    const ollamaProvider = new OllamaProvider(provider, providerSettings)
    vi.spyOn(ollamaProvider, 'listModels').mockRejectedValue(new Error('ollama unavailable'))
    vi.spyOn(ollamaProvider, 'listRunningModels').mockResolvedValue([])
    vi.mocked(providerSettings.getDbProviderModels).mockReturnValue([
      {
        id: 'catalog-model',
        name: 'Catalog Model',
        provider: 'ollama',
        providerId: 'ollama',
        group: 'default',
        enabled: false,
        isCustom: false,
        contextLength: 131072,
        maxTokens: 32000,
        vision: true,
        functionCall: true,
        reasoning: true,
        type: ModelType.Chat
      }
    ])

    await expect(ollamaProvider.fetchModels()).resolves.toEqual([
      {
        id: 'catalog-model',
        name: 'Catalog Model',
        providerId: 'ollama',
        isCustom: false,
        group: 'default',
        description: undefined
      }
    ])
  })

  it('uses ollama list output as the local model source when the SDK list is empty', async () => {
    const ollamaProvider = new OllamaProvider(provider, providerSettings)
    ;(ollamaProvider as any).ollama = {
      list: vi.fn(async () => ({ models: [] })),
      show: vi.fn(async () => {
        throw new Error('show unavailable')
      })
    }
    mockExecFile.mockImplementationOnce((_command, _args, _options, callback) => {
      callback(
        null,
        [
          'NAME                ID              SIZE      MODIFIED',
          'deepseek-r1:1.5b    e0979632db5a    1.1 GB    17 seconds ago',
          'gemma4:e2b          7fbdbf8f5e45    7.2 GB    3 weeks ago'
        ].join('\n'),
        ''
      )
    })

    const models = await ollamaProvider.listModels()

    expect(models.map((model) => model.name)).toEqual(['deepseek-r1:1.5b', 'gemma4:e2b'])
    expect(models).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: 'deepseek-r1:1.5b',
          digest: 'e0979632db5a'
        }),
        expect.objectContaining({
          name: 'gemma4:e2b',
          digest: '7fbdbf8f5e45'
        })
      ])
    )
    expect(models[0]).not.toHaveProperty('model_info')
    expect(models[0]).not.toHaveProperty('capabilities')
  })

  it('preserves list model info when the show response is sparse', async () => {
    const ollamaProvider = new OllamaProvider(provider, providerSettings)
    ;(ollamaProvider as any).ollama = {
      list: vi.fn(async () => ({
        models: [createModel('qwen3:8b', { family: 'qwen', contextLength: 32768 })]
      })),
      show: vi.fn(async () => ({
        details: {},
        model_info: {
          'qwen.embedding_length': 4096
        },
        capabilities: ['chat']
      }))
    }

    const models = await ollamaProvider.listModels()

    expect(models[0].model_info).toMatchObject({
      context_length: 32768,
      embedding_length: 4096
    })
  })

  it('keeps the running context separate from theoretical model metadata', async () => {
    const ollamaProvider = new OllamaProvider(provider, providerSettings)
    let runtimeContextLength: unknown = 8192
    const ps = vi.fn(async () => ({
      models: [
        {
          ...createModel('qwen3:8b', { family: 'qwen', contextLength: 8192 }),
          context_length: runtimeContextLength
        }
      ]
    }))
    const show = vi.fn(async () => ({
      details: {},
      model_info: {
        'general.architecture': 'qwen',
        'qwen.context_length': 262144
      },
      capabilities: ['chat']
    }))
    ;(ollamaProvider as any).ollama = { ps, show }
    mockOllamaPs.mockImplementation(async () => ({
      models: [
        {
          ...createModel('qwen3:8b', { family: 'qwen', contextLength: 8192 }),
          context_length: runtimeContextLength
        }
      ]
    }))

    const runningModels = await ollamaProvider.listRunningModels()

    expect(runningModels[0]).toMatchObject({
      name: 'qwen3:8b',
      context_length: 8192,
      runtimeContextLength: 8192,
      model_info: { context_length: 262144 }
    })
    expect(await ollamaProvider.getRuntimeContextLimitTokens('qwen3:8b')).toBe(8192)
    runtimeContextLength = 16384
    expect(await ollamaProvider.getRuntimeContextLimitTokens('qwen3:8b')).toBe(16384)
    runtimeContextLength = 0
    await expect(ollamaProvider.getRuntimeContextLimitTokens('qwen3:8b')).rejects.toThrow(
      'Upgrade Ollama to v0.9.7 or newer'
    )
    expect(show).toHaveBeenCalledTimes(1)
    expect(ps).toHaveBeenCalledTimes(1)
    expect(mockOllamaPs).toHaveBeenCalledTimes(3)
  })

  it('distinguishes a stopped model from an unavailable runtime query', async () => {
    const ollamaProvider = new OllamaProvider(provider, providerSettings)
    mockOllamaPs
      .mockResolvedValueOnce({ models: [] })
      .mockRejectedValueOnce(new Error('ps unavailable'))

    await expect(ollamaProvider.getRuntimeContextLimitTokens('qwen3:8b')).resolves.toBeUndefined()
    await expect(ollamaProvider.getRuntimeContextLimitTokens('qwen3:8b')).rejects.toThrow(
      'Failed to read the Ollama runtime context for qwen3:8b: ps unavailable'
    )
    expect(mockOllamaPs).toHaveBeenCalledTimes(2)
  })

  it('diagnoses a running model from Ollama versions without runtime context metadata', async () => {
    const ollamaProvider = new OllamaProvider(provider, providerSettings)
    mockOllamaPs.mockResolvedValue({
      models: [{ name: 'qwen3:8b' }]
    })

    await expect(ollamaProvider.getRuntimeContextLimitTokens('qwen3:8b')).rejects.toThrow(
      'Upgrade Ollama to v0.9.7 or newer'
    )
  })

  it('matches the implicit latest tag in either model-name direction', async () => {
    const ollamaProvider = new OllamaProvider(provider, providerSettings)
    mockOllamaPs
      .mockResolvedValueOnce({
        models: [{ name: 'qwen3', context_length: 8192 }]
      })
      .mockResolvedValueOnce({
        models: [{ name: 'qwen3:latest', context_length: 16384 }]
      })
      .mockResolvedValueOnce({
        models: [{ name: 'qwen3:8b', context_length: 32768 }]
      })

    await expect(ollamaProvider.getRuntimeContextLimitTokens('qwen3:latest')).resolves.toBe(8192)
    await expect(ollamaProvider.getRuntimeContextLimitTokens('qwen3')).resolves.toBe(16384)
    await expect(ollamaProvider.getRuntimeContextLimitTokens('qwen3')).resolves.toBeUndefined()
  })

  it('bounds a stalled runtime context query without loading the model', async () => {
    vi.useFakeTimers()
    try {
      const ollamaProvider = new OllamaProvider(provider, providerSettings)
      let transportSignal: AbortSignal | undefined
      const transportFetch = vi.fn(
        (_input: string | URL | Request, init?: RequestInit) =>
          new Promise<Response>((_resolve, reject) => {
            transportSignal = init?.signal as AbortSignal | undefined
            transportSignal?.addEventListener('abort', () => reject(transportSignal?.reason), {
              once: true
            })
          })
      )
      vi.stubGlobal('fetch', transportFetch)
      mockOllamaPs.mockImplementation(async (options) => {
        const requestFetch = (options as { fetch?: typeof fetch }).fetch
        await requestFetch?.('http://127.0.0.1:11434/api/ps')
        return { models: [] }
      })

      const limitPromise = ollamaProvider.getRuntimeContextLimitTokens('qwen3:8b')
      const rejection = expect(limitPromise).rejects.toThrow(
        'Timed out after 400ms while reading Ollama runtime models'
      )
      await vi.advanceTimersByTimeAsync(400)

      await rejection
      expect(mockOllamaPs).toHaveBeenCalledTimes(1)
      expect(transportFetch).toHaveBeenCalledTimes(1)
      expect(transportSignal?.aborted).toBe(true)
    } finally {
      vi.useRealTimers()
    }
  })

  it('propagates cancellation of a stalled runtime context query', async () => {
    const ollamaProvider = new OllamaProvider(provider, providerSettings)
    let transportSignal: AbortSignal | undefined
    const transportFetch = vi.fn(
      (_input: string | URL | Request, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          transportSignal = init?.signal as AbortSignal | undefined
          transportSignal?.addEventListener('abort', () => reject(transportSignal?.reason), {
            once: true
          })
        })
    )
    vi.stubGlobal('fetch', transportFetch)
    mockOllamaPs.mockImplementation(async (options) => {
      const requestFetch = (options as { fetch?: typeof fetch }).fetch
      await requestFetch?.('http://127.0.0.1:11434/api/ps')
      return { models: [] }
    })
    const abortController = new AbortController()

    const limitPromise = ollamaProvider.getRuntimeContextLimitTokens(
      'qwen3:8b',
      abortController.signal
    )
    abortController.abort()

    await expect(limitPromise).rejects.toMatchObject({ name: 'AbortError' })
    expect(mockOllamaPs).toHaveBeenCalledTimes(1)
    expect(transportFetch).toHaveBeenCalledTimes(1)
    expect(transportSignal?.aborted).toBe(true)
  })

  it('confirms pull success against the ollama list model set', async () => {
    const ollamaProvider = new OllamaProvider(provider, providerSettings)
    ;(ollamaProvider as any).ollama = {
      pull: vi.fn(async () => ({
        async *[Symbol.asyncIterator]() {
          yield { status: 'pulling manifest' }
          yield { status: 'success' }
        }
      })),
      list: vi.fn(async () => ({ models: [] })),
      show: vi.fn(async () => {
        throw new Error('show unavailable')
      })
    }
    mockExecFile.mockImplementationOnce((_command, _args, _options, callback) => {
      callback(
        null,
        [
          'NAME                ID              SIZE      MODIFIED',
          'qwen3:8b            500a1f067a9f    5.2 GB    1 second ago'
        ].join('\n'),
        ''
      )
    })

    await expect(ollamaProvider.pullModel('qwen3:8b')).resolves.toBe(true)
    expect((ollamaProvider as any).ollama.pull).toHaveBeenCalledWith(
      expect.objectContaining({
        model: 'qwen3:8b',
        insecure: false,
        stream: true
      })
    )
  })

  it('only enables insecure pulls behind the explicit TLS debug flag', async () => {
    process.env.DEEPCHAT_ALLOW_INSECURE_TLS = '1'
    const ollamaProvider = new OllamaProvider(provider, providerSettings)
    ;(ollamaProvider as any).ollama = {
      pull: vi.fn(async () => ({
        async *[Symbol.asyncIterator]() {
          yield { status: 'success' }
        }
      })),
      list: vi.fn(async () => ({ models: [{ ...createModel('qwen3:8b') }] })),
      show: vi.fn(async () => {
        throw new Error('show unavailable')
      })
    }

    await expect(ollamaProvider.pullModel('qwen3:8b')).resolves.toBe(true)
    expect((ollamaProvider as any).ollama.pull).toHaveBeenCalledWith(
      expect.objectContaining({
        model: 'qwen3:8b',
        insecure: true,
        stream: true
      })
    )
  })

  it('treats latest tags from ollama list as a successful untagged pull', async () => {
    const ollamaProvider = new OllamaProvider(provider, providerSettings)
    ;(ollamaProvider as any).ollama = {
      pull: vi.fn(async () => ({
        async *[Symbol.asyncIterator]() {
          yield { status: 'success' }
        }
      })),
      list: vi.fn(async () => ({ models: [] })),
      show: vi.fn(async () => {
        throw new Error('show unavailable')
      })
    }
    mockExecFile.mockImplementationOnce((_command, _args, _options, callback) => {
      callback(
        null,
        [
          'NAME          ID              SIZE      MODIFIED',
          'qwen3:latest  500a1f067a9f    5.2 GB    now'
        ].join('\n'),
        ''
      )
    })

    await expect(ollamaProvider.pullModel('qwen3')).resolves.toBe(true)
  })

  it('recreates the Ollama client when provider config changes after active streams drain', async () => {
    const ollamaProvider = Object.create(OllamaProvider.prototype) as OllamaProvider & {
      provider: LLM_PROVIDER
      providerSettings: ProviderSettingsPort
      models: MODEL_META[]
      customModels: MODEL_META[]
      ollama: unknown
      activeStreams: number
      activeStreamResolvers: Array<() => void>
      isDraining: boolean
      configUpdateChain: Promise<void>
      createOllamaClient: ReturnType<typeof vi.fn>
    }

    ollamaProvider.provider = provider
    ollamaProvider.providerSettings = providerSettings
    ollamaProvider.models = []
    ollamaProvider.customModels = []
    ollamaProvider.ollama = { id: 'old-client', abort: vi.fn() }
    ollamaProvider.activeStreams = 0
    ollamaProvider.activeStreamResolvers = []
    ollamaProvider.isDraining = false
    ollamaProvider.configUpdateChain = Promise.resolve()
    ollamaProvider.createOllamaClient = vi.fn(() => ({ id: 'new-client' }))

    ollamaProvider.updateConfig({
      ...provider,
      baseUrl: 'http://127.0.0.1:22434'
    })

    await vi.waitFor(() => {
      expect(ollamaProvider.createOllamaClient).toHaveBeenCalledTimes(1)
    })

    expect(ollamaProvider.createOllamaClient).toHaveBeenCalledTimes(1)
    expect(ollamaProvider.ollama).toEqual({ id: 'new-client' })
    expect(ollamaProvider.provider.baseUrl).toBe('http://127.0.0.1:22434')
  })
})

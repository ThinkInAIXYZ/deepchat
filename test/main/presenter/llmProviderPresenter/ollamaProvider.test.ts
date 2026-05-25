import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ModelType } from '../../../../src/shared/model'
import type {
  IConfigPresenter,
  LLM_PROVIDER,
  MODEL_META,
  OllamaModel
} from '../../../../src/shared/presenter'
import { OllamaProvider } from '../../../../src/main/presenter/llmProviderPresenter/providers/ollamaProvider'

const { mockExecFile, mockOllamaConstructorOptions } = vi.hoisted(() => ({
  mockExecFile: vi.fn(),
  mockOllamaConstructorOptions: [] as unknown[]
}))

vi.mock('node:child_process', () => ({
  execFile: mockExecFile
}))

vi.mock('ollama', () => ({
  Ollama: class MockOllama {
    constructor(options?: unknown) {
      mockOllamaConstructorOptions.push(options ?? {})
    }

    abort = vi.fn()
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

vi.mock('../../../../src/main/presenter/devicePresenter', () => ({
  DevicePresenter: {
    getDefaultHeaders: () => ({})
  }
}))

vi.mock('@/presenter', () => ({
  presenter: {
    configPresenter: {
      getProvider: vi.fn(),
      getProviderModels: vi.fn(() => []),
      getCustomModels: vi.fn(() => [])
    }
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
  let configPresenter: IConfigPresenter
  let provider: LLM_PROVIDER
  const originalAllowInsecureTls = process.env.DEEPCHAT_ALLOW_INSECURE_TLS

  beforeEach(() => {
    mockOllamaConstructorOptions.length = 0
    mockExecFile.mockReset()
    delete process.env.DEEPCHAT_ALLOW_INSECURE_TLS
    mockExecFile.mockImplementation((_command, _args, _options, callback) => {
      callback(null, '', '')
    })
    configPresenter = {
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
      getCustomModels: vi.fn(() => []),
      setProviderModels: vi.fn(),
      ensureModelStatus: vi.fn()
    } as unknown as IConfigPresenter

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
      configPresenter
    )
    const runtimeContext = (ollamaProvider as any).getAiSdkRuntimeContext()

    expect(mockOllamaConstructorOptions.at(-1)).toEqual({
      host: 'http://localhost:11434',
      headers: { Authorization: 'Bearer test-key' }
    })
    expect(runtimeContext.providerKind).toBe('openai-compatible')
    expect(runtimeContext.provider.baseUrl).toBe('http://localhost:11434/v1')
  })

  it('merges local and running models, keeps running-only models, and preserves capabilities', async () => {
    const ollamaProvider = new OllamaProvider(provider, configPresenter)

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
    expect(configPresenter.ensureModelStatus).toHaveBeenCalledWith(
      'ollama',
      'deepseek-r1:1.5b',
      true
    )
    expect(configPresenter.ensureModelStatus).toHaveBeenCalledWith(
      'ollama',
      'nomic-embed-text:latest',
      true
    )
    expect(configPresenter.ensureModelStatus).toHaveBeenCalledWith('ollama', 'qwen3:8b', true)
    expect(configPresenter.setProviderModels).toHaveBeenCalledWith('ollama', models)
  })

  it('uses ollama list output as the local model source when the SDK list is empty', async () => {
    const ollamaProvider = new OllamaProvider(provider, configPresenter)
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
  })

  it('confirms pull success against the ollama list model set', async () => {
    const ollamaProvider = new OllamaProvider(provider, configPresenter)
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
    const ollamaProvider = new OllamaProvider(provider, configPresenter)
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
    const ollamaProvider = new OllamaProvider(provider, configPresenter)
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
      configPresenter: IConfigPresenter
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
    ollamaProvider.configPresenter = configPresenter
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

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ModelType } from '../../../../src/shared/model'
import type {
  IConfigPresenter,
  LLM_PROVIDER,
  MODEL_META,
  OllamaModel
} from '../../../../src/shared/presenter'
import { OllamaProvider } from '../../../../src/main/presenter/llmProviderPresenter/providers/ollamaProvider'

vi.mock('ollama', () => ({
  Ollama: class MockOllama {}
}))

vi.mock('@shared/logger', () => ({
  default: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn()
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

  beforeEach(() => {
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
})

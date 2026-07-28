import path from 'path'
import { describe, expect, it, vi } from 'vitest'

import { DEFAULT_PROVIDERS } from '../../../src/main/provider/defaults'
import { providerDbLoader } from '../../../src/main/provider/providerDbLoader'
import { AiSdkProvider } from '../../../src/main/provider/providers/aiSdkProvider'
import { resolveAiSdkProviderDefinition } from '../../../src/main/provider/providerRegistry'
import type { LLM_PROVIDER } from '@shared/types/provider'

const CODEX_5_6_RESOURCE_MODEL_IDS = ['gpt-5.6', 'gpt-5.6-sol', 'gpt-5.6-luna', 'gpt-5.6-terra']

describe('OpenAI Codex provider registration', () => {
  it('keeps OpenAI Codex separate from the OpenAI API-key provider', () => {
    const openai = DEFAULT_PROVIDERS.find((provider) => provider.id === 'openai')
    const codex = DEFAULT_PROVIDERS.find((provider) => provider.id === 'openai-codex')

    expect(openai?.apiType).toBe('openai')
    expect(openai?.baseUrl).toBe('https://api.openai.com/v1')
    expect(codex?.apiType).toBe('openai-codex')
    expect(codex?.baseUrl).toBe('https://chatgpt.com/backend-api/codex')
    expect(codex?.apiKey).toBe('')
  })

  it('resolves Codex through a dedicated AI SDK runtime branch', () => {
    const provider: LLM_PROVIDER = {
      id: 'openai-codex',
      name: 'OpenAI Codex',
      apiType: 'openai-codex',
      apiKey: '',
      baseUrl: 'https://chatgpt.com/backend-api/codex',
      enable: true
    }

    const definition = resolveAiSdkProviderDefinition(provider)

    expect(definition?.runtimeKind).toBe('openai-codex')
    expect(definition?.modelSource).toBe('openai-codex')
    expect(definition?.providerDbSourceId).toBe('openai')
    expect(definition?.checkModelId).toBe('gpt-5.6-luna')
  })

  it('has Codex 5.6 models in the bundled OpenAI provider database', async () => {
    const fs = await vi.importActual<typeof import('fs')>('fs')
    const providerDbPath = path.join(process.cwd(), 'resources', 'model-db', 'providers.json')
    const db = JSON.parse(fs.readFileSync(providerDbPath, 'utf-8'))
    const openaiProvider = db.providers.openai
    const modelIds = new Set(openaiProvider.models.map((model: { id: string }) => model.id))

    for (const modelId of CODEX_5_6_RESOURCE_MODEL_IDS) {
      expect(modelIds.has(modelId)).toBe(true)
    }
  })

  it('loads current Codex recommended models from the OpenAI provider database', async () => {
    const provider: LLM_PROVIDER = {
      id: 'openai-codex',
      name: 'OpenAI Codex',
      apiType: 'openai-codex',
      apiKey: '',
      baseUrl: 'https://chatgpt.com/backend-api/codex',
      enable: false
    }
    const providerSettings = {
      getProviderModels: vi.fn().mockReturnValue([]),
      getCustomModels: vi.fn().mockReturnValue([]),
      setProviderModels: vi.fn()
    }
    const providerDbSpy = vi.spyOn(providerDbLoader, 'getProvider').mockReturnValue({
      id: 'openai',
      name: 'OpenAI',
      models: [
        {
          id: 'gpt-5-codex',
          display_name: 'GPT-5-Codex',
          modalities: { input: ['text'], output: ['text'] },
          limit: { context: 400000, output: 128000 },
          tool_call: true,
          reasoning: { supported: true }
        },
        {
          id: 'gpt-5.4-mini',
          display_name: 'GPT-5.4 mini',
          modalities: { input: ['text'], output: ['text'] },
          limit: { context: 400000, output: 128000 },
          tool_call: true,
          reasoning: { supported: true }
        },
        {
          id: 'gpt-5.6',
          display_name: 'GPT-5.6',
          modalities: { input: ['text', 'image', 'pdf'], output: ['text'] },
          limit: { context: 1050000, output: 128000 },
          tool_call: true,
          reasoning: { supported: true }
        },
        {
          id: 'gpt-5.6-sol',
          display_name: 'GPT-5.6 Sol',
          modalities: { input: ['text', 'image', 'pdf'], output: ['text'] },
          limit: { context: 1050000, output: 128000 },
          tool_call: true,
          reasoning: { supported: true }
        },
        {
          id: 'gpt-5.6-luna',
          display_name: 'GPT-5.6 Luna',
          modalities: { input: ['text', 'image', 'pdf'], output: ['text'] },
          limit: { context: 1050000, output: 128000 },
          tool_call: true,
          reasoning: { supported: true }
        },
        {
          id: 'gpt-5.6-terra',
          display_name: 'GPT-5.6 Terra',
          modalities: { input: ['text', 'image', 'pdf'], output: ['text'] },
          limit: { context: 1050000, output: 128000 },
          tool_call: true,
          reasoning: { supported: true }
        },
        {
          id: 'gpt-5.5',
          display_name: 'GPT-5.5',
          modalities: { input: ['text', 'image'], output: ['text'] },
          limit: { context: 1050000, output: 128000 },
          tool_call: true,
          reasoning: { supported: true }
        },
        {
          id: 'gpt-5.3-codex-spark',
          display_name: 'GPT-5.3 Codex Spark',
          modalities: { input: ['text'], output: ['text'] },
          limit: { context: 128000, output: 32000 },
          tool_call: true,
          reasoning: { supported: true }
        },
        {
          id: 'gpt-5.4',
          display_name: 'GPT-5.4',
          modalities: { input: ['text', 'image'], output: ['text'] },
          limit: { context: 1050000, output: 128000 },
          tool_call: true,
          reasoning: { supported: true }
        }
      ]
    } as any)
    const aiSdkProvider = new AiSdkProvider(provider, providerSettings as any)

    const models = await aiSdkProvider.fetchModels()
    providerDbSpy.mockRestore()

    expect(models.map((model) => model.id)).toEqual([
      'gpt-5.5',
      'gpt-5.6-sol',
      'gpt-5.6-terra',
      'gpt-5.6-luna',
      'gpt-5.4',
      'gpt-5.4-mini',
      'gpt-5.3-codex-spark'
    ])
    expect(models.some((model) => model.id === 'gpt-5.6')).toBe(false)
    expect(models.every((model) => model.group === 'Codex')).toBe(true)
    expect(models.every((model) => model.providerId === 'openai-codex')).toBe(true)
    const luna = models.find((model) => model.id === 'gpt-5.6-luna')
    expect(luna).not.toHaveProperty('reasoning')
    expect(luna).not.toHaveProperty('contextLength')
    expect(luna).not.toHaveProperty('maxTokens')
    expect(providerSettings.setProviderModels).toHaveBeenCalledWith('openai-codex', models)
  })
})

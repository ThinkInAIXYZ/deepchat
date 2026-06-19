import { describe, expect, it, vi } from 'vitest'

vi.mock('@/presenter', () => ({
  presenter: {
    devicePresenter: {
      cacheImage: vi.fn(async (data: string) => data)
    }
  }
}))

import { DEFAULT_PROVIDERS } from '../../../../src/main/presenter/configPresenter/providers'
import { providerDbLoader } from '../../../../src/main/presenter/configPresenter/providerDbLoader'
import { AiSdkProvider } from '../../../../src/main/presenter/llmProviderPresenter/providers/aiSdkProvider'
import { resolveAiSdkProviderDefinition } from '../../../../src/main/presenter/llmProviderPresenter/providerRegistry'
import type { LLM_PROVIDER } from '../../../../src/shared/presenter'

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
    expect(definition?.checkModelId).toBe('gpt-5.5')
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
    const configPresenter = {
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
    const aiSdkProvider = new AiSdkProvider(provider, configPresenter as any)

    const models = await aiSdkProvider.fetchModels()
    providerDbSpy.mockRestore()

    expect(models.map((model) => model.id)).toEqual([
      'gpt-5.5',
      'gpt-5.4',
      'gpt-5.4-mini',
      'gpt-5.3-codex-spark'
    ])
    expect(models.every((model) => model.group === 'Codex')).toBe(true)
    expect(models.every((model) => model.providerId === 'openai-codex')).toBe(true)
    expect(models.find((model) => model.id === 'gpt-5.5')?.reasoning).toBe(true)
    expect(configPresenter.setProviderModels).toHaveBeenCalledWith('openai-codex', models)
  })
})

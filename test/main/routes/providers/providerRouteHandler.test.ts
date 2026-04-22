import { describe, expect, it, vi } from 'vitest'
import { dispatchProviderRoute } from '../../../../src/main/routes/providers/providerRouteHandler'

describe('dispatchProviderRoute providers.listSummaries', () => {
  it('returns lightweight provider summaries without model arrays', async () => {
    const configPresenter = {
      getProviders: vi.fn(() => [
        {
          id: 'openai',
          name: 'OpenAI',
          apiType: 'openai',
          apiKey: 'sk-test',
          baseUrl: 'https://api.openai.com/v1',
          enable: true,
          models: [{ id: 'gpt-5.4', name: 'GPT-5.4', group: 'default', providerId: 'openai' }],
          customModels: [{ id: 'custom', name: 'Custom', group: 'custom', providerId: 'openai' }],
          enabledModels: ['gpt-5.4'],
          disabledModels: ['custom']
        }
      ])
    }

    const result = (await dispatchProviderRoute(
      {
        configPresenter: configPresenter as any,
        llmProviderPresenter: {} as any
      },
      'providers.listSummaries',
      {}
    )) as {
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
})

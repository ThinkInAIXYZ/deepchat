import { describe, it, expect } from 'vitest'
import { ModelType } from '@shared/model'
import type { RENDERER_MODEL_META } from '@shared/presenter'
import { buildSelectableProviderCatalog } from '@/composables/model/modelCatalog'

describe('buildSelectableProviderCatalog', () => {
  const providers = [
    { id: 'openai', name: 'OpenAI', enable: true },
    { id: 'acp', name: 'ACP', enable: true }
  ]

  const enabledModels = [
    {
      providerId: 'openai',
      models: [
        {
          id: 'gpt-4',
          name: 'GPT-4',
          providerId: 'openai',
          enabled: true,
          vision: true,
          type: ModelType.Chat
        } as RENDERER_MODEL_META
      ]
    },
    {
      providerId: 'acp',
      models: [
        {
          id: 'acp-model',
          name: 'ACP Model',
          providerId: 'acp',
          enabled: true,
          vision: false,
          type: ModelType.Chat
        } as RENDERER_MODEL_META
      ]
    }
  ]

  it('filters providers by mode', () => {
    const catalog = buildSelectableProviderCatalog(providers, enabledModels, {
      mode: 'acp agent'
    })

    expect(catalog).toHaveLength(1)
    expect(catalog[0].id).toBe('acp')
  })

  it('filters by vision requirement', () => {
    const catalog = buildSelectableProviderCatalog(providers, enabledModels, {
      requiresVision: true
    })

    expect(catalog).toHaveLength(1)
    expect(catalog[0].id).toBe('openai')
  })

  it('filters by model type', () => {
    const catalog = buildSelectableProviderCatalog(providers, enabledModels, {
      types: [ModelType.ImageGeneration]
    })

    expect(catalog).toHaveLength(0)
  })
})

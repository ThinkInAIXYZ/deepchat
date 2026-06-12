import { describe, expect, it, vi } from 'vitest'
import { dispatchModelRoute } from '../../../../src/main/routes/models/modelRouteHandler'
import { modelsGetProviderCatalogRoute } from '../../../../src/shared/contracts/routes'
import { ModelType } from '../../../../src/shared/model'

describe('dispatchModelRoute models.getProviderCatalog', () => {
  it('includes provider DB-only models when resolving persisted model status', async () => {
    const configPresenter = {
      getProviderModels: vi.fn(() => [
        {
          id: 'gpt-5',
          name: 'GPT-5',
          group: 'default',
          providerId: 'aihubmix'
        }
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

    const result = (await dispatchModelRoute(
      {
        configPresenter: configPresenter as any,
        llmProviderPresenter: {} as any
      },
      modelsGetProviderCatalogRoute.name,
      {
        providerId: 'aihubmix'
      }
    )) as {
      catalog: {
        modelStatusMap: Record<string, boolean>
      }
    }

    expect(configPresenter.getBatchModelStatus).toHaveBeenCalledWith('aihubmix', [
      'gpt-5',
      'custom-chat',
      'text-embedding-3-small'
    ])
    expect(result.catalog.modelStatusMap['text-embedding-3-small']).toBe(true)
  })
})

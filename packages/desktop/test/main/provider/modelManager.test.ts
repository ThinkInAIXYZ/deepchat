import { describe, expect, it, vi } from 'vitest'
import { ModelManager } from '@/provider/managers/modelManager'
import { ModelType } from '@shared/model'
import type { MODEL_META } from '@shared/types/provider'

describe('ModelManager model resolution', () => {
  it('delegates runtime list projection to ProviderSettings', async () => {
    const rawModel: MODEL_META = {
      id: 'gpt-5.6-sol',
      name: 'GPT-5.6 Sol',
      group: 'openai',
      providerId: 'new-api',
      endpointType: 'openai',
      ownedBy: 'openai'
    }
    const effectiveModel: MODEL_META = {
      ...rawModel,
      providerId: 'new-api',
      contextLength: 1_050_000,
      maxTokens: 32_000,
      vision: true,
      functionCall: true,
      reasoning: true,
      type: ModelType.Chat
    }
    const resolveEffectiveModels = vi.fn().mockReturnValue([effectiveModel])
    const manager = new ModelManager({
      providerSettings: {
        resolveEffectiveModels
      } as never,
      getProviderInstance: vi.fn().mockReturnValue({
        fetchModels: vi.fn().mockResolvedValue([rawModel])
      })
    })

    await expect(manager.getModelList('new-api')).resolves.toEqual([effectiveModel])
    expect(resolveEffectiveModels).toHaveBeenCalledWith(
      [
        expect.objectContaining({
          id: 'gpt-5.6-sol',
          providerId: 'new-api'
        })
      ],
      'new-api'
    )
  })
})

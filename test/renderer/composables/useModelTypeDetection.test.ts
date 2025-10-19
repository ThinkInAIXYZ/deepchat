import { ref } from 'vue'
import { describe, it, expect } from 'vitest'
import { useModelTypeDetection } from '@/composables/useModelTypeDetection'

vi.mock('@/stores/settings', () => ({
  useSettingsStore: () => ({
    getModelConfig: vi.fn().mockResolvedValue({ reasoning: true })
  })
}))

describe('useModelTypeDetection', () => {
  it('detects provider/model type and loads reasoning flag', async () => {
    const modelId = ref<string | undefined>('gpt-5-pro')
    const providerId = ref<string | undefined>('gemini')
    const modelType = ref<'chat' | 'imageGeneration' | 'embedding' | 'rerank' | undefined>(
      'imageGeneration'
    )

    const api = useModelTypeDetection({ modelId, providerId, modelType })
    expect(api.isImageGenerationModel.value).toBe(true)
    expect(api.isGPT5Model.value).toBe(true)
    expect(api.isGeminiProvider.value).toBe(true)

    await Promise.resolve()
    expect(api.modelReasoning.value).toBe(true)
  })
})

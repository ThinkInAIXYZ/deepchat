import { ref } from 'vue'
import { beforeEach, describe, it, expect, vi } from 'vitest'
import { useModelTypeDetection } from '@/composables/useModelTypeDetection'

const getModelConfig = vi.hoisted(() => vi.fn())

vi.mock('@/stores/modelConfigStore', () => ({
  useModelConfigStore: () => ({
    getModelConfig
  })
}))

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((promiseResolve) => {
    resolve = promiseResolve
  })

  return { promise, resolve }
}

describe('useModelTypeDetection', () => {
  beforeEach(() => {
    getModelConfig.mockReset()
    getModelConfig.mockResolvedValue({ reasoning: true })
  })

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

  it('ignores stale reasoning responses after model changes', async () => {
    const modelId = ref<string | undefined>('gpt-old')
    const providerId = ref<string | undefined>('openai')
    const modelType = ref<'chat' | 'imageGeneration' | 'embedding' | 'rerank' | undefined>('chat')
    const oldResponse = deferred<{ reasoning: boolean }>()
    const newResponse = deferred<{ reasoning: boolean }>()

    getModelConfig.mockImplementation((model) =>
      model === 'gpt-old' ? oldResponse.promise : newResponse.promise
    )

    const api = useModelTypeDetection({ modelId, providerId, modelType })
    await vi.waitFor(() => expect(getModelConfig).toHaveBeenCalledTimes(1))

    modelId.value = 'gpt-new'
    await vi.waitFor(() => expect(getModelConfig).toHaveBeenCalledTimes(2))

    newResponse.resolve({ reasoning: false })
    await vi.waitFor(() => expect(api.modelReasoning.value).toBe(false))

    oldResponse.resolve({ reasoning: true })
    await Promise.resolve()

    expect(api.modelReasoning.value).toBe(false)
  })
})

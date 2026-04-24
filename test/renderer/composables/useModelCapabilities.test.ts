import { ref } from 'vue'
import { beforeEach, describe, it, expect, vi } from 'vitest'
const modelClient = vi.hoisted(() => ({
  supportsReasoningCapability: vi.fn(),
  getThinkingBudgetRange: vi.fn(),
  supportsSearchCapability: vi.fn(),
  getSearchDefaults: vi.fn()
}))

vi.mock('@api/ModelClient', () => ({
  createModelClient: vi.fn(() => modelClient)
}))

import { useModelCapabilities } from '@/composables/useModelCapabilities'

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((promiseResolve) => {
    resolve = promiseResolve
  })

  return { promise, resolve }
}

describe('useModelCapabilities', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('fetches capabilities and resets when ids missing', async () => {
    const providerId = ref<string | undefined>('openai')
    const modelId = ref<string | undefined>('gpt-4')
    modelClient.supportsReasoningCapability.mockResolvedValue(true)
    modelClient.getThinkingBudgetRange.mockResolvedValue({ min: 100, max: 200 })
    modelClient.supportsSearchCapability.mockResolvedValue(true)
    modelClient.getSearchDefaults.mockResolvedValue({
      default: true,
      forced: false,
      strategy: 'turbo'
    })

    const api = useModelCapabilities({ providerId, modelId })
    // initial immediate fetch occurs - wait for isLoading to become false
    await vi.waitFor(() => expect(api.isLoading.value).toBe(false))
    expect(api.supportsReasoning.value).toBe(true)
    expect(api.budgetRange.value?.max).toBe(200)
    expect(api.supportsSearch.value).toBe(true)
    expect(api.searchDefaults.value?.strategy).toBe('turbo')

    // reset path
    providerId.value = undefined
    await vi.waitFor(() => expect(api.isLoading.value).toBe(false))
    expect(api.supportsReasoning.value).toBeNull()
    expect(api.budgetRange.value).toBeNull()
  })

  it('ignores stale capability responses after model changes', async () => {
    const providerId = ref<string | undefined>('openai')
    const modelId = ref<string | undefined>('gpt-old')
    const oldResponse = {
      supportsReasoning: deferred<boolean>(),
      budgetRange: deferred<{ min: number; max: number }>(),
      supportsSearch: deferred<boolean>(),
      searchDefaults: deferred<{ strategy: 'turbo' | 'max' }>()
    }
    const newResponse = {
      supportsReasoning: deferred<boolean>(),
      budgetRange: deferred<{ min: number; max: number }>(),
      supportsSearch: deferred<boolean>(),
      searchDefaults: deferred<{ strategy: 'turbo' | 'max' }>()
    }

    modelClient.supportsReasoningCapability.mockImplementation((_provider, model) =>
      model === 'gpt-old'
        ? oldResponse.supportsReasoning.promise
        : newResponse.supportsReasoning.promise
    )
    modelClient.getThinkingBudgetRange.mockImplementation((_provider, model) =>
      model === 'gpt-old' ? oldResponse.budgetRange.promise : newResponse.budgetRange.promise
    )
    modelClient.supportsSearchCapability.mockImplementation((_provider, model) =>
      model === 'gpt-old' ? oldResponse.supportsSearch.promise : newResponse.supportsSearch.promise
    )
    modelClient.getSearchDefaults.mockImplementation((_provider, model) =>
      model === 'gpt-old' ? oldResponse.searchDefaults.promise : newResponse.searchDefaults.promise
    )

    const api = useModelCapabilities({ providerId, modelId })
    await vi.waitFor(() => expect(modelClient.supportsReasoningCapability).toHaveBeenCalledTimes(1))

    modelId.value = 'gpt-new'
    await vi.waitFor(() => expect(modelClient.supportsReasoningCapability).toHaveBeenCalledTimes(2))

    newResponse.supportsReasoning.resolve(false)
    newResponse.budgetRange.resolve({ min: 10, max: 20 })
    newResponse.supportsSearch.resolve(false)
    newResponse.searchDefaults.resolve({ strategy: 'max' })

    await vi.waitFor(() => expect(api.budgetRange.value?.max).toBe(20))
    expect(api.supportsReasoning.value).toBe(false)
    expect(api.supportsSearch.value).toBe(false)
    expect(api.searchDefaults.value?.strategy).toBe('max')

    oldResponse.supportsReasoning.resolve(true)
    oldResponse.budgetRange.resolve({ min: 100, max: 200 })
    oldResponse.supportsSearch.resolve(true)
    oldResponse.searchDefaults.resolve({ strategy: 'turbo' })
    await Promise.resolve()

    expect(api.budgetRange.value?.max).toBe(20)
    expect(api.supportsReasoning.value).toBe(false)
    expect(api.supportsSearch.value).toBe(false)
    expect(api.searchDefaults.value?.strategy).toBe('max')
  })
})

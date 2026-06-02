import { ref } from 'vue'
import { beforeEach, describe, it, expect, vi } from 'vitest'
const modelClient = vi.hoisted(() => ({
  getCapabilities: vi.fn()
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
    modelClient.getCapabilities.mockResolvedValue({
      supportsAudioInput: false,
      supportsReasoning: true,
      reasoningPortrait: {
        budget: { min: 100, max: 200, default: -1, auto: -1, off: 0, unit: 'tokens' }
      },
      thinkingBudgetRange: { min: 100, max: 200 },
      supportsSearch: true,
      searchDefaults: {
        default: true,
        forced: false,
        strategy: 'turbo'
      },
      supportsTemperatureControl: false,
      temperatureCapability: true
    })

    const api = useModelCapabilities({ providerId, modelId })
    // initial immediate fetch occurs - wait for isLoading to become false
    await vi.waitFor(() => expect(api.isLoading.value).toBe(false))
    expect(api.supportsReasoning.value).toBe(true)
    expect(api.budgetRange.value?.max).toBe(200)
    expect(api.budgetRange.value?.auto).toBe(-1)
    expect(api.budgetRange.value?.off).toBe(0)
    expect(api.budgetRange.value?.unit).toBe('tokens')
    expect(api.supportsSearch.value).toBe(true)
    expect(api.searchDefaults.value?.strategy).toBe('turbo')
    expect(api.supportsTemperatureControl.value).toBe(false)

    // reset path
    providerId.value = undefined
    await vi.waitFor(() => expect(api.isLoading.value).toBe(false))
    expect(api.supportsReasoning.value).toBeNull()
    expect(api.budgetRange.value).toBeNull()
    expect(api.supportsTemperatureControl.value).toBeNull()
  })

  it('falls back to temperatureCapability when supportsTemperatureControl is missing', async () => {
    const providerId = ref<string | undefined>('openai')
    const modelId = ref<string | undefined>('gpt-5-chat-latest')
    modelClient.getCapabilities.mockResolvedValue({
      supportsAudioInput: false,
      supportsReasoning: false,
      reasoningPortrait: null,
      thinkingBudgetRange: null,
      supportsSearch: false,
      searchDefaults: null,
      supportsTemperatureControl: null,
      temperatureCapability: true
    })

    const api = useModelCapabilities({ providerId, modelId })

    await vi.waitFor(() => expect(api.isLoading.value).toBe(false))
    expect(api.supportsTemperatureControl.value).toBe(true)
  })

  it('ignores stale capability responses after model changes', async () => {
    const providerId = ref<string | undefined>('openai')
    const modelId = ref<string | undefined>('gpt-old')
    const oldResponse = {
      capabilities: deferred<{
        supportsAudioInput: boolean
        supportsReasoning: boolean
        reasoningPortrait: { budget: { min: number; max: number } } | null
        thinkingBudgetRange: { min: number; max: number } | null
        supportsSearch: boolean
        searchDefaults: { strategy: 'turbo' | 'max' }
        supportsTemperatureControl: boolean
        temperatureCapability: boolean
      }>()
    }
    const newResponse = {
      capabilities: deferred<{
        supportsAudioInput: boolean
        supportsReasoning: boolean
        reasoningPortrait: { budget: { min: number; max: number } } | null
        thinkingBudgetRange: { min: number; max: number } | null
        supportsSearch: boolean
        searchDefaults: { strategy: 'turbo' | 'max' }
        supportsTemperatureControl: boolean
        temperatureCapability: boolean
      }>()
    }

    modelClient.getCapabilities.mockImplementation((_provider, model) =>
      model === 'gpt-old' ? oldResponse.capabilities.promise : newResponse.capabilities.promise
    )

    const api = useModelCapabilities({ providerId, modelId })
    await vi.waitFor(() => expect(modelClient.getCapabilities).toHaveBeenCalledTimes(1))

    modelId.value = 'gpt-new'
    await vi.waitFor(() => expect(modelClient.getCapabilities).toHaveBeenCalledTimes(2))

    newResponse.capabilities.resolve({
      supportsAudioInput: false,
      supportsReasoning: false,
      reasoningPortrait: { budget: { min: 10, max: 20 } },
      thinkingBudgetRange: null,
      supportsSearch: false,
      searchDefaults: { strategy: 'max' },
      supportsTemperatureControl: false,
      temperatureCapability: true
    })

    await vi.waitFor(() => expect(api.budgetRange.value?.max).toBe(20))
    expect(api.supportsReasoning.value).toBe(false)
    expect(api.supportsSearch.value).toBe(false)
    expect(api.searchDefaults.value?.strategy).toBe('max')
    expect(api.supportsTemperatureControl.value).toBe(false)

    oldResponse.capabilities.resolve({
      supportsAudioInput: false,
      supportsReasoning: true,
      reasoningPortrait: { budget: { min: 100, max: 200 } },
      thinkingBudgetRange: null,
      supportsSearch: true,
      searchDefaults: { strategy: 'turbo' },
      supportsTemperatureControl: true,
      temperatureCapability: true
    })
    await Promise.resolve()

    expect(api.budgetRange.value?.max).toBe(20)
    expect(api.supportsReasoning.value).toBe(false)
    expect(api.supportsSearch.value).toBe(false)
    expect(api.searchDefaults.value?.strategy).toBe('max')
    expect(api.supportsTemperatureControl.value).toBe(false)
  })
})

import { ref } from 'vue'
import { describe, it, expect } from 'vitest'
import { useModelCapabilities } from '@/composables/useModelCapabilities'

describe('useModelCapabilities', () => {
  it('fetches capabilities and resets when ids missing', async () => {
    const providerId = ref<string | undefined>('openai')
    const modelId = ref<string | undefined>('gpt-4')
    const mockPresenter: any = {
      supportsReasoningCapability: vi.fn().mockResolvedValue(true),
      getThinkingBudgetRange: vi.fn().mockResolvedValue({ min: 100, max: 200 }),
      supportsSearchCapability: vi.fn().mockResolvedValue(true),
      getSearchDefaults: vi
        .fn()
        .mockResolvedValue({ default: true, forced: false, strategy: 'turbo' }),
      supportsReasoningEffortCapability: vi.fn().mockResolvedValue(true),
      getReasoningEffortDefault: vi.fn().mockResolvedValue('medium'),
      supportsVerbosityCapability: vi.fn().mockResolvedValue(true),
      getVerbosityDefault: vi.fn().mockResolvedValue('high')
    }

    const api = useModelCapabilities({ providerId, modelId, configPresenter: mockPresenter })
    // initial immediate fetch occurs - wait for isLoading to become false
    await vi.waitFor(() => expect(api.isLoading.value).toBe(false))
    expect(api.supportsReasoning.value).toBe(true)
    expect(api.budgetRange.value?.max).toBe(200)
    expect(api.supportsSearch.value).toBe(true)
    expect(api.searchDefaults.value?.strategy).toBe('turbo')
    expect(api.supportsReasoningEffort.value).toBe(true)
    expect(api.reasoningEffortDefault.value).toBe('medium')
    expect(api.supportsVerbosity.value).toBe(true)
    expect(api.verbosityDefault.value).toBe('high')

    // reset path
    providerId.value = undefined
    await vi.waitFor(() => expect(api.isLoading.value).toBe(false))
    expect(api.supportsReasoning.value).toBeNull()
    expect(api.budgetRange.value).toBeNull()
    expect(api.supportsReasoningEffort.value).toBeNull()
  })
})

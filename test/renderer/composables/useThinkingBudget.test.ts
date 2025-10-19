import { ref, computed } from 'vue'
import { describe, it, expect } from 'vitest'
import { useThinkingBudget } from '@/composables/useThinkingBudget'

// mock i18n -> return the key so we can assert on it
vi.mock('vue-i18n', () => ({
  useI18n: () => ({ t: (k: string, _p?: any) => k })
}))

describe('useThinkingBudget', () => {
  it('computes showThinkingBudget only when reasoning supported and range provided', () => {
    const thinkingBudget = ref<number | undefined>(undefined)
    const budgetRange = ref<{ min?: number; max?: number; default?: number } | null>({
      min: 256,
      max: 4096
    })
    const modelReasoning = ref(true)
    const supportsReasoning = ref<boolean | null>(true)
    const isGeminiProvider = computed(() => false)

    const api = useThinkingBudget({
      thinkingBudget,
      budgetRange,
      modelReasoning,
      supportsReasoning,
      isGeminiProvider
    })
    expect(api.showThinkingBudget.value).toBe(true)

    supportsReasoning.value = null
    expect(api.showThinkingBudget.value).toBe(false)

    supportsReasoning.value = true
    budgetRange.value = null
    expect(api.showThinkingBudget.value).toBe(false)
  })

  it('validates range and returns translation keys; allows -1 for Gemini', () => {
    const thinkingBudget = ref<number | undefined>(128)
    const budgetRange = ref<{ min?: number; max?: number; default?: number } | null>({
      min: 256,
      max: 1024
    })
    const modelReasoning = ref(true)
    const supportsReasoning = ref<boolean | null>(true)
    const isGeminiProvider = computed(() => false)

    const api = useThinkingBudget({
      thinkingBudget,
      budgetRange,
      modelReasoning,
      supportsReasoning,
      isGeminiProvider
    })
    expect(api.validationError.value).toBe(
      'settings.model.modelConfig.thinkingBudget.validation.minValue'
    )

    thinkingBudget.value = 2048
    expect(api.validationError.value).toBe(
      'settings.model.modelConfig.thinkingBudget.validation.maxValue'
    )

    thinkingBudget.value = 512
    expect(api.validationError.value).toBe('')

    // Gemini special case
    const gemApi = useThinkingBudget({
      thinkingBudget: ref(-1),
      budgetRange,
      modelReasoning,
      supportsReasoning,
      isGeminiProvider: computed(() => true)
    })
    expect(gemApi.validationError.value).toBe('')
  })
})

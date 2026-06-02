import { ref } from 'vue'
import { describe, it, expect, vi } from 'vitest'
import { useThinkingBudget, type ThinkingBudgetRange } from '@/composables/useThinkingBudget'

// mock i18n -> return the key so we can assert on it
vi.mock('vue-i18n', () => ({
  useI18n: () => ({ t: (k: string, _p?: any) => k })
}))

describe('useThinkingBudget', () => {
  it('computes showThinkingBudget only when reasoning supported and range provided', () => {
    const thinkingBudget = ref<number | undefined>(undefined)
    const budgetRange = ref<ThinkingBudgetRange | null>({
      min: 256,
      max: 4096
    })
    const modelReasoning = ref(true)
    const supportsReasoning = ref<boolean | null>(true)

    const api = useThinkingBudget({
      thinkingBudget,
      budgetRange,
      modelReasoning,
      supportsReasoning
    })
    expect(api.showThinkingBudget.value).toBe(true)

    supportsReasoning.value = null
    expect(api.showThinkingBudget.value).toBe(false)

    supportsReasoning.value = true
    budgetRange.value = null
    expect(api.showThinkingBudget.value).toBe(false)

    budgetRange.value = { auto: -1 }
    expect(api.showThinkingBudget.value).toBe(true)
  })

  it('validates ranges and allows provider-db budget sentinels', () => {
    const thinkingBudget = ref<number | undefined>(128)
    const budgetRange = ref<ThinkingBudgetRange | null>({
      min: 256,
      max: 1024
    })
    const modelReasoning = ref(true)
    const supportsReasoning = ref<boolean | null>(true)

    const api = useThinkingBudget({
      thinkingBudget,
      budgetRange,
      modelReasoning,
      supportsReasoning
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

    thinkingBudget.value = -1
    expect(api.validationError.value).toBe(
      'settings.model.modelConfig.thinkingBudget.validation.minValue'
    )

    budgetRange.value = { min: 0, max: 24576, default: -1, auto: -1, off: 0, unit: 'tokens' }
    expect(api.validationError.value).toBe('')

    budgetRange.value = { min: 512, max: 24576, off: 0 }
    thinkingBudget.value = 0
    expect(api.validationError.value).toBe('')
  })
})

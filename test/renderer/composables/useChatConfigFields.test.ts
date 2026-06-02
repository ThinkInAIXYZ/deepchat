import { computed, ref } from 'vue'
import { describe, expect, it, vi } from 'vitest'
import { useChatConfigFields } from '@/composables/useChatConfigFields'
import type { ThinkingBudgetRange } from '@/composables/useThinkingBudget'

vi.mock('vue-i18n', () => ({
  useI18n: () => ({ t: (key: string) => key })
}))

function createFields(
  supportsTemperatureControl: boolean | null,
  options: {
    showThinkingBudget?: boolean
    thinkingBudget?: number
    budgetRange?: ThinkingBudgetRange | null
  } = {}
) {
  return useChatConfigFields({
    temperature: ref(0.7),
    contextLength: ref(4096),
    maxTokens: ref(1024),
    contextLengthLimit: ref(undefined),
    maxTokensLimit: ref(undefined),
    thinkingBudget: ref(options.thinkingBudget),
    reasoningEffort: ref(undefined),
    verbosity: ref(undefined),
    providerId: ref('openai'),
    supportsTemperatureControl: ref(supportsTemperatureControl),
    showThinkingBudget: computed(() => options.showThinkingBudget ?? false),
    thinkingBudgetError: computed(() => ''),
    budgetRange: ref(options.budgetRange ?? null),
    formatSize: (size: number) => String(size),
    emit: vi.fn()
  })
}

describe('useChatConfigFields', () => {
  it('hides temperature when capabilities explicitly disable temperature control', () => {
    const { sliderFields } = createFields(false)

    expect(sliderFields.value.some((field) => field.key === 'temperature')).toBe(false)
  })

  it('shows temperature when capabilities support temperature control', () => {
    const { sliderFields } = createFields(true)

    expect(sliderFields.value.some((field) => field.key === 'temperature')).toBe(true)
  })

  it('shows temperature while temperature capability is unknown', () => {
    const { sliderFields } = createFields(null)

    expect(sliderFields.value.some((field) => field.key === 'temperature')).toBe(true)
  })

  it('expands thinking budget input bounds to include sentinels', () => {
    const autoFields = createFields(true, {
      showThinkingBudget: true,
      budgetRange: { min: 128, max: 24576, auto: -1, unit: 'tokens' }
    })
    const autoBudgetField = autoFields.inputFields.value.find(
      (field) => field.key === 'thinkingBudget'
    )

    expect(autoBudgetField?.min).toBe(-1)
    expect(autoBudgetField?.max).toBe(24576)

    const offFields = createFields(true, {
      showThinkingBudget: true,
      budgetRange: { min: 512, max: 24576, off: 0, unit: 'tokens' }
    })
    const offBudgetField = offFields.inputFields.value.find(
      (field) => field.key === 'thinkingBudget'
    )

    expect(offBudgetField?.min).toBe(0)
    expect(offBudgetField?.max).toBe(24576)
  })
})

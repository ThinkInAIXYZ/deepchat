import { computed, ref } from 'vue'
import { describe, expect, it, vi } from 'vitest'
import { useChatConfigFields } from '@/composables/useChatConfigFields'
import type { GenerationParameterControl } from '@/composables/useModelCapabilities'
import type { ThinkingBudgetRange } from '@/composables/useThinkingBudget'

vi.mock('vue-i18n', () => ({
  useI18n: () => ({ t: (key: string) => key })
}))

function createFields(
  temperatureControl: GenerationParameterControl,
  options: {
    showThinkingBudget?: boolean
    thinkingBudget?: number
    budgetRange?: ThinkingBudgetRange | null
  } = {}
) {
  const emit = vi.fn()
  return {
    ...useChatConfigFields({
      temperature: ref(0.7),
      contextLength: ref(4096),
      maxTokens: ref(1024),
      contextLengthLimit: ref(undefined),
      maxTokensLimit: ref(undefined),
      thinkingBudget: ref(options.thinkingBudget),
      reasoningEffort: ref(undefined),
      verbosity: ref(undefined),
      providerId: ref('openai'),
      temperatureControl: computed(() => temperatureControl),
      showThinkingBudget: computed(() => options.showThinkingBudget ?? false),
      thinkingBudgetError: computed(() => ''),
      budgetRange: ref(options.budgetRange ?? null),
      formatSize: (size: number) => String(size),
      emit
    }),
    emit
  }
}

describe('useChatConfigFields', () => {
  it('hides temperature when effective policy omits it', () => {
    const { sliderFields } = createFields({ mode: 'hidden' })

    expect(sliderFields.value.some((field) => field.key === 'temperature')).toBe(false)
  })

  it('shows editable temperature when effective policy passes it through', () => {
    const { sliderFields } = createFields({ mode: 'editable' })

    expect(sliderFields.value.some((field) => field.key === 'temperature')).toBe(true)
  })

  it('shows fixed temperature as a disabled policy value', () => {
    const { emit, sliderFields } = createFields({ mode: 'fixed', value: 1 })
    const temperature = sliderFields.value.find((field) => field.key === 'temperature')

    expect(temperature).toMatchObject({
      disabled: true,
      hint: 'settings.model.temperatureFixedByPolicy'
    })
    expect(temperature?.getValue()).toBe(1)
    temperature?.setValue(0.4)
    expect(emit).not.toHaveBeenCalled()
  })

  it('expands thinking budget input bounds to include sentinels', () => {
    const autoFields = createFields(
      { mode: 'editable' },
      {
        showThinkingBudget: true,
        budgetRange: { min: 128, max: 24576, auto: -1, unit: 'tokens' }
      }
    )
    const autoBudgetField = autoFields.inputFields.value.find(
      (field) => field.key === 'thinkingBudget'
    )

    expect(autoBudgetField?.min).toBe(-1)
    expect(autoBudgetField?.max).toBe(24576)

    const offFields = createFields(
      { mode: 'editable' },
      {
        showThinkingBudget: true,
        budgetRange: { min: 512, max: 24576, off: 0, unit: 'tokens' }
      }
    )
    const offBudgetField = offFields.inputFields.value.find(
      (field) => field.key === 'thinkingBudget'
    )

    expect(offBudgetField?.min).toBe(0)
    expect(offBudgetField?.max).toBe(24576)
  })
})

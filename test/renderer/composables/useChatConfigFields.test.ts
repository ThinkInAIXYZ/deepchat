import { computed, ref } from 'vue'
import { describe, expect, it, vi } from 'vitest'
import { useChatConfigFields } from '@/composables/useChatConfigFields'

vi.mock('vue-i18n', () => ({
  useI18n: () => ({ t: (key: string) => key })
}))

function createFields(supportsTemperatureControl: boolean | null) {
  return useChatConfigFields({
    temperature: ref(0.7),
    contextLength: ref(4096),
    maxTokens: ref(1024),
    contextLengthLimit: ref(undefined),
    maxTokensLimit: ref(undefined),
    thinkingBudget: ref(undefined),
    reasoningEffort: ref(undefined),
    verbosity: ref(undefined),
    providerId: ref('openai'),
    supportsTemperatureControl: ref(supportsTemperatureControl),
    showThinkingBudget: computed(() => false),
    thinkingBudgetError: computed(() => ''),
    budgetRange: ref(null),
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
})

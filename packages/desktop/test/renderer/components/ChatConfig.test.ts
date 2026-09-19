import { defineComponent } from 'vue'
import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const modelClient = vi.hoisted(() => ({
  getCapabilities: vi.fn()
}))

vi.mock('@api/ModelClient', () => ({
  createModelClient: vi.fn(() => modelClient)
}))

vi.mock('@/stores/language', () => ({
  useLanguageStore: () => ({ dir: 'ltr' })
}))

vi.mock('@/stores/modelConfigStore', () => ({
  useModelConfigStore: () => ({
    getModelConfig: vi.fn().mockResolvedValue({ reasoning: false })
  })
}))

vi.mock('vue-i18n', () => ({
  useI18n: () => ({
    t: (key: string) => key
  })
}))

const passthrough = (name: string) =>
  defineComponent({
    name,
    template: '<div><slot /></div>'
  })

const FieldStub = defineComponent({
  name: 'ConfigSliderField',
  props: {
    label: { type: String, required: true }
  },
  template: '<div data-testid="config-slider-field" :data-label="label">{{ label }}</div>'
})

const createK3Capabilities = () => ({
  identity: {
    providerId: 'aihubmix',
    requestModelId: 'kimi-k3',
    catalogMatched: true as const,
    catalogModelId: 'kimi-k3'
  },
  requestPolicy: {
    temperature: { mode: 'omit' as const },
    topP: { mode: 'omit' as const },
    reasoning: { mode: 'fixed' as const, value: true },
    legacyThinking: { mode: 'omit' as const }
  },
  supportsAudioInput: false,
  supportsReasoning: true,
  reasoningPortrait: {
    supported: true,
    defaultEnabled: true,
    mode: 'effort' as const,
    effort: 'max' as const,
    effortOptions: ['low', 'high', 'max'] as const
  },
  thinkingBudgetRange: {},
  supportsSearch: false,
  searchDefaults: {},
  supportsTemperatureControl: true,
  temperatureCapability: null,
  supportsReasoningEffort: true,
  reasoningEffortDefault: 'max' as const,
  supportsVerbosity: false,
  verbosityDefault: undefined
})

const mountChatConfig = async () => {
  const ChatConfig = (await import('@/components/ChatConfig.vue')).default
  return mount(ChatConfig, {
    props: {
      temperature: 0.7,
      contextLength: 32000,
      maxTokens: 4096,
      artifacts: 0,
      providerId: 'aihubmix',
      modelId: 'kimi-k3',
      modelType: 'chat'
    },
    global: {
      stubs: {
        ConfigSliderField: FieldStub,
        ConfigInputField: passthrough('ConfigInputField'),
        ConfigSelectField: passthrough('ConfigSelectField'),
        Label: passthrough('Label'),
        Textarea: passthrough('Textarea'),
        Tooltip: passthrough('Tooltip'),
        TooltipContent: passthrough('TooltipContent'),
        TooltipProvider: passthrough('TooltipProvider'),
        TooltipTrigger: passthrough('TooltipTrigger')
      }
    }
  })
}

describe('ChatConfig generation policy', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('keeps the first control slot stable while loading and hides Aihubmix K3 at steady state', async () => {
    let resolveCapabilities!: (value: ReturnType<typeof createK3Capabilities>) => void
    modelClient.getCapabilities.mockReturnValue(
      new Promise<ReturnType<typeof createK3Capabilities>>((resolve) => {
        resolveCapabilities = resolve
      })
    )

    const wrapper = await mountChatConfig()

    expect(wrapper.find('[data-testid="generation-parameter-loading"]').exists()).toBe(true)
    expect(wrapper.text()).not.toContain('settings.model.temperature.label')

    resolveCapabilities(createK3Capabilities())
    await flushPromises()

    expect(wrapper.find('[data-testid="generation-parameter-loading"]').exists()).toBe(false)
    expect(wrapper.text()).not.toContain('settings.model.temperature.label')
    expect(
      wrapper
        .findAll('[data-testid="config-slider-field"]')
        .map((field) => field.attributes('data-label'))
    ).toEqual(['settings.model.contextLength.label', 'settings.model.responseLength.label'])
  })

  it('silently hides generation controls when capability loading fails', async () => {
    modelClient.getCapabilities.mockRejectedValue(new Error('ipc unavailable'))

    const wrapper = await mountChatConfig()
    await flushPromises()

    expect(wrapper.find('[data-testid="generation-parameter-loading"]').exists()).toBe(false)
    expect(wrapper.text()).not.toContain('settings.model.temperature.label')
    expect(
      wrapper
        .findAll('[data-testid="config-slider-field"]')
        .map((field) => field.attributes('data-label'))
    ).toEqual(['settings.model.contextLength.label', 'settings.model.responseLength.label'])
  })
})

import { describe, expect, it, vi } from 'vitest'
import { defineComponent, reactive } from 'vue'
import { flushPromises, mount } from '@vue/test-utils'

type SetupOptions = {
  agentId?: string
  hasActiveSession?: boolean
  activeProviderId?: string
  activeModelId?: string
  supportsEffort?: boolean
}

const passthrough = (name: string) =>
  defineComponent({
    name,
    template: '<div><slot /></div>'
  })

const ButtonStub = defineComponent({
  name: 'Button',
  emits: ['click'],
  template: '<button @click="$emit(\'click\')"><slot /></button>'
})

const SliderStub = defineComponent({
  name: 'Slider',
  props: {
    modelValue: { type: Array, default: () => [] }
  },
  emits: ['update:modelValue'],
  template: '<div class="slider-stub" />'
})

const InputStub = defineComponent({
  name: 'Input',
  props: {
    modelValue: { type: String, default: '' }
  },
  emits: ['update:modelValue'],
  template: '<input class="input-stub" />'
})

const setup = async (options: SetupOptions = {}) => {
  vi.resetModules()

  const modelLookup = new Map([
    ['gpt-4', { model: { id: 'gpt-4', name: 'GPT-4' } }],
    ['acp-agent', { model: { id: 'acp-agent', name: 'ACP Agent' } }]
  ])

  const themeStore = reactive({
    isDark: false
  })

  const chatStore = reactive({
    chatConfig: {
      providerId: 'openai',
      modelId: 'gpt-4'
    },
    updateChatConfig: vi.fn().mockResolvedValue(undefined)
  })

  const modelStore = reactive({
    enabledModels: [
      {
        providerId: 'openai',
        models: [{ id: 'gpt-4', name: 'GPT-4' }]
      },
      {
        providerId: 'acp',
        models: [{ id: 'acp-agent', name: 'ACP Agent' }]
      }
    ],
    findModelByIdOrName: vi.fn((value: string) => modelLookup.get(value) ?? null)
  })

  const agentId = options.agentId ?? 'deepchat'
  const agentStore = reactive({
    selectedAgentId: agentId,
    selectedAgent:
      agentId === 'deepchat'
        ? null
        : {
            id: agentId,
            name: 'ACP Agent',
            type: 'acp' as const,
            enabled: true
          }
  })

  const hasActiveSession = options.hasActiveSession ?? false
  const sessionStore = reactive({
    hasActiveSession,
    activeSessionId: hasActiveSession ? 's1' : null,
    activeSession: hasActiveSession
      ? {
          id: 's1',
          providerId: options.activeProviderId ?? 'openai',
          modelId: options.activeModelId ?? 'gpt-4',
          status: 'idle'
        }
      : null
  })

  const draftStore = reactive({
    providerId: undefined as string | undefined,
    modelId: undefined as string | undefined,
    permissionMode: 'full_access' as const,
    systemPrompt: undefined as string | undefined,
    temperature: undefined as number | undefined,
    contextLength: undefined as number | undefined,
    maxTokens: undefined as number | undefined,
    thinkingBudget: undefined as number | undefined,
    reasoningEffort: undefined as 'minimal' | 'low' | 'medium' | 'high' | undefined,
    verbosity: undefined as 'low' | 'medium' | 'high' | undefined,
    updateGenerationSettings: vi.fn((patch: Record<string, unknown>) =>
      Object.assign(draftStore, patch)
    )
  })

  const configPresenter = {
    getSetting: vi.fn().mockImplementation((key: string) => {
      if (key === 'defaultModel') {
        return Promise.resolve({ providerId: 'openai', modelId: 'gpt-4' })
      }
      return Promise.resolve(undefined)
    }),
    setSetting: vi.fn().mockResolvedValue(undefined),
    getModelConfig: vi.fn().mockReturnValue({
      temperature: 0.7,
      contextLength: 8192,
      maxTokens: 4096,
      thinkingBudget: 512,
      reasoningEffort: 'medium',
      verbosity: 'medium'
    }),
    getDefaultSystemPrompt: vi.fn().mockResolvedValue('Default prompt'),
    supportsReasoningCapability: vi.fn().mockReturnValue(true),
    getThinkingBudgetRange: vi.fn().mockReturnValue({ min: 0, max: 8192, default: 512 }),
    supportsReasoningEffortCapability: vi.fn().mockReturnValue(options.supportsEffort ?? true),
    getReasoningEffortDefault: vi.fn().mockReturnValue('medium'),
    supportsVerbosityCapability: vi.fn().mockReturnValue(true),
    getVerbosityDefault: vi.fn().mockReturnValue('medium'),
    getSystemPrompts: vi.fn().mockResolvedValue([
      {
        id: 'preset-default',
        name: 'Preset Default',
        content: 'Default prompt'
      }
    ])
  }

  const baseSessionSettings = {
    systemPrompt: 'Default prompt',
    temperature: 0.7,
    contextLength: 8192,
    maxTokens: 2048,
    thinkingBudget: 512,
    reasoningEffort: 'medium' as const,
    verbosity: 'medium' as const
  }

  const newAgentPresenter = {
    getPermissionMode: vi.fn().mockResolvedValue('full_access'),
    setPermissionMode: vi.fn().mockResolvedValue(undefined),
    getSessionGenerationSettings: vi.fn().mockResolvedValue(baseSessionSettings),
    updateSessionGenerationSettings: vi
      .fn()
      .mockImplementation((_: string, patch: any) =>
        Promise.resolve({ ...baseSessionSettings, ...patch })
      )
  }

  vi.doMock('@/stores/theme', () => ({
    useThemeStore: () => themeStore
  }))
  vi.doMock('@/stores/chat', () => ({
    useChatStore: () => chatStore
  }))
  vi.doMock('@/stores/modelStore', () => ({
    useModelStore: () => modelStore
  }))
  vi.doMock('@/stores/ui/agent', () => ({
    useAgentStore: () => agentStore
  }))
  vi.doMock('@/stores/ui/session', () => ({
    useSessionStore: () => sessionStore
  }))
  vi.doMock('@/stores/ui/draft', () => ({
    useDraftStore: () => draftStore
  }))
  vi.doMock('@/composables/usePresenter', () => ({
    usePresenter: (name: string) =>
      name === 'configPresenter' ? configPresenter : newAgentPresenter
  }))
  vi.doMock('vue-i18n', () => ({
    useI18n: () => ({
      t: (key: string) => key
    })
  }))
  vi.doMock('@iconify/vue', () => ({
    Icon: defineComponent({
      name: 'Icon',
      template: '<span class="icon-stub" />'
    })
  }))

  const ChatStatusBar = (await import('@/components/chat/ChatStatusBar.vue')).default
  const wrapper = mount(ChatStatusBar, {
    global: {
      stubs: {
        Button: ButtonStub,
        Slider: SliderStub,
        Input: InputStub,
        DropdownMenu: passthrough('DropdownMenu'),
        DropdownMenuContent: passthrough('DropdownMenuContent'),
        DropdownMenuItem: passthrough('DropdownMenuItem'),
        DropdownMenuTrigger: passthrough('DropdownMenuTrigger'),
        Select: passthrough('Select'),
        SelectContent: passthrough('SelectContent'),
        SelectItem: passthrough('SelectItem'),
        SelectTrigger: passthrough('SelectTrigger'),
        SelectValue: passthrough('SelectValue'),
        ModelIcon: true,
        Icon: true
      }
    }
  })

  await flushPromises()

  return {
    wrapper,
    newAgentPresenter
  }
}

describe('ChatStatusBar advanced settings', () => {
  it('shows advanced settings in default agent and hides in ACP', async () => {
    const deepchat = await setup({ agentId: 'deepchat', hasActiveSession: false })
    expect((deepchat.wrapper.vm as any).showAdvancedSettingsButton).toBe(true)

    const acp = await setup({ agentId: 'acp-agent', hasActiveSession: false })
    expect((acp.wrapper.vm as any).showAdvancedSettingsButton).toBe(false)
  })

  it('shows effort selector only when model capability supports it', async () => {
    const enabled = await setup({
      hasActiveSession: true,
      activeProviderId: 'openai',
      activeModelId: 'gpt-4',
      supportsEffort: true
    })
    expect((enabled.wrapper.vm as any).showEffortSelector).toBe(true)

    const disabled = await setup({
      hasActiveSession: true,
      activeProviderId: 'openai',
      activeModelId: 'gpt-4',
      supportsEffort: false
    })
    expect((disabled.wrapper.vm as any).showEffortSelector).toBe(false)
  })

  it('debounces generation setting persistence to a single session update', async () => {
    vi.useFakeTimers()

    const { wrapper, newAgentPresenter } = await setup({
      hasActiveSession: true,
      activeProviderId: 'openai',
      activeModelId: 'gpt-4'
    })

    ;(wrapper.vm as any).onTemperatureSlider([0.9])
    ;(wrapper.vm as any).onTemperatureSlider([1.1])
    ;(wrapper.vm as any).onTemperatureSlider([1.2])

    vi.advanceTimersByTime(299)
    await flushPromises()
    expect(newAgentPresenter.updateSessionGenerationSettings).not.toHaveBeenCalled()

    vi.advanceTimersByTime(1)
    await flushPromises()

    expect(newAgentPresenter.updateSessionGenerationSettings).toHaveBeenCalledTimes(1)
    expect(newAgentPresenter.updateSessionGenerationSettings).toHaveBeenCalledWith(
      's1',
      expect.objectContaining({ temperature: 1.2 })
    )

    vi.runOnlyPendingTimers()
    vi.useRealTimers()
  })
})

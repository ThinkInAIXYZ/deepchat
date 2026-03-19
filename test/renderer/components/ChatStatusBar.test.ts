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
  props: {
    disabled: { type: Boolean, default: false }
  },
  emits: ['click'],
  template:
    '<button v-bind="$attrs" :disabled="disabled" @click="$emit(\'click\')"><slot /></button>'
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
    ['claude-3-5-sonnet', { model: { id: 'claude-3-5-sonnet', name: 'Claude 3.5 Sonnet' } }],
    ['acp-agent', { model: { id: 'acp-agent', name: 'ACP Agent' } }],
    ['dimcode-acp', { model: { id: 'dimcode-acp', name: 'DimCode - Default' } }]
  ])

  const themeStore = reactive({
    isDark: false
  })

  const modelStore = reactive({
    enabledModels: [
      {
        providerId: 'openai',
        models: [{ id: 'gpt-4', name: 'GPT-4' }]
      },
      {
        providerId: 'anthropic',
        models: [{ id: 'claude-3-5-sonnet', name: 'Claude 3.5 Sonnet' }]
      },
      {
        providerId: 'acp',
        models: [
          { id: 'acp-agent', name: 'ACP Agent' },
          { id: 'dimcode-acp', name: 'DimCode - Default' }
        ]
      }
    ],
    findModelByIdOrName: vi.fn((value: string) => modelLookup.get(value) ?? null)
  })

  const providerStore = reactive({
    sortedProviders: [
      { id: 'openai', name: 'OpenAI', enable: true },
      { id: 'anthropic', name: 'Anthropic', enable: true },
      { id: 'acp', name: 'ACP', enable: true }
    ]
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
      : null,
    setSessionModel: vi.fn().mockResolvedValue(undefined)
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
      contextLength: 16000,
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
    contextLength: 16000,
    maxTokens: 4096,
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
  vi.doMock('@/stores/modelStore', () => ({
    useModelStore: () => modelStore
  }))
  vi.doMock('@/stores/providerStore', () => ({
    useProviderStore: () => providerStore
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
      props: {
        icon: { type: String, default: '' }
      },
      template: '<span class="icon-stub" :data-icon="icon" />'
    })
  }))
  vi.doMock('@/components/chat-input/McpIndicator.vue', () => ({
    default: defineComponent({
      name: 'McpIndicator',
      props: {
        showSystemPromptSection: { type: Boolean, default: false }
      },
      template:
        '<div class="mcp-indicator-stub" :data-show-system-prompt-section="String(showSystemPromptSection)" />'
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
        Popover: passthrough('Popover'),
        PopoverContent: passthrough('PopoverContent'),
        PopoverTrigger: passthrough('PopoverTrigger'),
        Select: passthrough('Select'),
        SelectContent: passthrough('SelectContent'),
        SelectItem: passthrough('SelectItem'),
        SelectTrigger: passthrough('SelectTrigger'),
        SelectValue: passthrough('SelectValue'),
        ModelIcon: defineComponent({
          name: 'ModelIcon',
          props: {
            modelId: { type: String, default: '' }
          },
          template: '<div class="model-icon-stub" :data-model-id="modelId" />'
        }),
        Icon: true
      }
    }
  })

  await flushPromises()

  return {
    wrapper,
    newAgentPresenter,
    sessionStore,
    draftStore,
    configPresenter
  }
}

describe('ChatStatusBar model and session panels', () => {
  it('passes system prompt section to the unified session panel in deepchat and hides it in ACP', async () => {
    const deepchat = await setup({ agentId: 'deepchat', hasActiveSession: false })
    expect(
      deepchat.wrapper.find('.mcp-indicator-stub').attributes('data-show-system-prompt-section')
    ).toBe('true')

    const acp = await setup({ agentId: 'acp-agent', hasActiveSession: false })
    expect(
      acp.wrapper.find('.mcp-indicator-stub').attributes('data-show-system-prompt-section')
    ).toBe('false')
  })

  it('shows reasoning effort controls only when model capability supports it', async () => {
    const enabled = await setup({
      hasActiveSession: true,
      activeProviderId: 'openai',
      activeModelId: 'gpt-4',
      supportsEffort: true
    })
    await (enabled.wrapper.vm as any).openModelSettings('openai', 'gpt-4')
    await flushPromises()

    expect((enabled.wrapper.vm as any).showReasoningEffort).toBe(true)
    expect(enabled.wrapper.text()).toContain('settings.model.modelConfig.reasoningEffort.label')

    const disabled = await setup({
      hasActiveSession: true,
      activeProviderId: 'openai',
      activeModelId: 'gpt-4',
      supportsEffort: false
    })
    await (disabled.wrapper.vm as any).openModelSettings('openai', 'gpt-4')
    await flushPromises()

    expect((disabled.wrapper.vm as any).showReasoningEffort).toBe(false)
    expect(disabled.wrapper.text()).not.toContain(
      'settings.model.modelConfig.reasoningEffort.label'
    )
  })

  it('uses unified defaults for draft model settings', async () => {
    const { wrapper } = await setup({ agentId: 'deepchat', hasActiveSession: false })

    expect((wrapper.vm as any).localSettings.contextLength).toBe(16000)
    expect((wrapper.vm as any).localSettings.maxTokens).toBe(4096)
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

  it('switches active non-ACP session model via session store', async () => {
    const { wrapper, sessionStore } = await setup({
      agentId: 'deepchat',
      hasActiveSession: true,
      activeProviderId: 'openai',
      activeModelId: 'gpt-4'
    })

    await (wrapper.vm as any).selectModel('anthropic', 'claude-3-5-sonnet')

    expect(sessionStore.setSessionModel).toHaveBeenCalledWith(
      's1',
      'anthropic',
      'claude-3-5-sonnet'
    )
  })

  it('reloads active session generation settings after switching models', async () => {
    const { wrapper, sessionStore, newAgentPresenter } = await setup({
      agentId: 'deepchat',
      hasActiveSession: true,
      activeProviderId: 'openai',
      activeModelId: 'gpt-4'
    })

    const nextSettings = {
      systemPrompt: 'Keep this prompt',
      temperature: 0.2,
      contextLength: 32000,
      maxTokens: 2048,
      thinkingBudget: 256,
      reasoningEffort: 'low' as const,
      verbosity: 'high' as const
    }

    sessionStore.setSessionModel.mockImplementation(async () => {
      if (sessionStore.activeSession) {
        sessionStore.activeSession.providerId = 'anthropic'
        sessionStore.activeSession.modelId = 'claude-3-5-sonnet'
      }
    })
    newAgentPresenter.getSessionGenerationSettings.mockClear()
    newAgentPresenter.getSessionGenerationSettings.mockResolvedValue(nextSettings)

    await (wrapper.vm as any).selectModel('anthropic', 'claude-3-5-sonnet')
    await flushPromises()

    expect(newAgentPresenter.getSessionGenerationSettings).toHaveBeenCalledWith('s1')
    expect((wrapper.vm as any).localSettings).toEqual(nextSettings)
  })

  it('updates draft model and preferred model when no active session', async () => {
    const { wrapper, sessionStore, draftStore, configPresenter } = await setup({
      agentId: 'deepchat',
      hasActiveSession: false
    })

    await (wrapper.vm as any).selectModel('anthropic', 'claude-3-5-sonnet')

    expect(sessionStore.setSessionModel).not.toHaveBeenCalled()
    expect(draftStore.providerId).toBe('anthropic')
    expect(draftStore.modelId).toBe('claude-3-5-sonnet')
    expect(configPresenter.setSetting).toHaveBeenCalledWith('preferredModel', {
      providerId: 'anthropic',
      modelId: 'claude-3-5-sonnet'
    })
  })

  it('uses ACP model id for the displayed icon', async () => {
    const { wrapper } = await setup({
      agentId: 'dimcode-acp',
      hasActiveSession: true,
      activeProviderId: 'acp',
      activeModelId: 'dimcode-acp'
    })

    expect(wrapper.find('.model-icon-stub').attributes('data-model-id')).toBe('dimcode-acp')
  })
})

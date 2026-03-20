import { describe, expect, it, vi } from 'vitest'
import { defineComponent, reactive } from 'vue'
import { flushPromises, mount } from '@vue/test-utils'
import { ACP_WORKSPACE_EVENTS } from '@/events'
import type { ReasoningPortrait } from '../../../src/shared/types/model-db'
import type { AcpConfigState } from '../../../src/shared/types/presenters'

type ReasoningEffort = 'minimal' | 'low' | 'medium' | 'high'
type TestGenerationSettings = {
  systemPrompt: string
  temperature: number
  contextLength: number
  maxTokens: number
  thinkingBudget: number
  reasoningEffort: ReasoningEffort
  verbosity: 'low' | 'medium' | 'high'
}

type ExtraModelGroup = {
  providerId: string
  providerName: string
  models: Array<{ id: string; name: string }>
}

type SetupOptions = {
  agentId?: string
  hasActiveSession?: boolean
  activeProviderId?: string
  activeModelId?: string
  activeProjectDir?: string | null
  supportsEffort?: boolean
  setSessionModelError?: Error
  defaultModel?: { providerId: string; modelId: string } | null
  preferredModel?: { providerId: string; modelId: string } | null
  extraModelGroups?: ExtraModelGroup[]
  reasoningEffortDefault?: ReasoningEffort
  sessionSettings?: Partial<TestGenerationSettings>
  reasoningPortrait?: ReasoningPortrait | null
  projectPath?: string | null
  acpDraftSessionId?: string | null
  acpProcessConfig?: AcpConfigState | null
  acpSessionConfig?: AcpConfigState | null
}

const createDeferred = <T>() => {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
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
    '<button v-bind="$attrs" :disabled="disabled" @click="$emit(\'click\', $event)"><slot /></button>'
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

const SelectStub = defineComponent({
  name: 'Select',
  props: {
    modelValue: { type: [String, Boolean], default: undefined }
  },
  emits: ['update:modelValue'],
  template: '<div class="select-stub" :data-model-value="String(modelValue ?? \'\')"><slot /></div>'
})

const SwitchStub = defineComponent({
  name: 'Switch',
  props: {
    modelValue: { type: Boolean, default: false },
    disabled: { type: Boolean, default: false }
  },
  emits: ['update:modelValue'],
  template:
    '<button class="switch-stub" :data-model-value="String(modelValue)" :disabled="disabled" @click="$emit(\'update:modelValue\', !modelValue)" />'
})

const createAcpConfigState = (
  overrides: Partial<AcpConfigState> = {},
  modelValue = 'gpt-5'
): AcpConfigState => ({
  source: 'configOptions',
  options: [
    {
      id: 'model',
      label: 'Model',
      type: 'select',
      category: 'model',
      currentValue: modelValue,
      options: [
        { value: 'gpt-5', label: 'gpt-5' },
        { value: 'gpt-5-mini', label: 'gpt-5-mini' }
      ]
    },
    {
      id: 'thought_level',
      label: 'Thought Level',
      type: 'select',
      category: 'thought_level',
      currentValue: 'medium',
      options: [
        { value: 'low', label: 'low' },
        { value: 'medium', label: 'medium' },
        { value: 'high', label: 'high' }
      ]
    },
    {
      id: 'mode',
      label: 'Mode',
      type: 'select',
      category: 'mode',
      currentValue: 'code',
      options: [
        { value: 'code', label: 'code' },
        { value: 'ask', label: 'ask' }
      ]
    },
    {
      id: 'safe_edits',
      label: 'Safe Edits',
      type: 'boolean',
      currentValue: true
    }
  ],
  ...overrides
})

const createOverflowAcpConfigState = (): AcpConfigState => ({
  source: 'configOptions',
  options: [
    ...createAcpConfigState().options,
    {
      id: 'extra_select',
      label: 'Extra Select',
      type: 'select',
      currentValue: 'strict',
      options: [
        { value: 'strict', label: 'Strict' },
        { value: 'relaxed', label: 'Relaxed' }
      ]
    },
    {
      id: 'extra_toggle',
      label: 'Extra Toggle',
      type: 'boolean',
      currentValue: false
    }
  ]
})

const setup = async (options: SetupOptions = {}) => {
  vi.resetModules()

  const extraModelGroups = options.extraModelGroups ?? []
  const reasoningEffortDefault = options.reasoningEffortDefault ?? 'medium'
  const reasoningPortrait =
    options.reasoningPortrait ??
    ({
      supported: true,
      defaultEnabled: true,
      mode: 'effort',
      budget: { min: 0, max: 8192, default: 512 },
      ...(options.supportsEffort === false
        ? {}
        : {
            effort: reasoningEffortDefault,
            effortOptions: ['minimal', 'low', 'medium', 'high'] as ReasoningEffort[]
          }),
      verbosity: 'medium',
      verbosityOptions: ['low', 'medium', 'high'] as Array<'low' | 'medium' | 'high'>
    } satisfies ReasoningPortrait)
  const baseModelGroups = [
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
  ]
  const modelLookup = new Map([
    ['gpt-4', { model: { id: 'gpt-4', name: 'GPT-4' } }],
    ['claude-3-5-sonnet', { model: { id: 'claude-3-5-sonnet', name: 'Claude 3.5 Sonnet' } }],
    ['acp-agent', { model: { id: 'acp-agent', name: 'ACP Agent' } }],
    ['dimcode-acp', { model: { id: 'dimcode-acp', name: 'DimCode - Default' } }]
  ])
  extraModelGroups.forEach((group) => {
    group.models.forEach((model) => {
      modelLookup.set(model.id, { model })
    })
  })

  const themeStore = reactive({
    isDark: false
  })

  const modelStore = reactive({
    enabledModels: [...baseModelGroups, ...extraModelGroups],
    findModelByIdOrName: vi.fn((value: string) => modelLookup.get(value) ?? null)
  })

  const providerStore = reactive({
    sortedProviders: [
      { id: 'openai', name: 'OpenAI', enable: true },
      { id: 'anthropic', name: 'Anthropic', enable: true },
      { id: 'acp', name: 'ACP', enable: true }
    ].concat(
      extraModelGroups.map((group) => ({
        id: group.providerId,
        name: group.providerName,
        enable: true
      }))
    )
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
          projectDir: options.activeProjectDir ?? options.projectPath ?? null,
          status: 'idle'
        }
      : null,
    setSessionModel: options.setSessionModelError
      ? vi.fn().mockRejectedValue(options.setSessionModelError)
      : vi.fn().mockResolvedValue(undefined)
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

  const projectStore = reactive({
    selectedProject: options.projectPath
      ? {
          path: options.projectPath
        }
      : null
  })

  const configPresenter = {
    getSetting: vi.fn().mockImplementation((key: string) => {
      if (key === 'preferredModel') {
        return Promise.resolve(options.preferredModel)
      }
      if (key === 'defaultModel') {
        return Promise.resolve(options.defaultModel ?? { providerId: 'openai', modelId: 'gpt-4' })
      }
      return Promise.resolve(undefined)
    }),
    setSetting: vi.fn().mockResolvedValue(undefined),
    getModelConfig: vi.fn().mockReturnValue({
      temperature: 0.7,
      contextLength: 16000,
      maxTokens: 4096,
      thinkingBudget: 512,
      reasoningEffort: reasoningEffortDefault,
      verbosity: 'medium'
    }),
    getReasoningPortrait: vi.fn().mockResolvedValue(reasoningPortrait),
    getDefaultSystemPrompt: vi.fn().mockResolvedValue('Default prompt'),
    supportsReasoningCapability: vi.fn().mockReturnValue(true),
    getThinkingBudgetRange: vi.fn().mockReturnValue({ min: 0, max: 8192, default: 512 }),
    supportsReasoningEffortCapability: vi.fn().mockReturnValue(options.supportsEffort ?? true),
    getReasoningEffortDefault: vi.fn().mockReturnValue(reasoningEffortDefault),
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

  const baseSessionSettings: TestGenerationSettings = {
    systemPrompt: 'Default prompt',
    temperature: 0.7,
    contextLength: 16000,
    maxTokens: 4096,
    thinkingBudget: 512,
    reasoningEffort: 'medium',
    verbosity: 'medium',
    ...options.sessionSettings
  }

  const newAgentPresenter = {
    getPermissionMode: vi.fn().mockResolvedValue('full_access'),
    setPermissionMode: vi.fn().mockResolvedValue(undefined),
    getSessionGenerationSettings: vi.fn().mockResolvedValue(baseSessionSettings),
    getAcpSessionConfigOptions: vi.fn().mockResolvedValue(options.acpSessionConfig ?? null),
    setAcpSessionConfigOption: vi
      .fn()
      .mockImplementation(async (_sessionId: string, configId: string, value: string | boolean) => {
        const currentState = options.acpSessionConfig ?? createAcpConfigState()
        return {
          ...currentState,
          options: currentState.options.map((option) =>
            option.id === configId ? { ...option, currentValue: value } : option
          )
        } satisfies AcpConfigState
      }),
    updateSessionGenerationSettings: vi
      .fn()
      .mockImplementation((_: string, patch: any) =>
        Promise.resolve({ ...baseSessionSettings, ...patch })
      )
  }

  const llmproviderPresenter = {
    warmupAcpProcess: vi.fn().mockResolvedValue(undefined),
    getAcpProcessConfigOptions: vi.fn().mockResolvedValue(options.acpProcessConfig ?? null)
  }

  const ipcListeners = new Map<string, Set<(event: unknown, payload?: unknown) => void>>()
  ;(
    window as typeof window & {
      electron?: {
        ipcRenderer?: {
          on: ReturnType<typeof vi.fn>
          removeListener: ReturnType<typeof vi.fn>
          emit: (channel: string, payload?: unknown) => void
        }
      }
    }
  ).electron = {
    ipcRenderer: {
      on: vi.fn((channel: string, handler: (event: unknown, payload?: unknown) => void) => {
        const handlers = ipcListeners.get(channel) ?? new Set()
        handlers.add(handler)
        ipcListeners.set(channel, handlers)
      }),
      removeListener: vi.fn(
        (channel: string, handler: (event: unknown, payload?: unknown) => void) => {
          ipcListeners.get(channel)?.delete(handler)
        }
      ),
      emit: (channel: string, payload?: unknown) => {
        ipcListeners.get(channel)?.forEach((handler) => handler({}, payload))
      }
    }
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
  vi.doMock('@/stores/ui/project', () => ({
    useProjectStore: () => projectStore
  }))
  vi.doMock('@/composables/usePresenter', () => ({
    usePresenter: (name: string) => {
      if (name === 'configPresenter') return configPresenter
      if (name === 'llmproviderPresenter') return llmproviderPresenter
      return newAgentPresenter
    }
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
    props: {
      acpDraftSessionId: options.acpDraftSessionId ?? null
    },
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
        Select: SelectStub,
        SelectContent: passthrough('SelectContent'),
        SelectItem: passthrough('SelectItem'),
        SelectTrigger: passthrough('SelectTrigger'),
        SelectValue: passthrough('SelectValue'),
        Switch: SwitchStub,
        ModelIcon: defineComponent({
          name: 'ModelIcon',
          props: {
            modelId: { type: String, default: '' }
          },
          template: '<div class="model-icon-stub" :data-model-id="modelId" />'
        })
      }
    }
  })

  await flushPromises()

  return {
    wrapper,
    newAgentPresenter,
    llmproviderPresenter,
    agentStore,
    sessionStore,
    draftStore,
    configPresenter,
    projectStore,
    ipcRenderer: window.electron?.ipcRenderer
  }
}

describe('ChatStatusBar model and session panels', () => {
  it('passes system prompt section to the unified session panel in deepchat and hides it in ACP', async () => {
    const deepchat = await setup({ agentId: 'deepchat', hasActiveSession: false })
    expect(
      deepchat.wrapper.find('.mcp-indicator-stub').attributes('data-show-system-prompt-section')
    ).toBe('true')
    expect(deepchat.wrapper.text()).toContain('chat.permissionMode.fullAccess')

    const acp = await setup({ agentId: 'acp-agent', hasActiveSession: false })
    expect(
      acp.wrapper.find('.mcp-indicator-stub').attributes('data-show-system-prompt-section')
    ).toBe('false')
    expect(acp.wrapper.text()).not.toContain('chat.permissionMode.fullAccess')
  })

  it('renders compact model ids in the trigger and list, and keeps chevron actions for settings', async () => {
    const { wrapper } = await setup({
      agentId: 'deepchat',
      hasActiveSession: false,
      defaultModel: { providerId: 'openai', modelId: 'gpt-4' },
      preferredModel: { providerId: 'openai', modelId: 'gpt-4' }
    })

    expect((wrapper.vm as any).displayModelText).toBe('gpt-4')
    expect(wrapper.text()).toContain('gpt-4')
    expect(wrapper.text()).toContain('claude-3-5-sonnet')
    expect(wrapper.text()).not.toContain('GPT-4')
    expect(wrapper.text()).not.toContain('Claude 3.5 Sonnet')

    const actionButtons = wrapper.findAll('button[title="chat.advancedSettings.button"]')
    expect(actionButtons.length).toBeGreaterThan(0)
    expect(
      wrapper
        .findAll('.icon-stub')
        .some((icon) => icon.attributes('data-icon') === 'lucide:chevron-right')
    ).toBe(true)

    await actionButtons[0].trigger('click')
    await flushPromises()

    expect((wrapper.vm as any).isModelSettingsExpanded).toBe(true)
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

  it('keeps showing loading until settings finish loading for the current model selection', async () => {
    const { wrapper, sessionStore, newAgentPresenter } = await setup({
      hasActiveSession: true,
      activeProviderId: 'openai',
      activeModelId: 'gpt-4'
    })
    const pendingSettings = createDeferred<TestGenerationSettings>()
    const nextSettings: TestGenerationSettings = {
      systemPrompt: 'Anthropic prompt',
      temperature: 0.3,
      contextLength: 32000,
      maxTokens: 2048,
      thinkingBudget: 256,
      reasoningEffort: 'low',
      verbosity: 'high'
    }

    sessionStore.setSessionModel.mockImplementation(async () => {
      if (sessionStore.activeSession) {
        sessionStore.activeSession.providerId = 'anthropic'
        sessionStore.activeSession.modelId = 'claude-3-5-sonnet'
      }
    })
    newAgentPresenter.getSessionGenerationSettings.mockClear()
    newAgentPresenter.getSessionGenerationSettings.mockImplementation(() => pendingSettings.promise)

    await (wrapper.vm as any).openModelSettings('anthropic', 'claude-3-5-sonnet')
    await flushPromises()

    expect(wrapper.text()).toContain('common.loading')
    expect(wrapper.text()).not.toContain('chat.advancedSettings.temperature')
    expect((wrapper.vm as any).showSystemPromptSection).toBe(false)
    expect((wrapper.vm as any).selectedSystemPromptId).toBe('empty')
    expect(wrapper.find('.mcp-indicator-stub').attributes('data-show-system-prompt-section')).toBe(
      'false'
    )

    pendingSettings.resolve(nextSettings)
    await flushPromises()

    expect(wrapper.text()).not.toContain('common.loading')
    expect((wrapper.vm as any).localSettings).toEqual(nextSettings)
    expect((wrapper.vm as any).showSystemPromptSection).toBe(true)
    expect((wrapper.vm as any).selectedSystemPromptId).toBe('__custom__')
  })

  it('keeps non-grok-3-mini xAI models on the full reasoning effort scale', async () => {
    const { wrapper } = await setup({
      hasActiveSession: false,
      preferredModel: { providerId: 'xai', modelId: 'grok-4' },
      defaultModel: { providerId: 'xai', modelId: 'grok-4' },
      extraModelGroups: [
        {
          providerId: 'xai',
          providerName: 'xAI',
          models: [{ id: 'grok-4', name: 'Grok 4' }]
        }
      ],
      reasoningEffortDefault: 'minimal',
      reasoningPortrait: {
        supported: true,
        defaultEnabled: true,
        mode: 'effort',
        effort: 'minimal',
        effortOptions: ['minimal', 'low', 'medium', 'high'],
        verbosity: 'medium',
        verbosityOptions: ['low', 'medium', 'high']
      }
    })

    await (wrapper.vm as any).openModelSettings('xai', 'grok-4')
    await flushPromises()

    expect((wrapper.vm as any).localSettings.reasoningEffort).toBe('minimal')
    expect(wrapper.text()).toContain('settings.model.modelConfig.reasoningEffort.options.minimal')
    expect(wrapper.text()).toContain('settings.model.modelConfig.reasoningEffort.options.medium')
  })

  it('keeps grok-3-mini models on binary reasoning effort options', async () => {
    const { wrapper } = await setup({
      hasActiveSession: false,
      preferredModel: { providerId: 'xai', modelId: 'grok-3-mini-fast-beta' },
      defaultModel: { providerId: 'xai', modelId: 'grok-3-mini-fast-beta' },
      extraModelGroups: [
        {
          providerId: 'xai',
          providerName: 'xAI',
          models: [{ id: 'grok-3-mini-fast-beta', name: 'Grok 3 Mini Fast Beta' }]
        }
      ],
      reasoningEffortDefault: 'minimal',
      reasoningPortrait: {
        supported: true,
        defaultEnabled: true,
        mode: 'effort',
        effort: 'low',
        effortOptions: ['low', 'high'],
        verbosity: 'medium',
        verbosityOptions: ['low', 'medium', 'high']
      }
    })

    await (wrapper.vm as any).openModelSettings('xai', 'grok-3-mini-fast-beta')
    await flushPromises()

    expect((wrapper.vm as any).localSettings.reasoningEffort).toBe('low')
    expect(wrapper.text()).toContain('settings.model.modelConfig.reasoningEffort.options.low')
    expect(wrapper.text()).toContain('settings.model.modelConfig.reasoningEffort.options.high')
    expect(wrapper.text()).not.toContain(
      'settings.model.modelConfig.reasoningEffort.options.minimal'
    )
    expect(wrapper.text()).not.toContain(
      'settings.model.modelConfig.reasoningEffort.options.medium'
    )
  })

  it('uses unified defaults for draft model settings', async () => {
    const { wrapper } = await setup({ agentId: 'deepchat', hasActiveSession: false })

    expect((wrapper.vm as any).localSettings.contextLength).toBe(16000)
    expect((wrapper.vm as any).localSettings.maxTokens).toBe(4096)
  })

  it('prefers preferredModel over defaultModel for draft selection', async () => {
    const { wrapper, draftStore } = await setup({
      agentId: 'deepchat',
      hasActiveSession: false,
      defaultModel: { providerId: 'openai', modelId: 'gpt-4' },
      preferredModel: { providerId: 'anthropic', modelId: 'claude-3-5-sonnet' }
    })

    expect(draftStore.providerId).toBe('anthropic')
    expect(draftStore.modelId).toBe('claude-3-5-sonnet')
    expect((wrapper.vm as any).displayModelText).toBe('claude-3-5-sonnet')
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

  it('clears model settings panel state when switching models is rejected', async () => {
    const { wrapper } = await setup({
      agentId: 'deepchat',
      hasActiveSession: true,
      activeProviderId: 'openai',
      activeModelId: 'gpt-4',
      setSessionModelError: new Error('Cannot switch model while session is generating.')
    })

    await (wrapper.vm as any).openModelSettings('anthropic', 'claude-3-5-sonnet')
    await flushPromises()

    expect((wrapper.vm as any).isModelSettingsExpanded).toBe(false)
    expect((wrapper.vm as any).modelSettingsSelection).toEqual({
      providerId: 'openai',
      modelId: 'gpt-4'
    })
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

  it('shows only the ACP badge and MCP when no ACP config data is available', async () => {
    const { wrapper, llmproviderPresenter } = await setup({
      agentId: 'acp-agent',
      hasActiveSession: false,
      projectPath: null,
      acpProcessConfig: null
    })

    expect(llmproviderPresenter.warmupAcpProcess).toHaveBeenCalledWith('acp-agent', undefined)
    expect(llmproviderPresenter.getAcpProcessConfigOptions).toHaveBeenCalledWith(
      'acp-agent',
      undefined
    )
    expect(wrapper.find('.acp-agent-badge').exists()).toBe(true)
    expect(wrapper.findAll('.acp-inline-option')).toHaveLength(0)
    expect(wrapper.find('.acp-overflow-button').exists()).toBe(false)
    expect(wrapper.find('.mcp-indicator-stub').exists()).toBe(true)
    expect(wrapper.text()).not.toContain('chat.permissionMode.fullAccess')
    expect((wrapper.vm as any).acpConfigReadOnly).toBe(true)
  })

  it('shows ACP warmup config inline before session id is ready', async () => {
    const processConfig = createAcpConfigState({}, 'gpt-5')
    const { wrapper, llmproviderPresenter } = await setup({
      agentId: 'acp-agent',
      hasActiveSession: false,
      projectPath: '/tmp/workspace',
      acpProcessConfig: processConfig
    })

    expect(llmproviderPresenter.warmupAcpProcess).toHaveBeenCalledWith(
      'acp-agent',
      '/tmp/workspace'
    )
    expect(llmproviderPresenter.getAcpProcessConfigOptions).toHaveBeenCalledWith(
      'acp-agent',
      '/tmp/workspace'
    )
    expect(wrapper.findAll('.acp-inline-option')).toHaveLength(3)
    expect(wrapper.find('.acp-inline-option[data-option-id="model"]').exists()).toBe(true)
    expect(wrapper.find('.acp-inline-option[data-option-id="thought_level"]').exists()).toBe(true)
    expect(wrapper.find('.acp-inline-option[data-option-id="mode"]').exists()).toBe(true)
    expect(wrapper.find('.acp-inline-option[data-option-id="safe_edits"]').exists()).toBe(false)
    expect(wrapper.find('.acp-overflow-button').exists()).toBe(true)
    expect(wrapper.findAll('.acp-overflow-option')).toHaveLength(1)
    expect(wrapper.find('.acp-overflow-option[data-option-id="safe_edits"]').exists()).toBe(true)
    expect(wrapper.find('.acp-inline-option-title[data-option-id="model"]').text()).toBe('Model')
    expect(wrapper.find('.acp-inline-option-title[data-option-id="thought_level"]').text()).toBe(
      'Thought Level'
    )
    expect(wrapper.find('.acp-inline-option-title[data-option-id="mode"]').text()).toBe('Mode')
    const statusGroups = wrapper.findAll('div.flex.items-center.gap-1')
    const rightActions = statusGroups.at(-1)
    expect(rightActions?.element.lastElementChild?.classList.contains('mcp-indicator-stub')).toBe(
      true
    )
    expect((wrapper.vm as any).acpConfigReadOnly).toBe(true)
  })

  it('isolates warmup config cache by ACP agent id', async () => {
    const codexConfig = createAcpConfigState({}, 'gpt-5')
    const claudeConfig = createAcpConfigState({}, 'gpt-5-mini')
    const pendingWarmup = createDeferred<AcpConfigState | null>()
    const { wrapper, llmproviderPresenter, agentStore, ipcRenderer } = await setup({
      agentId: 'codex',
      hasActiveSession: false,
      projectPath: '/tmp/workspace',
      acpProcessConfig: codexConfig
    })

    expect((wrapper.vm as any).acpConfigState.options[0].currentValue).toBe('gpt-5')
    expect(wrapper.find('.acp-inline-option[data-option-id="model"]').attributes('title')).toBe(
      'gpt-5'
    )

    llmproviderPresenter.getAcpProcessConfigOptions.mockImplementation(() => pendingWarmup.promise)

    agentStore.selectedAgentId = 'claude'
    await flushPromises()

    expect(wrapper.findAll('.acp-inline-option')).toHaveLength(0)
    expect(wrapper.find('.acp-overflow-button').exists()).toBe(false)
    expect((wrapper.vm as any).acpConfigState).toBeNull()

    ipcRenderer?.emit(ACP_WORKSPACE_EVENTS.SESSION_CONFIG_OPTIONS_READY, {
      agentId: 'codex',
      workdir: '/tmp/workspace',
      configState: codexConfig
    })
    await flushPromises()

    expect(wrapper.findAll('.acp-inline-option')).toHaveLength(0)
    expect((wrapper.vm as any).acpConfigState).toBeNull()

    ipcRenderer?.emit(ACP_WORKSPACE_EVENTS.SESSION_CONFIG_OPTIONS_READY, {
      agentId: 'claude',
      workdir: '/tmp/workspace',
      configState: claudeConfig
    })
    await flushPromises()

    expect(wrapper.findAll('.acp-inline-option')).toHaveLength(3)
    expect((wrapper.vm as any).acpConfigState.options[0].currentValue).toBe('gpt-5-mini')
    expect(wrapper.find('.acp-inline-option[data-option-id="model"]').attributes('title')).toBe(
      'gpt-5-mini'
    )

    agentStore.selectedAgentId = 'codex'
    await flushPromises()

    expect(wrapper.findAll('.acp-inline-option')).toHaveLength(3)
    expect((wrapper.vm as any).acpConfigState.options[0].currentValue).toBe('gpt-5')
    expect(wrapper.find('.acp-inline-option[data-option-id="model"]').attributes('title')).toBe(
      'gpt-5'
    )

    pendingWarmup.resolve(codexConfig)
    await flushPromises()
  })

  it('moves ACP overflow options into the gear popover', async () => {
    const { wrapper } = await setup({
      agentId: 'acp-agent',
      hasActiveSession: false,
      projectPath: '/tmp/workspace',
      acpProcessConfig: createOverflowAcpConfigState()
    })

    expect(wrapper.findAll('.acp-inline-option')).toHaveLength(3)
    expect(wrapper.find('.acp-overflow-button').exists()).toBe(true)
    expect(wrapper.findAll('.acp-overflow-option')).toHaveLength(3)
    expect(wrapper.find('.acp-overflow-option[data-option-id="safe_edits"]').exists()).toBe(true)
    expect(wrapper.find('.acp-overflow-option[data-option-id="extra_select"]').exists()).toBe(true)
    expect(wrapper.find('.acp-overflow-option[data-option-id="extra_toggle"]').exists()).toBe(true)
  })

  it('keeps ACP session config read-only until session config finishes loading', async () => {
    const processConfig = createAcpConfigState({}, 'gpt-5')
    const sessionConfig = createAcpConfigState({}, 'gpt-5-mini')
    const pendingSessionConfig = createDeferred<AcpConfigState | null>()
    const { wrapper, newAgentPresenter } = await setup({
      agentId: 'acp-agent',
      hasActiveSession: false,
      projectPath: '/tmp/workspace',
      acpProcessConfig: processConfig
    })

    newAgentPresenter.getAcpSessionConfigOptions.mockImplementation(
      () => pendingSessionConfig.promise
    )

    await wrapper.setProps({ acpDraftSessionId: 'draft-1' })
    await flushPromises()

    expect(newAgentPresenter.getAcpSessionConfigOptions).toHaveBeenCalledWith('draft-1')
    expect((wrapper.vm as any).acpConfigState).toBeNull()
    expect((wrapper.vm as any).acpConfigReadOnly).toBe(true)
    expect(wrapper.findAll('.acp-inline-option')).toHaveLength(0)

    pendingSessionConfig.resolve(sessionConfig)
    await flushPromises()

    expect((wrapper.vm as any).acpConfigState.options[0].currentValue).toBe('gpt-5-mini')
    expect((wrapper.vm as any).acpConfigReadOnly).toBe(false)
    expect(wrapper.find('.acp-inline-option[data-option-id="model"]').attributes('title')).toBe(
      'gpt-5-mini'
    )
  })

  it('switches from warmup config to session config and writes ACP options through the session presenter', async () => {
    const processConfig = createAcpConfigState({}, 'gpt-5')
    const sessionConfig = createAcpConfigState({}, 'gpt-5-mini')
    const { wrapper, newAgentPresenter } = await setup({
      agentId: 'acp-agent',
      hasActiveSession: false,
      projectPath: '/tmp/workspace',
      acpProcessConfig: processConfig,
      acpSessionConfig: sessionConfig
    })

    expect(wrapper.text()).toContain('gpt-5')
    expect((wrapper.vm as any).acpConfigReadOnly).toBe(true)

    await wrapper.setProps({ acpDraftSessionId: 'draft-1' })
    await flushPromises()

    expect(newAgentPresenter.getAcpSessionConfigOptions).toHaveBeenCalledWith('draft-1')
    expect(wrapper.text()).toContain('gpt-5-mini')
    expect((wrapper.vm as any).acpConfigReadOnly).toBe(false)

    await wrapper
      .find('.acp-inline-option-item[data-option-id="model"][data-value="gpt-5"]')
      .trigger('click')
    await flushPromises()

    expect(newAgentPresenter.setAcpSessionConfigOption).toHaveBeenCalledWith(
      'draft-1',
      'model',
      'gpt-5'
    )
    expect((wrapper.vm as any).acpConfigState.options[0].currentValue).toBe('gpt-5')
  })
})

import { mount, flushPromises } from '@vue/test-utils'
import { reactive } from 'vue'
import { describe, expect, it, vi } from 'vitest'

const setup = async (
  pendingModelId: string,
  options?: {
    projects?: Array<{ name: string; path: string; exists: boolean }>
    environments?: Array<{ path: string; exists: boolean }>
    modelInitialized?: boolean
    initializeModel?: () => Promise<void>
    createSession?: () => Promise<void>
    resolveDeepChatAgentConfig?: () => Promise<{
      defaultModelPreset?: { providerId: string; modelId: string }
      defaultProjectPath?: string
      systemPrompt: string
      permissionMode: 'default' | 'full_access'
      disabledAgentTools: string[]
    }>
    awaitReady?: boolean
  }
) => {
  vi.resetModules()

  const draftStore = reactive({
    providerId: undefined as string | undefined,
    modelId: undefined as string | undefined,
    projectDir: '/workspace/demo',
    agentId: 'deepchat',
    systemPrompt: undefined as string | undefined,
    temperature: undefined as number | undefined,
    contextLength: undefined as number | undefined,
    maxTokens: undefined as number | undefined,
    thinkingBudget: undefined as number | undefined,
    reasoningEffort: undefined as string | undefined,
    verbosity: undefined as string | undefined,
    forceInterleavedThinkingCompat: undefined as boolean | undefined,
    permissionMode: 'full_access',
    disabledAgentTools: [] as string[],
    pendingStartDeeplink: {
      token: 1,
      msg: '帮我总结一下这周的迭代状态',
      modelId: pendingModelId,
      systemPrompt: 'You are a concise project assistant.',
      mentions: ['README.md', 'docs/spec.md']
    },
    toGenerationSettings: vi.fn(() => undefined),
    clearPendingStartDeeplink: vi.fn(() => {
      draftStore.pendingStartDeeplink = null
    })
  })
  const projectStore = reactive({
    selectedProject: {
      name: 'demo',
      path: '/workspace/demo'
    } as { name: string; path: string } | null,
    defaultProjectPath: null as string | null,
    defaultChatWorkspacePath: null as string | null,
    selectionSource: 'manual' as 'none' | 'manual' | 'default',
    projects: (options?.projects ?? [
      { name: 'demo', path: '/workspace/demo', exists: true }
    ]) as Array<{ name: string; path: string; exists: boolean }>,
    environments: options?.environments ?? [],
    archivedEnvironments: [],
    removedEnvironments: [],
    selectProject: vi.fn((path: string | null, source?: 'none' | 'manual' | 'default') => {
      const normalizedPath = path?.trim() || null
      projectStore.selectedProject = normalizedPath
        ? {
            name: normalizedPath.split('/').pop() ?? normalizedPath,
            path: normalizedPath
          }
        : null
      projectStore.selectionSource =
        normalizedPath || source === 'manual' ? (source ?? 'manual') : 'none'
    }),
    openFolderPicker: vi.fn()
  })
  const sessionStore = {
    selectSession: vi.fn(),
    sendMessage: vi.fn(),
    createSession: vi.fn(options?.createSession)
  }
  const agentStore = reactive({
    selectedAgentId: 'deepchat',
    selectedAgent: null,
    agents: [{ id: 'deepchat', type: 'deepchat' }]
  })
  const getChatSelectableModelGroups = () => modelStore.enabledModels
  const modelStore = reactive({
    initialized: options?.modelInitialized ?? true,
    initialize: vi.fn().mockImplementation(async () => {
      if (options?.initializeModel) {
        await options.initializeModel()
      }
      modelStore.initialized = true
    }),
    enabledModels: [
      {
        providerId: 'openai',
        models: [{ id: 'gpt-4o-mini' }, { id: 'deepseek-chat' }]
      },
      {
        providerId: 'deepseek',
        models: [{ id: 'deepseek-chat' }]
      }
    ],
    get chatSelectableModelGroups() {
      return getChatSelectableModelGroups()
    },
    findChatSelectableModel: vi.fn((providerId: string, modelId: string) => {
      const group = getChatSelectableModelGroups().find((entry) => entry.providerId === providerId)
      const model = group?.models.find((entry) => entry.id === modelId)
      if (!group || !model) {
        return null
      }
      return { providerId, providerName: providerId, model }
    }),
    pickFirstChatSelectableModel: vi.fn(() => {
      const firstGroup = getChatSelectableModelGroups()[0]
      const firstModel = firstGroup?.models[0]
      return firstGroup && firstModel
        ? {
            providerId: firstGroup.providerId,
            providerName: firstGroup.providerId,
            model: firstModel
          }
        : null
    })
  })
  const configClient = {
    getSetting: vi.fn().mockResolvedValue(undefined),
    resolveDeepChatAgentConfig: vi.fn().mockImplementation(
      options?.resolveDeepChatAgentConfig ??
        (() =>
          Promise.resolve({
            defaultModelPreset: {
              providerId: 'openai',
              modelId: 'gpt-4o-mini'
            },
            systemPrompt: 'Default system prompt',
            permissionMode: 'full_access' as const,
            disabledAgentTools: []
          }))
    )
  }
  const sessionClient = {
    ensureAcpDraftSession: vi.fn()
  }
  const fileClient = {
    isDirectory: vi.fn().mockResolvedValue(true)
  }

  vi.doMock('@/stores/ui/project', () => ({
    useProjectStore: () => projectStore
  }))
  vi.doMock('@/stores/ui/session', () => ({
    useSessionStore: () => sessionStore
  }))
  vi.doMock('@/stores/ui/agent', () => ({
    useAgentStore: () => agentStore
  }))
  vi.doMock('@/stores/modelStore', () => ({
    useModelStore: () => modelStore
  }))
  vi.doMock('@/stores/ui/draft', () => ({
    useDraftStore: () => draftStore
  }))
  vi.doMock('@api/ConfigClient', () => ({
    createConfigClient: vi.fn(() => configClient)
  }))
  vi.doMock('@api/SessionClient', () => ({
    createSessionClient: vi.fn(() => sessionClient)
  }))
  vi.doMock('@api/ChatClient', () => ({
    createChatClient: vi.fn(() => ({
      cancelSubmission: vi.fn().mockResolvedValue({ cancelled: true })
    }))
  }))
  vi.doMock('@api/FileClient', () => ({
    createFileClient: vi.fn(() => fileClient)
  }))
  vi.doMock('@/lib/startupDeferred', () => ({
    scheduleStartupDeferredTask: vi.fn((task: () => void | Promise<void>) => {
      void task()
      return () => {}
    })
  }))
  vi.doMock('@/components/chat/ChatInputBox.vue', () => ({
    default: {
      name: 'ChatInputBox',
      props: ['modelValue'],
      template: '<div data-testid="chat-input">{{ modelValue }}<slot name="toolbar" /></div>'
    }
  }))
  vi.doMock('@/components/chat/ChatStatusBar.vue', () => ({
    default: {
      name: 'ChatStatusBar',
      template: '<div data-testid="chat-status-bar" />'
    }
  }))
  vi.doMock('vue-i18n', () => ({
    useI18n: () => ({
      t: (key: string) => key
    })
  }))
  vi.doMock('@iconify/vue', () => ({
    Icon: {
      name: 'Icon',
      template: '<span />'
    }
  }))

  const NewThreadPage = (await import('@/pages/NewThreadPage.vue')).default

  const wrapper = mount(NewThreadPage, {
    global: {
      stubs: {
        TooltipProvider: {
          template: '<div><slot /></div>'
        },
        DropdownMenu: {
          template: '<div><slot /></div>'
        },
        DropdownMenuTrigger: {
          template: '<div><slot /></div>'
        },
        DropdownMenuContent: {
          template: '<div><slot /></div>'
        },
        DropdownMenuLabel: {
          template: '<div><slot /></div>'
        },
        DropdownMenuItem: {
          template: '<button type="button" v-bind="$attrs"><slot /></button>'
        },
        DropdownMenuSeparator: {
          template: '<div />'
        },
        DcButton: {
          template: '<button type="button" v-bind="$attrs"><slot /></button>'
        },
        AcpAuthDialog: true,
        ChatInputToolbar: true,
        ChatStatusBar: true,
        ChatInputBox: {
          name: 'ChatInputBox',
          props: ['modelValue', 'submitDisabled'],
          emits: ['submit', 'command-submit'],
          template:
            '<div data-testid="chat-input" :data-submit-disabled="String(submitDisabled)">{{ modelValue }}<slot name="toolbar" /></div>'
        }
      }
    }
  })

  if (options?.awaitReady !== false) {
    await flushPromises()
  }

  return {
    wrapper,
    draftStore,
    projectStore,
    sessionStore,
    modelStore
  }
}

describe('NewThreadPage start deeplink prefill', () => {
  it('applies exact model matches and appends mentions into the input', async () => {
    const { wrapper, draftStore } = await setup('deepseek-chat')

    expect(wrapper.get('[data-testid="chat-input"]').text()).toContain('帮我总结一下这周的迭代状态')
    expect(wrapper.get('[data-testid="chat-input"]').text()).toContain('@README.md')
    expect(wrapper.get('[data-testid="chat-input"]').text()).toContain('@docs/spec.md')
    expect(draftStore.systemPrompt).toBe('You are a concise project assistant.')
    expect(draftStore.providerId).toBe('openai')
    expect(draftStore.modelId).toBe('deepseek-chat')
    expect(draftStore.clearPendingStartDeeplink).toHaveBeenCalledTimes(1)
  }, 20000)

  it('falls back to fuzzy model matching when no exact match exists', async () => {
    const { draftStore } = await setup('seek-chat')

    expect(draftStore.providerId).toBe('openai')
    expect(draftStore.modelId).toBe('deepseek-chat')
  }, 20000)

  it('does not replace a project selected while agent defaults are loading', async () => {
    let resolveAgentConfig!: (value: {
      defaultModelPreset?: { providerId: string; modelId: string }
      defaultProjectPath?: string
      systemPrompt: string
      permissionMode: 'default' | 'full_access'
      disabledAgentTools: string[]
    }) => void
    const agentConfig = new Promise<{
      defaultModelPreset?: { providerId: string; modelId: string }
      defaultProjectPath?: string
      systemPrompt: string
      permissionMode: 'default' | 'full_access'
      disabledAgentTools: string[]
    }>((resolve) => {
      resolveAgentConfig = resolve
    })
    const { projectStore } = await setup('deepseek-chat', {
      resolveDeepChatAgentConfig: () => agentConfig,
      awaitReady: false
    })
    await vi.waitFor(() => expect(resolveAgentConfig).toBeTypeOf('function'))

    projectStore.selectProject('/workspace/user-choice', 'manual')
    resolveAgentConfig({
      defaultModelPreset: { providerId: 'openai', modelId: 'gpt-4o-mini' },
      defaultProjectPath: '/workspace/agent-default',
      systemPrompt: 'Default system prompt',
      permissionMode: 'full_access',
      disabledAgentTools: []
    })
    await flushPromises()

    expect(projectStore.selectedProject?.path).toBe('/workspace/user-choice')
    expect(projectStore.selectProject).not.toHaveBeenCalledWith(
      '/workspace/agent-default',
      'manual'
    )
  }, 20000)

  it('allows clearing the selected project from the new thread dropdown', async () => {
    const { wrapper, projectStore } = await setup('deepseek-chat')

    await wrapper.get('[data-testid="new-thread-clear-project"]').trigger('click')
    await flushPromises()

    expect(projectStore.selectProject).toHaveBeenCalledWith(null, 'manual')
    expect(wrapper.get('[data-testid="new-thread-project-trigger"]').text()).toContain(
      'chat.sidebar.chats'
    )
  }, 20000)

  it('hides missing projects from the new thread dropdown', async () => {
    const { wrapper } = await setup('deepseek-chat', {
      projects: [
        { name: 'demo', path: '/workspace/demo', exists: true },
        { name: 'missing', path: '/workspace/missing', exists: false },
        { name: 'stale', path: '/workspace/stale', exists: true }
      ],
      environments: [{ path: '/workspace/stale', exists: false }]
    })

    expect(wrapper.text()).toContain('/workspace/demo')
    expect(wrapper.text()).not.toContain('/workspace/missing')
    expect(wrapper.text()).not.toContain('/workspace/stale')
  }, 20000)

  it('keeps only the newest deeplink when model initialization resolves out of order', async () => {
    let resolveModelInitialization!: () => void
    const modelInitialization = new Promise<void>((resolve) => {
      resolveModelInitialization = resolve
    })
    const { draftStore, wrapper } = await setup('deepseek-chat', {
      modelInitialized: false,
      initializeModel: () => modelInitialization
    })

    draftStore.pendingStartDeeplink = {
      token: 2,
      msg: '只应用这条最新 deep link',
      modelId: 'gpt-4o-mini',
      systemPrompt: 'Latest prompt',
      mentions: []
    }
    await wrapper.vm.$nextTick()

    resolveModelInitialization()
    await flushPromises()

    expect(wrapper.get('[data-testid="chat-input"]').text()).toContain('只应用这条最新 deep link')
    expect(draftStore.systemPrompt).toBe('Latest prompt')
    expect(draftStore.providerId).toBe('openai')
    expect(draftStore.modelId).toBe('gpt-4o-mini')
    expect(draftStore.clearPendingStartDeeplink).toHaveBeenCalledTimes(1)
  }, 20000)

  it('prevents duplicate new-thread submissions until the current submission completes', async () => {
    let resolveCreateSession!: () => void
    const createSession = new Promise<void>((resolve) => {
      resolveCreateSession = resolve
    })
    const { sessionStore, wrapper } = await setup('deepseek-chat', {
      createSession: () => createSession
    })
    const input = wrapper.findComponent({ name: 'ChatInputBox' })

    await input.vm.$emit('update:modelValue', '请创建一个新会话')
    await wrapper.vm.$nextTick()
    await input.vm.$emit('submit')
    await input.vm.$emit('submit')
    await flushPromises()

    expect(sessionStore.createSession).toHaveBeenCalledTimes(1)
    expect(wrapper.get('[data-testid="chat-input"]').attributes('data-submit-disabled')).toBe(
      'true'
    )

    resolveCreateSession()
    await flushPromises()

    expect(wrapper.get('[data-testid="chat-input"]').attributes('data-submit-disabled')).toBe(
      'false'
    )

    await input.vm.$emit('update:modelValue', '第二条会话')
    await input.vm.$emit('submit')
    await flushPromises()

    expect(sessionStore.createSession).toHaveBeenCalledTimes(2)
  }, 20000)
})

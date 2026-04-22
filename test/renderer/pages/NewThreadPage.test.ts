import { mount, flushPromises } from '@vue/test-utils'
import { reactive } from 'vue'
import { describe, expect, it, vi } from 'vitest'

const setup = async (pendingModelId: string) => {
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
      mentions: ['README.md', 'docs/spec.md'],
      autoSend: false
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
    selectionSource: 'manual' as 'none' | 'manual' | 'default',
    projects: [{ name: 'demo', path: '/workspace/demo' }] as Array<{ name: string; path: string }>,
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
    createSession: vi.fn()
  }
  const agentStore = reactive({
    selectedAgentId: 'deepchat',
    selectedAgent: null,
    agents: [{ id: 'deepchat', type: 'deepchat' }]
  })
  const modelStore = reactive({
    initialized: true,
    initialize: vi.fn().mockImplementation(async () => {
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
    ]
  })
  const configClient = {
    getSetting: vi.fn().mockResolvedValue(undefined),
    resolveDeepChatAgentConfig: vi.fn().mockResolvedValue({
      defaultModelPreset: {
        providerId: 'openai',
        modelId: 'gpt-4o-mini'
      },
      systemPrompt: 'Default system prompt',
      permissionMode: 'full_access',
      disabledAgentTools: []
    })
  }
  const sessionClient = {
    ensureAcpDraftSession: vi.fn()
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
        Button: {
          template: '<button type="button" v-bind="$attrs"><slot /></button>'
        },
        ChatInputToolbar: true,
        ChatStatusBar: true,
        ChatInputBox: {
          name: 'ChatInputBox',
          props: ['modelValue'],
          template: '<div data-testid="chat-input">{{ modelValue }}<slot name="toolbar" /></div>'
        }
      }
    }
  })

  await flushPromises()

  return {
    wrapper,
    draftStore,
    projectStore
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

  it('allows clearing the selected project from the new thread dropdown', async () => {
    const { wrapper, projectStore } = await setup('deepseek-chat')

    await wrapper.get('[data-testid="new-thread-clear-project"]').trigger('click')
    await flushPromises()

    expect(projectStore.selectProject).toHaveBeenCalledWith(null, 'manual')
    expect(wrapper.get('[data-testid="new-thread-project-trigger"]').text()).toContain(
      'common.project.none'
    )
  }, 20000)
})

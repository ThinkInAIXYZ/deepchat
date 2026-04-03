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
    },
    defaultProjectPath: null as string | null,
    projects: [] as Array<{ name: string; path: string }>,
    selectProject: vi.fn(),
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
  const configPresenter = {
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
  const agentSessionPresenter = {
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
  vi.doMock('@/composables/usePresenter', () => ({
    usePresenter: (name: string) => {
      if (name === 'configPresenter') return configPresenter
      if (name === 'agentSessionPresenter') return agentSessionPresenter
      return {}
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
        DropdownMenu: true,
        DropdownMenuTrigger: true,
        DropdownMenuContent: true,
        DropdownMenuLabel: true,
        DropdownMenuItem: true,
        DropdownMenuSeparator: true,
        Button: true,
        ChatInputToolbar: true,
        ChatStatusBar: true,
        ChatInputBox: {
          name: 'ChatInputBox',
          props: ['modelValue'],
          template: '<div data-testid="chat-input">{{ modelValue }}</div>'
        }
      }
    }
  })

  await flushPromises()

  return {
    wrapper,
    draftStore
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
  })

  it('falls back to fuzzy model matching when no exact match exists', async () => {
    const { draftStore } = await setup('seek-chat')

    expect(draftStore.providerId).toBe('openai')
    expect(draftStore.modelId).toBe('deepseek-chat')
  })
})

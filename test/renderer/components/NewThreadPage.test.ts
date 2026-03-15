import { describe, expect, it, vi } from 'vitest'
import { defineComponent, h, reactive } from 'vue'
import { flushPromises, mount } from '@vue/test-utils'

const passthrough = (name: string) =>
  defineComponent({
    name,
    template: '<div><slot /></div>'
  })

const chatInputTriggerAttachMock = vi.fn()
const chatInputPendingSkillsSnapshotRef: { value: string[] } = { value: [] }

const createChatInputBoxStub = () =>
  defineComponent({
    name: 'ChatInputBox',
    props: {
      modelValue: { type: String, default: '' },
      files: { type: Array, default: () => [] },
      sessionId: { type: String, default: null },
      workspacePath: { type: String, default: null },
      isAcpSession: { type: Boolean, default: false },
      submitDisabled: { type: Boolean, default: false }
    },
    emits: [
      'update:modelValue',
      'update:files',
      'submit',
      'command-submit',
      'pending-skills-change'
    ],
    setup(_props, { expose }) {
      expose({
        triggerAttach: chatInputTriggerAttachMock,
        getPendingSkillsSnapshot: () => [...chatInputPendingSkillsSnapshotRef.value]
      })
      return () => h('div')
    }
  })

const setup = async (options?: {
  ensureAcpDraftSession?: (input: {
    agentId: string
    projectDir: string
    permissionMode?: string
  }) => Promise<{ id: string } | null>
}) => {
  vi.resetModules()
  chatInputTriggerAttachMock.mockReset()
  chatInputPendingSkillsSnapshotRef.value = []

  const projectStore = reactive({
    selectedProject: { path: '/tmp/workspace', name: 'workspace' },
    selectedProjectName: 'workspace',
    projects: [],
    selectProject: vi.fn(),
    openFolderPicker: vi.fn()
  })

  const sessionStore = {
    createSession: vi.fn().mockResolvedValue(undefined),
    selectSession: vi.fn().mockResolvedValue(undefined),
    sendMessage: vi.fn().mockResolvedValue(undefined)
  }

  const agentStore = reactive({
    selectedAgentId: 'acp-agent',
    selectedAgent: { id: 'acp-agent', name: 'ACP Agent', type: 'acp' as const, enabled: true }
  })

  const modelStore = reactive({
    enabledModels: []
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
    toGenerationSettings: vi.fn(() => undefined),
    resetGenerationSettings: vi.fn()
  })

  const configPresenter = {
    getSetting: vi.fn().mockResolvedValue(undefined)
  }

  const newAgentPresenter = {
    ensureAcpDraftSession: vi.fn().mockImplementation(
      options?.ensureAcpDraftSession ??
        (() => {
          return Promise.resolve({ id: 'draft-1' })
        })
    )
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
    usePresenter: (name: string) =>
      name === 'configPresenter' ? configPresenter : newAgentPresenter
  }))
  vi.doMock('vue-i18n', () => ({
    useI18n: () => ({
      t: (key: string) => key,
      locale: { value: 'zh-CN' }
    })
  }))

  vi.doMock('@/components/chat/ChatInputBox.vue', () => ({
    default: createChatInputBoxStub()
  }))
  vi.doMock('@/components/chat/ChatInputToolbar.vue', () => ({
    default: passthrough('ChatInputToolbar')
  }))
  vi.doMock('@/components/chat/ChatStatusBar.vue', () => ({
    default: passthrough('ChatStatusBar')
  }))
  vi.doMock('@shadcn/components/ui/tooltip', () => ({
    TooltipProvider: passthrough('TooltipProvider')
  }))

  const NewThreadPage = (await import('@/pages/NewThreadPage.vue')).default
  const wrapper = mount(NewThreadPage, {
    global: {
      stubs: {
        TooltipProvider: true,
        Button: true,
        DropdownMenu: true,
        DropdownMenuTrigger: true,
        DropdownMenuContent: true,
        DropdownMenuItem: true,
        DropdownMenuLabel: true,
        DropdownMenuSeparator: true,
        Icon: true,
        ChatInputToolbar: true,
        ChatStatusBar: true
      }
    }
  })

  await flushPromises()

  return {
    wrapper,
    projectStore,
    sessionStore,
    agentStore,
    modelStore,
    draftStore,
    newAgentPresenter
  }
}

describe('NewThreadPage ACP draft session bootstrap', () => {
  it('ensures ACP draft session and passes session-id to ChatInputBox', async () => {
    const { wrapper, newAgentPresenter } = await setup()

    expect(newAgentPresenter.ensureAcpDraftSession).toHaveBeenCalledWith({
      agentId: 'acp-agent',
      projectDir: '/tmp/workspace',
      permissionMode: 'full_access'
    })

    expect((wrapper.vm as any).acpDraftSessionId).toBe('draft-1')
  })

  it('reuses ensured draft session on first submit', async () => {
    const { wrapper, sessionStore } = await setup()
    ;(wrapper.vm as any).message = 'hello from draft'
    ;(wrapper.vm as any).attachedFiles = [
      { name: 'a.txt', path: '/tmp/a.txt', mimeType: 'text/plain' }
    ]
    await (wrapper.vm as any).onSubmit()
    await flushPromises()

    expect(sessionStore.selectSession).toHaveBeenCalledWith('draft-1')
    expect(sessionStore.sendMessage).toHaveBeenCalledWith('draft-1', {
      text: 'hello from draft',
      files: [{ name: 'a.txt', path: '/tmp/a.txt', mimeType: 'text/plain' }]
    })
    expect(sessionStore.createSession).not.toHaveBeenCalled()
  })

  it('passes draft generation settings when creating a deepchat session', async () => {
    const { wrapper, sessionStore, agentStore, modelStore, draftStore } = await setup()

    agentStore.selectedAgentId = 'deepchat'
    modelStore.enabledModels = [
      {
        providerId: 'openai',
        models: [{ id: 'gpt-4', name: 'GPT-4' }]
      }
    ]
    draftStore.providerId = 'openai'
    draftStore.modelId = 'gpt-4'
    ;(draftStore.toGenerationSettings as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      systemPrompt: 'Preset prompt',
      temperature: 1.2,
      contextLength: 8192,
      maxTokens: 2048
    })
    ;(wrapper.vm as any).message = 'hello deepchat'
    ;(wrapper.vm as any).attachedFiles = [
      { name: 'plan.md', path: '/tmp/workspace/plan.md', mimeType: 'text/markdown' }
    ]
    await (wrapper.vm as any).onSubmit()
    await flushPromises()

    expect(sessionStore.createSession).toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'hello deepchat',
        files: [{ name: 'plan.md', path: '/tmp/workspace/plan.md', mimeType: 'text/markdown' }],
        agentId: 'deepchat',
        generationSettings: {
          systemPrompt: 'Preset prompt',
          temperature: 1.2,
          contextLength: 8192,
          maxTokens: 2048
        }
      })
    )
  })

  it('prefers ChatInputBox pending skills snapshot when creating deepchat session', async () => {
    const { wrapper, sessionStore, agentStore, modelStore } = await setup()

    agentStore.selectedAgentId = 'deepchat'
    modelStore.enabledModels = [
      {
        providerId: 'openai',
        models: [{ id: 'gpt-4', name: 'GPT-4' }]
      }
    ]
    ;(wrapper.vm as any).onPendingSkillsChange(['stale-skill'])
    ;(wrapper.vm as any).chatInputRef = {
      triggerAttach: vi.fn(),
      getPendingSkillsSnapshot: () => ['live-skill', 'live-skill']
    }
    ;(wrapper.vm as any).message = 'hello deepchat'

    await (wrapper.vm as any).onSubmit()
    await flushPromises()

    expect(sessionStore.createSession).toHaveBeenCalledWith(
      expect.objectContaining({
        activeSkills: ['live-skill']
      })
    )
  })

  it('ignores stale ensureAcpDraftSession response after agent/workdir switches', async () => {
    let resolveOld: ((value: { id: string }) => void) | null = null
    let resolveNew: ((value: { id: string }) => void) | null = null
    const oldPromise = new Promise<{ id: string }>((resolve) => {
      resolveOld = resolve
    })
    const newPromise = new Promise<{ id: string }>((resolve) => {
      resolveNew = resolve
    })

    const { wrapper, projectStore, agentStore } = await setup({
      ensureAcpDraftSession: ({ agentId, projectDir }) => {
        if (agentId === 'acp-agent' && projectDir === '/tmp/workspace') {
          return oldPromise
        }
        if (agentId === 'acp-agent-2' && projectDir === '/tmp/workspace-2') {
          return newPromise
        }
        return Promise.resolve({ id: 'unexpected' })
      }
    })

    agentStore.selectedAgentId = 'acp-agent-2'
    agentStore.selectedAgent = {
      id: 'acp-agent-2',
      name: 'ACP Agent 2',
      type: 'acp',
      enabled: true
    }
    projectStore.selectedProject = { path: '/tmp/workspace-2', name: 'workspace-2' }
    await flushPromises()

    resolveOld?.({ id: 'draft-old' })
    await flushPromises()
    expect((wrapper.vm as any).acpDraftSessionId).not.toBe('draft-old')

    resolveNew?.({ id: 'draft-new' })
    await flushPromises()
    expect((wrapper.vm as any).acpDraftSessionId).toBe('draft-new')
  })

  it('handles null ensureAcpDraftSession result without throwing', async () => {
    const { wrapper } = await setup({
      ensureAcpDraftSession: () => Promise.resolve(null)
    })

    expect((wrapper.vm as any).acpDraftSessionId).toBeNull()
  })
})

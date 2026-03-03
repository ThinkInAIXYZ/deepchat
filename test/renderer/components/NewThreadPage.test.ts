import { describe, expect, it, vi } from 'vitest'
import { defineComponent, reactive } from 'vue'
import { flushPromises, mount } from '@vue/test-utils'

const createChatInputBoxStub = () =>
  defineComponent({
    name: 'ChatInputBox',
    props: {
      modelValue: { type: String, default: '' },
      sessionId: { type: String, default: null },
      workspacePath: { type: String, default: null },
      isAcpSession: { type: Boolean, default: false },
      submitDisabled: { type: Boolean, default: false }
    },
    emits: ['update:modelValue', 'submit', 'command-submit', 'pending-skills-change'],
    template: '<div />'
  })

const setup = async (options?: {
  ensureAcpDraftSession?: (input: {
    agentId: string
    projectDir: string
    permissionMode?: string
  }) => Promise<{ id: string }>
}) => {
  vi.resetModules()

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
    permissionMode: 'full_access' as const
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

  vi.doMock('@/components/chat/ChatInputBox.vue', () => ({
    default: createChatInputBoxStub()
  }))
  vi.doMock('@/components/chat/ChatInputToolbar.vue', () => ({
    default: defineComponent({ name: 'ChatInputToolbar', template: '<div />' })
  }))
  vi.doMock('@/components/chat/ChatStatusBar.vue', () => ({
    default: defineComponent({ name: 'ChatStatusBar', template: '<div />' })
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
        ChatStatusBar: true,
        ChatInputBox: createChatInputBoxStub()
      }
    }
  })

  await flushPromises()

  return {
    wrapper,
    projectStore,
    sessionStore,
    agentStore,
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
    await (wrapper.vm as any).onSubmit()
    await flushPromises()

    expect(sessionStore.selectSession).toHaveBeenCalledWith('draft-1')
    expect(sessionStore.sendMessage).toHaveBeenCalledWith('draft-1', 'hello from draft')
    expect(sessionStore.createSession).not.toHaveBeenCalled()
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
})

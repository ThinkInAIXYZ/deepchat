import { describe, expect, it, vi } from 'vitest'
import { defineComponent, h, reactive } from 'vue'
import { flushPromises, mount } from '@vue/test-utils'
import type { ReasoningEffort, Verbosity } from '../../../src/shared/types/model-db'
import type { PermissionMode } from '../../../src/shared/types/agent-interface'

const passthrough = (name: string) =>
  defineComponent({
    name,
    template: '<div><slot /></div>'
  })

const chatInputTriggerAttachMock = vi.fn()
const chatInputClearPendingSkillsMock = vi.fn(() => {
  chatInputPendingSkillsSnapshotRef.value = []
})
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
      editable: { type: Boolean, default: true },
      submitDisabled: { type: Boolean, default: false }
    },
    emits: [
      'update:modelValue',
      'update:files',
      'submit',
      'command-submit',
      'pending-skills-change'
    ],
    setup(props, { expose }) {
      expose({
        triggerAttach: chatInputTriggerAttachMock,
        getPendingSkillsSnapshot: () => [...chatInputPendingSkillsSnapshotRef.value],
        clearPendingSkills: chatInputClearPendingSkillsMock
      })
      return () =>
        h('div', {
          'data-testid': 'chat-input-box',
          'data-submit-disabled': String(props.submitDisabled),
          'data-editable': String(props.editable),
          'data-workspace-path': props.workspacePath ?? '',
          'data-is-acp-session': String(props.isAcpSession)
        })
    }
  })

const setup = async (options?: {
  ensureAcpDraftSession?: (input: {
    agentId: string
    projectDir: string
    permissionMode?: string
  }) => Promise<{ id: string; providerId?: string; modelId?: string } | null>
  selectedProject?: {
    path: string
    name: string
  } | null
  isDirectory?: boolean | ((path: string) => Promise<boolean> | boolean)
  defaultProjectPath?: string | null
  defaultChatWorkspacePath?: string | null
  defaultModel?: { providerId: string; modelId: string }
  preferredModel?: { providerId: string; modelId: string }
  resolvedAgentConfig?: Record<string, unknown>
  resolveDeepChatAgentConfig?: (agentId: string) => Promise<Record<string, unknown>>
  selectedAgentId?: string
  selectedAgentType?: 'deepchat' | 'acp'
  newConversationProjectDirIntent?: {
    id: number
    projectDir: string | null
    consumed?: boolean
  } | null
  deferStartupTasks?: boolean
  modelStoreInitialized?: boolean
  initializeModels?: () => Promise<void>
  modelCapabilities?: Record<string, { supportsAudioInput: boolean | null }>
}) => {
  vi.resetModules()
  chatInputTriggerAttachMock.mockReset()
  chatInputClearPendingSkillsMock.mockClear()
  chatInputPendingSkillsSnapshotRef.value = []
  const initialSelectedProject = Object.prototype.hasOwnProperty.call(
    options ?? {},
    'selectedProject'
  )
    ? (options?.selectedProject ?? null)
    : {
        path: '/tmp/workspace',
        name: 'workspace'
      }

  const projectStore = reactive({
    selectedProject: initialSelectedProject as { path: string; name: string } | null,
    selectedProjectName: initialSelectedProject?.name ?? 'workspace',
    selectionSource: 'manual' as 'manual' | 'default',
    defaultProjectPath: options?.defaultProjectPath ?? null,
    defaultChatWorkspacePath: options?.defaultChatWorkspacePath ?? null,
    projects: [],
    environments: [],
    archivedEnvironments: [],
    removedEnvironments: [],
    selectProject: vi.fn((path: string | null, source: 'manual' | 'default' = 'manual') => {
      projectStore.selectionSource = source
      projectStore.selectedProject = path
        ? {
            path,
            name: path.split(/[/\\]/).pop() ?? path
          }
        : null
    }),
    openFolderPicker: vi.fn()
  })

  const initialProjectDirIntent = options?.newConversationProjectDirIntent
    ? {
        ...options.newConversationProjectDirIntent,
        consumed: options.newConversationProjectDirIntent.consumed ?? false
      }
    : null
  const sessionStore = reactive({
    createSession: vi.fn().mockResolvedValue(undefined),
    selectSession: vi.fn().mockResolvedValue(undefined),
    sendMessage: vi.fn().mockResolvedValue(undefined),
    newConversationProjectDirIntent: initialProjectDirIntent,
    consumeNewConversationProjectDirIntent: vi.fn((intentId: number) => {
      const intent = sessionStore.newConversationProjectDirIntent
      if (!intent || intent.id !== intentId || intent.consumed) {
        return
      }
      sessionStore.newConversationProjectDirIntent = { ...intent, consumed: true }
    })
  })

  const selectedAgentId = options?.selectedAgentId ?? 'acp-agent'
  const selectedAgentType = options?.selectedAgentType ?? 'acp'
  const agentStore = reactive({
    selectedAgentId,
    selectedAgent: {
      id: selectedAgentId,
      name: selectedAgentId,
      type: selectedAgentType,
      enabled: true
    }
  })

  const getChatSelectableModelGroups = () => modelStore.enabledModels

  const modelStore = reactive({
    initialized: options?.modelStoreInitialized ?? true,
    initialize: vi.fn().mockImplementation(async () => {
      if (options?.initializeModels) {
        await options.initializeModels()
      }
      modelStore.initialized = true
    }),
    enabledModels: [],
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

  const draftStore = reactive({
    projectDir: projectStore.selectedProject?.path ?? undefined,
    providerId: undefined as string | undefined,
    modelId: undefined as string | undefined,
    permissionMode: 'full_access' as PermissionMode,
    disabledAgentTools: [] as string[],
    systemPrompt: undefined as string | undefined,
    temperature: undefined as number | undefined,
    contextLength: undefined as number | undefined,
    maxTokens: undefined as number | undefined,
    thinkingBudget: undefined as number | undefined,
    reasoningEffort: undefined as ReasoningEffort | undefined,
    verbosity: undefined as Verbosity | undefined,
    toGenerationSettings: vi.fn(() => undefined),
    resetGenerationSettings: vi.fn()
  })

  const configClient = {
    getSetting: vi.fn((key: string) => {
      if (key === 'defaultModel') {
        return Promise.resolve(options?.defaultModel)
      }
      if (key === 'preferredModel') {
        return Promise.resolve(options?.preferredModel)
      }
      return Promise.resolve(undefined)
    }),
    resolveDeepChatAgentConfig: vi.fn(
      options?.resolveDeepChatAgentConfig ??
        (() =>
          Promise.resolve(
            options?.resolvedAgentConfig ?? {
              disabledAgentTools: [],
              permissionMode: 'full_access'
            }
          ))
    )
  }

  const sessionClient = {
    ensureAcpDraftSession: vi.fn().mockImplementation(
      options?.ensureAcpDraftSession ??
        (() => {
          return Promise.resolve({ id: 'draft-1' })
        })
    )
  }
  const chatClient = {
    cancelSubmission: vi.fn().mockResolvedValue({ cancelled: true })
  }
  const modelClient = {
    getCapabilities: vi.fn((providerId: string, modelId: string) => {
      const capabilities = options?.modelCapabilities?.[`${providerId}:${modelId}`]
      return Promise.resolve(capabilities ?? { supportsAudioInput: true })
    }),
    getModelConfig: vi.fn().mockResolvedValue({ speechRecognition: false }),
    transcribeAudio: vi.fn(),
    onModelConfigChanged: vi.fn(() => vi.fn()),
    onModelsChanged: vi.fn(() => vi.fn()),
    onModelStatusChanged: vi.fn(() => vi.fn())
  }
  const isDirectoryMock = vi.fn((path: string) => {
    const resolver = options?.isDirectory ?? true
    return Promise.resolve(typeof resolver === 'function' ? resolver(path) : resolver)
  })
  const startupDeferredTasks: Array<() => void | Promise<void>> = []

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
    createChatClient: vi.fn(() => chatClient)
  }))
  vi.doMock('@api/ModelClient', () => ({
    createModelClient: vi.fn(() => modelClient)
  }))
  vi.doMock('@api/FileClient', () => ({
    createFileClient: vi.fn(() => ({
      isDirectory: isDirectoryMock
    }))
  }))
  vi.doMock('@/lib/startupDeferred', () => ({
    scheduleStartupDeferredTask: vi.fn((task: () => void | Promise<void>) => {
      if (options?.deferStartupTasks) {
        startupDeferredTasks.push(task)
      } else {
        void task()
      }
      return () => {}
    })
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
        TooltipProvider: passthrough('TooltipProvider'),
        Button: passthrough('Button'),
        DropdownMenu: passthrough('DropdownMenu'),
        DropdownMenuTrigger: passthrough('DropdownMenuTrigger'),
        DropdownMenuContent: passthrough('DropdownMenuContent'),
        DropdownMenuItem: passthrough('DropdownMenuItem'),
        DropdownMenuLabel: passthrough('DropdownMenuLabel'),
        DropdownMenuSeparator: passthrough('DropdownMenuSeparator'),
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
    modelClient,
    sessionClient,
    chatClient,
    isDirectoryMock,
    flushStartupDeferredTasks: async () => {
      while (startupDeferredTasks.length > 0) {
        const task = startupDeferredTasks.shift()
        if (task) {
          await task()
        }
      }
      await flushPromises()
    }
  }
}

describe('NewThreadPage ACP draft session bootstrap', () => {
  it('defers ACP draft session bootstrap until startup deferred tasks are released', async () => {
    const { sessionClient, flushStartupDeferredTasks } = await setup({
      deferStartupTasks: true
    })

    expect(sessionClient.ensureAcpDraftSession).not.toHaveBeenCalled()

    await flushStartupDeferredTasks()

    expect(sessionClient.ensureAcpDraftSession).toHaveBeenCalledWith({
      agentId: 'acp-agent',
      projectDir: '/tmp/workspace',
      permissionMode: 'full_access'
    })
  })

  it('uses the preselected project path when default project selection is already applied', async () => {
    const { sessionClient } = await setup({
      selectedProject: {
        path: '/tmp/default-workspace',
        name: 'default-workspace'
      }
    })

    expect(sessionClient.ensureAcpDraftSession).toHaveBeenCalledWith({
      agentId: 'acp-agent',
      projectDir: '/tmp/default-workspace',
      permissionMode: 'full_access'
    })
  })

  it('labels the built-in default workspace as chats instead of its folder name', async () => {
    const { wrapper } = await setup({
      selectedProject: {
        path: '/Users/test/Documents/DeepChat',
        name: 'DeepChat'
      },
      defaultChatWorkspacePath: '/Users/test/Documents/DeepChat/'
    })

    expect(wrapper.get('[data-testid="new-thread-project-trigger"]').text()).toContain(
      'chat.sidebar.chats'
    )
    expect(
      wrapper.get('[data-testid="new-thread-project-trigger-icon"]').attributes('data-icon')
    ).toBe('lucide:message-square')
    expect(wrapper.get('[data-testid="new-thread-clear-project"]').text()).toContain(
      'chat.sidebar.chats'
    )
    expect(wrapper.text()).not.toContain('common.project.none')
    expect(
      wrapper.get('[data-testid="new-thread-clear-project-icon"]').attributes('data-icon')
    ).toBe('lucide:message-square')
  })

  it('labels an explicit no-project DeepChat draft as chats and submits null projectDir', async () => {
    const { wrapper, sessionStore, agentStore, modelStore } = await setup({
      selectedProject: {
        path: '/Users/test/Documents/DeepChat',
        name: 'DeepChat'
      },
      defaultProjectPath: '/Users/test/Documents/DeepChat',
      defaultChatWorkspacePath: '/Users/test/Documents/DeepChat'
    })

    agentStore.selectedAgentId = 'deepchat'
    modelStore.enabledModels = [
      {
        providerId: 'openai',
        models: [{ id: 'gpt-4', name: 'GPT-4' }]
      }
    ]
    await flushPromises()

    ;(wrapper.vm as any).clearSelectedProject()
    await flushPromises()

    expect(wrapper.get('[data-testid="new-thread-project-trigger"]').text()).toContain(
      'chat.sidebar.chats'
    )
    expect(
      wrapper.get('[data-testid="new-thread-project-trigger-icon"]').attributes('data-icon')
    ).toBe('lucide:message-square')

    ;(wrapper.vm as any).message = 'hello no project'
    await (wrapper.vm as any).onSubmit()
    await flushPromises()

    expect(sessionStore.createSession).toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'hello no project',
        agentId: 'deepchat',
        projectDir: null
      })
    )
  })

  it('ensures ACP draft session and passes session-id to ChatInputBox', async () => {
    const { wrapper, sessionClient } = await setup()

    expect(sessionClient.ensureAcpDraftSession).toHaveBeenCalledWith({
      agentId: 'acp-agent',
      projectDir: '/tmp/workspace',
      permissionMode: 'full_access'
    })

    expect((wrapper.vm as any).acpDraftSessionId).toBe('draft-1')
  })

  it('shows a warning and blocks ACP draft/send when the selected workdir is invalid', async () => {
    const { wrapper, sessionClient, sessionStore } = await setup({
      isDirectory: false
    })

    expect(wrapper.find('[data-testid="new-thread-project-missing-warning"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="chat-input-box"]').attributes('data-submit-disabled')).toBe(
      'true'
    )
    expect(sessionClient.ensureAcpDraftSession).not.toHaveBeenCalled()

    ;(wrapper.vm as any).message = 'hello invalid acp'
    await (wrapper.vm as any).onSubmit()
    await flushPromises()

    expect(sessionStore.createSession).not.toHaveBeenCalled()
    expect(sessionStore.sendMessage).not.toHaveBeenCalled()
  })

  it('shows the same invalid-directory warning for DeepChat without blocking send', async () => {
    const { wrapper, sessionStore, agentStore, modelStore, draftStore } = await setup({
      isDirectory: false
    })

    agentStore.selectedAgentId = 'deepchat'
    await flushPromises()
    modelStore.enabledModels = [
      {
        providerId: 'openai',
        models: [{ id: 'gpt-4', name: 'GPT-4' }]
      }
    ]
    draftStore.providerId = 'openai'
    draftStore.modelId = 'gpt-4'
    ;(wrapper.vm as any).message = 'hello deepchat invalid workdir'

    expect(wrapper.find('[data-testid="new-thread-project-missing-warning"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="chat-input-box"]').attributes('data-submit-disabled')).toBe(
      'false'
    )

    await (wrapper.vm as any).onSubmit()
    await flushPromises()

    expect(sessionStore.createSession).toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'hello deepchat invalid workdir',
        agentId: 'deepchat',
        projectDir: '/tmp/workspace'
      })
    )
  })

  it('clears the warning and resumes ACP draft creation after switching to a valid workdir', async () => {
    const { wrapper, projectStore, sessionClient } = await setup({
      isDirectory: (path) => path === '/tmp/valid-workspace'
    })

    expect(wrapper.find('[data-testid="new-thread-project-missing-warning"]').exists()).toBe(true)
    expect(sessionClient.ensureAcpDraftSession).not.toHaveBeenCalled()

    projectStore.selectedProject = {
      path: '/tmp/valid-workspace',
      name: 'valid-workspace'
    }
    await flushPromises()

    expect(wrapper.find('[data-testid="new-thread-project-missing-warning"]').exists()).toBe(false)
    expect(sessionClient.ensureAcpDraftSession).toHaveBeenCalledWith({
      agentId: 'acp-agent',
      projectDir: '/tmp/valid-workspace',
      permissionMode: 'full_access'
    })
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

  it('keeps ACP image attachments on the non-cancellable send path', async () => {
    const { wrapper, sessionStore } = await setup()
    const image = { name: 'scan.png', path: '/tmp/scan.png', mimeType: 'image/png' }
    ;(wrapper.vm as any).message = 'ACP image prompt'
    ;(wrapper.vm as any).attachedFiles = [image]

    await (wrapper.vm as any).onSubmit()
    await flushPromises()

    expect(sessionStore.sendMessage).toHaveBeenCalledWith('draft-1', {
      text: 'ACP image prompt',
      files: [image]
    })
  })

  it('allows a DeepChat image-only initial turn', async () => {
    const { wrapper, sessionStore, modelStore, draftStore } = await setup({
      selectedAgentId: 'deepchat',
      selectedAgentType: 'deepchat'
    })
    modelStore.enabledModels = [
      {
        providerId: 'openai',
        models: [{ id: 'gpt-4', name: 'GPT-4' }]
      }
    ]
    draftStore.providerId = 'openai'
    draftStore.modelId = 'gpt-4'
    const image = { name: 'scan.png', path: '/tmp/scan.png', mimeType: 'image/png' }
    ;(wrapper.vm as any).attachedFiles = [image]

    await (wrapper.vm as any).onSubmit()
    await flushPromises()

    expect(sessionStore.createSession).toHaveBeenCalledWith(
      expect.objectContaining({
        message: '',
        files: [image],
        agentId: 'deepchat'
      }),
      expect.objectContaining({
        submissionId: expect.any(String),
        isCancellationRequested: expect.any(Function)
      })
    )
  })

  it('locks the new-thread editor while initial attachment preflight is in flight', async () => {
    const { wrapper, sessionStore, modelStore, draftStore } = await setup({
      selectedAgentId: 'deepchat',
      selectedAgentType: 'deepchat'
    })
    modelStore.enabledModels = [
      {
        providerId: 'openai',
        models: [{ id: 'gpt-4', name: 'GPT-4' }]
      }
    ]
    draftStore.providerId = 'openai'
    draftStore.modelId = 'gpt-4'
    let resolveCreate!: () => void
    sessionStore.createSession.mockImplementationOnce(
      () => new Promise<void>((resolve) => (resolveCreate = resolve))
    )
    ;(wrapper.vm as any).attachedFiles = [
      { name: 'scan.png', path: '/tmp/scan.png', mimeType: 'image/png' }
    ]

    const submit = (wrapper.vm as any).onSubmit()
    await vi.waitFor(() => expect(sessionStore.createSession).toHaveBeenCalledTimes(1))
    expect(wrapper.get('[data-testid="chat-input-box"]').attributes('data-editable')).toBe('false')

    resolveCreate()
    await submit
    await flushPromises()
  })

  it('cancels initial image preparation without clearing the new-thread draft', async () => {
    const { wrapper, sessionStore, modelStore, draftStore, chatClient } = await setup({
      selectedAgentId: 'deepchat',
      selectedAgentType: 'deepchat'
    })
    modelStore.enabledModels = [
      {
        providerId: 'openai',
        models: [{ id: 'gpt-4', name: 'GPT-4' }]
      }
    ]
    draftStore.providerId = 'openai'
    draftStore.modelId = 'gpt-4'
    const image = { name: 'scan.png', path: '/tmp/scan.png', mimeType: 'image/png' }
    let rejectCreate!: (error: Error) => void
    sessionStore.createSession.mockImplementationOnce(
      () =>
        new Promise<void>((_resolve, reject) => {
          rejectCreate = reject
        })
    )
    chatClient.cancelSubmission.mockImplementationOnce(async () => {
      const error = new Error('Aborted')
      error.name = 'AbortError'
      rejectCreate(error)
      return { cancelled: true }
    })
    ;(wrapper.vm as any).message = 'keep this'
    ;(wrapper.vm as any).attachedFiles = [image]

    const submit = (wrapper.vm as any).onSubmit()
    await vi.waitFor(() => expect(sessionStore.createSession).toHaveBeenCalledOnce())
    const submissionOptions = sessionStore.createSession.mock.calls[0]?.[1]
    ;(wrapper.vm as any).cancelSubmissionPreparation()
    await submit
    await flushPromises()

    expect(chatClient.cancelSubmission).toHaveBeenCalledWith(submissionOptions?.submissionId)
    expect((wrapper.vm as any).message).toBe('keep this')
    expect((wrapper.vm as any).attachedFiles).toEqual([image])
  })

  it('preserves the ACP text requirement for attachment-only drafts', async () => {
    const { wrapper, sessionStore } = await setup()
    const image = { name: 'scan.png', path: '/tmp/scan.png', mimeType: 'image/png' }
    ;(wrapper.vm as any).attachedFiles = [image]

    await (wrapper.vm as any).onSubmit()
    await flushPromises()

    expect(sessionStore.sendMessage).not.toHaveBeenCalled()
    expect(sessionStore.createSession).not.toHaveBeenCalled()
    expect((wrapper.vm as any).attachedFiles).toEqual([image])
  })

  it('filters ACP draft attachments using the ensured draft model target', async () => {
    const textFile = { name: 'a.txt', path: '/tmp/a.txt', mimeType: 'text/plain' }
    const audioFile = { name: 'clip.wav', path: '/tmp/clip.wav', mimeType: 'audio/wav' }
    const { wrapper, sessionStore, modelClient } = await setup({
      ensureAcpDraftSession: () =>
        Promise.resolve({
          id: 'draft-1',
          providerId: 'acp',
          modelId: 'runtime-agent'
        }),
      modelCapabilities: {
        'acp:runtime-agent': { supportsAudioInput: false }
      }
    })

    ;(wrapper.vm as any).message = 'hello from draft'
    ;(wrapper.vm as any).attachedFiles = [textFile, audioFile]

    await (wrapper.vm as any).onSubmit()
    await flushPromises()

    expect(modelClient.getCapabilities).toHaveBeenCalledWith('acp', 'runtime-agent')
    expect(sessionStore.sendMessage).toHaveBeenCalledWith('draft-1', {
      text: 'hello from draft',
      files: [textFile]
    })
  })

  it('keeps draft input when ACP draft send fails', async () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      const { wrapper, sessionStore } = await setup()
      const file = { name: 'a.pdf', path: '/tmp/a.pdf', mimeType: 'application/pdf' }
      ;(wrapper.vm as any).message = 'hello from draft'
      ;(wrapper.vm as any).attachedFiles = [file]
      sessionStore.sendMessage.mockRejectedValueOnce(new Error('send failed'))

      await (wrapper.vm as any).onSubmit()
      await flushPromises()

      expect(sessionStore.sendMessage).toHaveBeenCalledWith('draft-1', {
        text: 'hello from draft',
        files: [file]
      })
      expect((wrapper.vm as any).message).toBe('hello from draft')
      expect((wrapper.vm as any).attachedFiles).toEqual([file])
    } finally {
      consoleErrorSpy.mockRestore()
    }
  })

  it('passes draft generation settings when creating a deepchat session', async () => {
    const { wrapper, sessionStore, agentStore, modelStore, draftStore } = await setup()

    agentStore.selectedAgentId = 'deepchat'
    await flushPromises()
    modelStore.enabledModels = [
      {
        providerId: 'openai',
        models: [{ id: 'gpt-4', name: 'GPT-4' }]
      }
    ]
    draftStore.providerId = 'openai'
    draftStore.modelId = 'gpt-4'
    draftStore.disabledAgentTools = ['exec', 'cdp_send']
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
        disabledAgentTools: ['exec', 'cdp_send'],
        generationSettings: {
          systemPrompt: 'Preset prompt',
          temperature: 1.2,
          contextLength: 8192,
          maxTokens: 2048
        }
      })
    )
  })

  it('does not create a deepchat session from a draft /compact command', async () => {
    const { wrapper, sessionStore, agentStore, modelStore } = await setup()

    agentStore.selectedAgentId = 'deepchat'
    await flushPromises()
    modelStore.enabledModels = [
      {
        providerId: 'openai',
        models: [{ id: 'gpt-4', name: 'GPT-4' }]
      }
    ]
    ;(wrapper.vm as any).message = '/compact'

    await (wrapper.vm as any).onSubmit()
    await flushPromises()

    expect(sessionStore.createSession).not.toHaveBeenCalled()
    expect(sessionStore.sendMessage).not.toHaveBeenCalled()
    expect((wrapper.vm as any).message).toBe('/compact')
  })

  it('keeps draft input when deepchat session creation fails', async () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      const { wrapper, sessionStore, agentStore, modelStore, draftStore } = await setup()
      const file = { name: 'a.pdf', path: '/tmp/a.pdf', mimeType: 'application/pdf' }

      agentStore.selectedAgentId = 'deepchat'
      await flushPromises()
      modelStore.enabledModels = [
        {
          providerId: 'openai',
          models: [{ id: 'gpt-4', name: 'GPT-4' }]
        }
      ]
      draftStore.providerId = 'openai'
      draftStore.modelId = 'gpt-4'
      ;(wrapper.vm as any).message = 'hello deepchat'
      ;(wrapper.vm as any).attachedFiles = [file]
      sessionStore.createSession.mockRejectedValueOnce(new Error('create failed'))

      await (wrapper.vm as any).onSubmit()
      await flushPromises()

      expect(sessionStore.createSession).toHaveBeenCalledWith(
        expect.objectContaining({
          message: 'hello deepchat',
          files: [file]
        })
      )
      expect((wrapper.vm as any).message).toBe('hello deepchat')
      expect((wrapper.vm as any).attachedFiles).toEqual([file])
    } finally {
      consoleErrorSpy.mockRestore()
    }
  })

  it('awaits full model initialization before creating a deepchat session', async () => {
    const { wrapper, sessionStore, agentStore, modelStore, draftStore } = await setup({
      modelStoreInitialized: false
    })

    agentStore.selectedAgentId = 'deepchat'
    await flushPromises()
    modelStore.initialize.mockImplementation(async () => {
      modelStore.enabledModels = [
        {
          providerId: 'openai',
          models: [{ id: 'gpt-4', name: 'GPT-4' }]
        }
      ]
      modelStore.initialized = true
    })
    draftStore.providerId = 'openai'
    draftStore.modelId = 'gpt-4'
    ;(wrapper.vm as any).message = 'hello after init'

    await (wrapper.vm as any).onSubmit()
    await flushPromises()

    expect(modelStore.initialize).toHaveBeenCalledTimes(1)
    expect(sessionStore.createSession).toHaveBeenCalledWith(
      expect.objectContaining({
        providerId: 'openai',
        modelId: 'gpt-4'
      })
    )
  })

  it('prefers the agent default directory over the current selection', async () => {
    const { projectStore, agentStore, draftStore } = await setup({
      defaultProjectPath: '/workspaces/global',
      resolvedAgentConfig: {
        defaultProjectPath: '/workspaces/agent-writer',
        disabledAgentTools: [],
        permissionMode: 'full_access'
      }
    })

    agentStore.selectedAgentId = 'deepchat'
    await flushPromises()

    expect(projectStore.selectProject).toHaveBeenCalledWith('/workspaces/agent-writer', 'manual')
    expect(projectStore.selectedProject).toEqual({
      path: '/workspaces/agent-writer',
      name: 'agent-writer'
    })
    expect(draftStore.projectDir).toBe('/workspaces/agent-writer')
  })

  it('prefers a new-conversation workspace intent over the agent default directory', async () => {
    const { projectStore, draftStore, sessionStore } = await setup({
      selectedAgentId: 'deepchat',
      selectedAgentType: 'deepchat',
      defaultProjectPath: '/workspaces/global',
      resolvedAgentConfig: {
        defaultProjectPath: '/workspaces/agent-writer',
        disabledAgentTools: [],
        permissionMode: 'full_access'
      },
      newConversationProjectDirIntent: {
        id: 1,
        projectDir: '/workspaces/design'
      }
    })

    expect(projectStore.selectProject).toHaveBeenCalledWith('/workspaces/design', 'manual')
    expect(projectStore.selectedProject).toEqual({
      path: '/workspaces/design',
      name: 'design'
    })
    expect(draftStore.projectDir).toBe('/workspaces/design')
    expect(sessionStore.consumeNewConversationProjectDirIntent).toHaveBeenCalledWith(1)
  })

  it('preserves an explicit null Chats intent over the agent default directory', async () => {
    const { projectStore, draftStore, sessionStore } = await setup({
      selectedAgentId: 'deepchat',
      selectedAgentType: 'deepchat',
      resolvedAgentConfig: {
        defaultProjectPath: '/workspaces/agent-writer',
        disabledAgentTools: [],
        permissionMode: 'full_access'
      },
      newConversationProjectDirIntent: {
        id: 1,
        projectDir: null
      }
    })

    expect(projectStore.selectProject).toHaveBeenCalledWith(null, 'manual')
    expect(projectStore.selectedProject).toBeNull()
    expect(projectStore.selectionSource).toBe('manual')
    expect(draftStore.projectDir).toBeUndefined()
    expect(sessionStore.consumeNewConversationProjectDirIntent).toHaveBeenCalledWith(1)
  })

  it('fences stale agent defaults after a workspace intent arrives', async () => {
    const configResolvers: Array<(config: Record<string, unknown>) => void> = []
    const { projectStore, draftStore, sessionStore } = await setup({
      selectedAgentId: 'deepchat',
      selectedAgentType: 'deepchat',
      resolveDeepChatAgentConfig: () =>
        new Promise((resolve) => {
          configResolvers.push(resolve)
        })
    })

    expect(configResolvers).toHaveLength(1)

    sessionStore.newConversationProjectDirIntent = {
      id: 1,
      projectDir: '/workspaces/design',
      consumed: false
    }
    await Promise.resolve()
    expect(configResolvers).toHaveLength(2)

    configResolvers[1]({
      defaultProjectPath: '/workspaces/agent-writer',
      disabledAgentTools: [],
      permissionMode: 'full_access'
    })
    await flushPromises()

    configResolvers[0]({
      defaultProjectPath: '/workspaces/agent-writer',
      disabledAgentTools: [],
      permissionMode: 'full_access'
    })
    await flushPromises()

    expect(projectStore.selectedProject).toEqual({
      path: '/workspaces/design',
      name: 'design'
    })
    expect(draftStore.projectDir).toBe('/workspaces/design')
    expect(sessionStore.consumeNewConversationProjectDirIntent).toHaveBeenCalledTimes(1)
  })

  it('prefers preferredModel over defaultModel when creating a deepchat session', async () => {
    const { wrapper, sessionStore, agentStore, modelStore } = await setup({
      defaultModel: { providerId: 'openai', modelId: 'gpt-4' },
      preferredModel: { providerId: 'zenmux', modelId: 'moonshotai/kimi-k2.5' }
    })

    agentStore.selectedAgentId = 'deepchat'
    modelStore.enabledModels = [
      {
        providerId: 'openai',
        models: [{ id: 'gpt-4', name: 'GPT-4' }]
      },
      {
        providerId: 'zenmux',
        models: [{ id: 'moonshotai/kimi-k2.5', name: 'Kimi K2.5' }]
      }
    ]
    ;(wrapper.vm as any).message = 'hello preferred model'

    await (wrapper.vm as any).onSubmit()
    await flushPromises()

    expect(sessionStore.createSession).toHaveBeenCalledWith(
      expect.objectContaining({
        providerId: 'zenmux',
        modelId: 'moonshotai/kimi-k2.5'
      })
    )
  })

  it('falls back to defaultModel when preferredModel is not enabled', async () => {
    const { wrapper, sessionStore, agentStore, modelStore } = await setup({
      defaultModel: { providerId: 'openai', modelId: 'gpt-4' },
      preferredModel: { providerId: 'zenmux', modelId: 'moonshotai/kimi-k2.5' }
    })

    agentStore.selectedAgentId = 'deepchat'
    modelStore.enabledModels = [
      {
        providerId: 'openai',
        models: [{ id: 'gpt-4', name: 'GPT-4' }]
      }
    ]
    ;(wrapper.vm as any).message = 'hello default model'

    await (wrapper.vm as any).onSubmit()
    await flushPromises()

    expect(sessionStore.createSession).toHaveBeenCalledWith(
      expect.objectContaining({
        providerId: 'openai',
        modelId: 'gpt-4'
      })
    )
  })

  it('falls back to the first enabled model when saved models are unavailable', async () => {
    const { wrapper, sessionStore, agentStore, modelStore } = await setup({
      defaultModel: { providerId: 'openai', modelId: 'gpt-4' },
      preferredModel: { providerId: 'zenmux', modelId: 'moonshotai/kimi-k2.5' }
    })

    agentStore.selectedAgentId = 'deepchat'
    modelStore.enabledModels = [
      {
        providerId: 'anthropic',
        models: [{ id: 'claude-3-5-sonnet', name: 'Claude 3.5 Sonnet' }]
      },
      {
        providerId: 'openai',
        models: [{ id: 'gpt-4.1', name: 'GPT-4.1' }]
      }
    ]
    ;(wrapper.vm as any).message = 'hello first enabled model'

    await (wrapper.vm as any).onSubmit()
    await flushPromises()

    expect(sessionStore.createSession).toHaveBeenCalledWith(
      expect.objectContaining({
        providerId: 'anthropic',
        modelId: 'claude-3-5-sonnet'
      })
    )
  })

  it('sends ChatInputBox pending skills as initial message-scoped skills', async () => {
    const { wrapper, sessionStore, agentStore, modelStore } = await setup()

    agentStore.selectedAgentId = 'deepchat'
    modelStore.enabledModels = [
      {
        providerId: 'openai',
        models: [{ id: 'gpt-4', name: 'GPT-4' }]
      }
    ]
    ;(wrapper.vm as any).onPendingSkillsChange(['stale-skill'])
    chatInputPendingSkillsSnapshotRef.value = ['live-skill', 'live-skill']
    ;(wrapper.vm as any).message = 'hello deepchat'

    await (wrapper.vm as any).onSubmit()
    await flushPromises()

    expect(sessionStore.createSession).toHaveBeenCalledWith(
      expect.objectContaining({
        activeSkills: ['live-skill']
      })
    )
    expect(chatInputClearPendingSkillsMock).toHaveBeenCalled()
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

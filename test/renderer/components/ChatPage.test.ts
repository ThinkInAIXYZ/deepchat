import { describe, expect, it, vi } from 'vitest'
import { defineComponent, reactive } from 'vue'
import { flushPromises, mount } from '@vue/test-utils'
import { WORKSPACE_EVENTS } from '@/events'

const passthrough = (name: string) =>
  defineComponent({
    name,
    template: '<div><slot /></div>'
  })

const buildAssistantMessage = (content: unknown) => ({
  id: 'm1',
  sessionId: 's1',
  orderSeq: 1,
  role: 'assistant' as const,
  content: JSON.stringify(content),
  status: 'sent' as const,
  isContextEdge: 0,
  metadata: JSON.stringify({
    model: 'dimcode-acp',
    provider: 'acp',
    reasoningStartTime: 1_200,
    reasoningEndTime: 4_500
  }),
  traceCount: 0,
  createdAt: 1,
  updatedAt: 1
})

type SetupOptions = {
  messages?: Array<Record<string, unknown>>
  isStreaming?: boolean
  streamingBlocks?: unknown[]
  currentStreamMessageId?: string | null
  pendingInputStorePatch?: Record<string, unknown>
  sessionKind?: 'regular' | 'subagent'
  activeSessionPatch?: Record<string, unknown>
  spotlightPendingJump?: { sessionId: string; messageId: string } | null
  deferStartupTasks?: boolean
}

const setup = async (options: SetupOptions = {}) => {
  vi.resetModules()

  const sessionStore = reactive({
    activeSession: {
      id: 's1',
      title: 'Session',
      projectDir: 'C:/repo',
      providerId: 'acp',
      modelId: 'dimcode-acp',
      status: 'idle',
      sessionKind: options.sessionKind ?? 'regular',
      ...options.activeSessionPatch
    },
    sendMessage: vi.fn().mockResolvedValue(undefined),
    fetchSessions: vi.fn().mockResolvedValue(undefined),
    selectSession: vi.fn().mockResolvedValue(undefined)
  })

  const messageStore = reactive({
    messages: options.messages ?? [
      buildAssistantMessage([
        {
          type: 'reasoning_content',
          content: 'thinking',
          status: 'success',
          timestamp: 1
        }
      ])
    ],
    isStreaming: options.isStreaming ?? false,
    streamingBlocks: options.streamingBlocks ?? [],
    currentStreamMessageId: options.currentStreamMessageId ?? null,
    streamRevision: 0,
    lastPersistedRevision: 0,
    hasMoreHistory: false,
    isLoadingHistory: false,
    messageIds: (
      options.messages ?? [
        buildAssistantMessage([
          {
            type: 'reasoning_content',
            content: 'thinking',
            status: 'success',
            timestamp: 1
          }
        ])
      ]
    ).map((message) => String(message.id)),
    messageCache: new Map(
      (
        options.messages ?? [
          buildAssistantMessage([
            {
              type: 'reasoning_content',
              content: 'thinking',
              status: 'success',
              timestamp: 1
            }
          ])
        ]
      ).map((message) => [String(message.id), message])
    ),
    getAssistantMessageBlocks: vi.fn((message: { content: string }) => JSON.parse(message.content)),
    getUserMessageContent: vi.fn((message: { content: string }) => JSON.parse(message.content)),
    getMessageMetadata: vi.fn((message: { metadata: string }) => JSON.parse(message.metadata)),
    loadMessages: vi.fn().mockResolvedValue(undefined),
    loadOlderMessages: vi.fn().mockResolvedValue(0),
    clear: vi.fn(),
    clearStreamingState: vi.fn(),
    addOptimisticUserMessage: vi.fn()
  })

  const pendingInputStore = reactive({
    items: [],
    steerItems: [],
    queueItems: [],
    isAtCapacity: false,
    loadPendingInputs: vi.fn().mockResolvedValue(undefined),
    queueInput: vi.fn().mockResolvedValue(undefined),
    updateQueueInput: vi.fn().mockResolvedValue(undefined),
    moveQueueInput: vi.fn().mockResolvedValue(undefined),
    steerPendingInput: vi.fn().mockResolvedValue(undefined),
    deleteInput: vi.fn().mockResolvedValue(undefined),
    clear: vi.fn(),
    ...options.pendingInputStorePatch
  })

  const agentPlanSnapshots = reactive<Record<string, any>>({})
  const agentPlanStore = reactive({
    snapshots: agentPlanSnapshots,
    applySnapshot: vi.fn((snapshot: any) => {
      agentPlanSnapshots[snapshot.sessionId] = snapshot
    }),
    clearSnapshot: vi.fn((sessionId: string) => {
      delete agentPlanSnapshots[sessionId]
    }),
    beginTurn: vi.fn(),
    freezeActive: vi.fn(),
    dismiss: vi.fn(),
    purge: vi.fn(),
    isVisible: vi.fn((sessionId: string) => Boolean(agentPlanSnapshots[sessionId]?.plan?.length)),
    isCollapsed: vi.fn().mockReturnValue(false),
    toggleCollapsed: vi.fn()
  })

  const modelStore = reactive({
    findModelByIdOrName: vi.fn((id: string) => ({
      model: {
        id,
        name: id === 'dimcode-acp' ? 'DimCode' : id
      }
    }))
  })
  const uiSettingsStore = reactive({
    autoScrollEnabled: true
  })

  const chatRespondToolInteraction = vi.fn().mockResolvedValue({ accepted: true })
  const chatClient = {
    sendMessage: vi.fn().mockResolvedValue({
      accepted: true,
      requestId: null,
      messageId: null
    }),
    steerActiveTurn: vi.fn().mockResolvedValue({
      accepted: true
    }),
    stopStream: vi.fn().mockResolvedValue({ stopped: true }),
    respondToolInteraction: chatRespondToolInteraction,
    onPlanUpdated: vi.fn().mockReturnValue(() => {})
  }
  const sessionClient = {
    retryMessage: vi.fn().mockResolvedValue(undefined),
    deleteMessage: vi.fn().mockResolvedValue(undefined),
    editUserMessage: vi.fn().mockResolvedValue(undefined),
    forkSession: vi.fn().mockResolvedValue({ id: 'forked' }),
    compactSession: vi.fn().mockResolvedValue({
      compacted: true,
      state: {
        status: 'compacted',
        cursorOrderSeq: 3,
        summaryUpdatedAt: 123
      }
    })
  }
  const toast = vi.fn()
  const chatInputInsertWorkspaceReference = vi.fn().mockReturnValue(true)
  const chatInputTriggerAttach = vi.fn()
  const chatInputGetPendingSkillsSnapshot = vi.fn((): string[] => [])
  const chatInputClearPendingSkills = vi.fn()

  const spotlightStore = reactive({
    pendingMessageJump: options.spotlightPendingJump ?? null,
    clearPendingMessageJump: vi.fn(() => {
      spotlightStore.pendingMessageJump = null
    })
  })
  const startupDeferredTasks: Array<() => void | Promise<void>> = []

  vi.doMock('@/stores/ui/session', () => ({
    useSessionStore: () => sessionStore
  }))
  vi.doMock('@/stores/ui/message', () => ({
    useMessageStore: () => messageStore
  }))
  vi.doMock('@/stores/ui/pendingInput', () => ({
    usePendingInputStore: () => pendingInputStore
  }))
  vi.doMock('@/stores/ui/agentPlan', () => ({
    useAgentPlanStore: () => agentPlanStore
  }))
  vi.doMock('@/stores/modelStore', () => ({
    useModelStore: () => modelStore
  }))
  vi.doMock('@/stores/uiSettingsStore', () => ({
    useUiSettingsStore: () => uiSettingsStore
  }))
  vi.doMock('../../../src/renderer/api/ChatClient', () => ({
    createChatClient: vi.fn(() => chatClient)
  }))
  vi.doMock('@api/SessionClient', () => ({
    createSessionClient: vi.fn(() => sessionClient)
  }))
  vi.doMock('@/components/use-toast', () => ({
    useToast: () => ({ toast })
  }))
  vi.doMock('@/stores/ui/spotlight', () => ({
    useSpotlightStore: () => spotlightStore
  }))
  vi.doMock('@/lib/startupDeferred', () => ({
    scheduleStartupDeferredTask: vi.fn((task: () => void | Promise<void>) => {
      if (options.deferStartupTasks) {
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
  vi.doMock('@shadcn/components/ui/tooltip', () => ({
    TooltipProvider: passthrough('TooltipProvider')
  }))
  vi.doMock('@/components/chat/ChatTopBar.vue', () => ({
    default: defineComponent({
      name: 'ChatTopBar',
      props: {
        isReadOnly: {
          type: Boolean,
          default: false
        }
      },
      template: '<div class="chat-top-bar-stub" :data-read-only="String(isReadOnly)" />'
    })
  }))
  vi.doMock('@/components/chat/MessageList.vue', () => ({
    default: defineComponent({
      name: 'MessageList',
      props: {
        messages: {
          type: Array,
          required: true
        },
        conversationId: {
          type: String,
          default: ''
        },
        ephemeralRateLimitBlock: {
          type: Object,
          default: null
        },
        ephemeralRateLimitMessageId: {
          type: String,
          default: null
        },
        isGenerating: {
          type: Boolean,
          default: false
        },
        traceMessageIds: {
          type: Array,
          default: () => []
        },
        isReadOnly: {
          type: Boolean,
          default: false
        }
      },
      template:
        '<div class="message-list-stub" :data-read-only="String(isReadOnly)" :data-has-rate-limit="String(Boolean(ephemeralRateLimitBlock))"><div v-for="message in messages" :key="message.id" class="message-item-stub" :data-message-id="message.id" /></div>'
    })
  }))
  vi.doMock('@/components/chat/ChatInputBox.vue', () => ({
    default: defineComponent({
      name: 'ChatInputBox',
      props: {
        files: {
          type: Array,
          default: () => []
        },
        submitDisabled: {
          type: Boolean,
          default: false
        },
        queueSubmitEnabled: {
          type: Boolean,
          default: false
        },
        queueSubmitDisabled: {
          type: Boolean,
          default: false
        },
        isGenerating: {
          type: Boolean,
          default: false
        }
      },
      emits: ['update:modelValue', 'update:files', 'command-submit', 'queue-submit', 'submit'],
      setup(_, { expose }) {
        expose({
          triggerAttach: chatInputTriggerAttach,
          insertWorkspaceReference: chatInputInsertWorkspaceReference,
          getPendingSkillsSnapshot: chatInputGetPendingSkillsSnapshot,
          clearPendingSkills: chatInputClearPendingSkills
        })
      },
      template: '<div class="chat-input-box-stub"><slot name="toolbar" /></div>'
    })
  }))
  vi.doMock('@/components/chat/ChatInputToolbar.vue', () => ({
    default: defineComponent({
      name: 'ChatInputToolbar',
      props: {
        isGenerating: {
          type: Boolean,
          default: false
        },
        hasInput: {
          type: Boolean,
          default: false
        },
        sendDisabled: {
          type: Boolean,
          default: false
        },
        queueDisabled: {
          type: Boolean,
          default: false
        }
      },
      emits: ['attach', 'queue', 'send', 'steer', 'stop'],
      template:
        '<div class="chat-input-toolbar-stub"><button v-if="isGenerating && hasInput" data-testid="chat-steer-button" @click="$emit(\'steer\')" /></div>'
    })
  }))
  vi.doMock('@/components/chat/AgentProgressFloat.vue', () => ({
    default: defineComponent({
      name: 'AgentProgressFloat',
      emits: ['toggle-collapse'],
      template: '<button class="agent-progress-float-stub" @click="$emit(\'toggle-collapse\')" />'
    })
  }))
  vi.doMock('@/components/chat/PendingInputLane.vue', () => ({
    default: defineComponent({
      name: 'PendingInputLane',
      props: {
        queueItems: {
          type: Array,
          default: () => []
        }
      },
      emits: ['steer-queue'],
      template:
        '<button class="pending-input-lane-stub" data-testid="pending-lane-steer" @click="$emit(\'steer-queue\', queueItems[0]?.id ?? \'queue-1\')" />'
    })
  }))
  vi.doMock('@/components/chat/ChatStatusBar.vue', () => ({
    default: passthrough('ChatStatusBar')
  }))
  vi.doMock('@/components/chat/ChatToolInteractionOverlay.vue', () => ({
    default: defineComponent({
      name: 'ChatToolInteractionOverlay',
      emits: ['respond'],
      template:
        '<button class="chat-tool-interaction-overlay-stub" @click="$emit(\'respond\', { kind: \'permission\', granted: true })" />'
    })
  }))
  vi.doMock('@/components/chat/ChatSearchBar.vue', () => ({
    default: defineComponent({
      name: 'ChatSearchBar',
      props: {
        modelValue: {
          type: String,
          default: ''
        },
        activeMatch: {
          type: Number,
          default: 0
        },
        totalMatches: {
          type: Number,
          default: 0
        }
      },
      emits: ['update:modelValue', 'previous', 'next', 'close'],
      setup(_, { expose }) {
        expose({
          focusInput: vi.fn(),
          selectInput: vi.fn()
        })
      },
      template:
        '<div class="chat-search-bar-stub" :data-active-match="String(activeMatch)" :data-total-matches="String(totalMatches)" />'
    })
  }))
  vi.doMock('@/components/trace/TraceDialog.vue', () => ({
    default: passthrough('TraceDialog')
  }))

  const ChatPage = (await import('@/pages/ChatPage.vue')).default
  const wrapper = mount(ChatPage, {
    props: {
      sessionId: 's1'
    }
  })

  await flushPromises()

  return {
    wrapper,
    chatClient,
    chatRespondToolInteraction,
    sessionClient,
    sessionStore,
    toast,
    messageStore,
    pendingInputStore,
    agentPlanStore,
    spotlightStore,
    chatInputInsertWorkspaceReference,
    chatInputTriggerAttach,
    chatInputGetPendingSkillsSnapshot,
    chatInputClearPendingSkills,
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

type ChatPageSetupResult = Awaited<ReturnType<typeof setup>>

async function expectSessionRestoreSettleStopsAfter(
  triggerIntent: (context: {
    wrapper: ChatPageSetupResult['wrapper']
    chatPage: HTMLDivElement
  }) => Promise<void> | void
) {
  let nextFrameId = 1
  const rafCallbacks = new Map<number, FrameRequestCallback>()
  const flushRaf = async () => {
    const callbacks = Array.from(rafCallbacks.values())
    rafCallbacks.clear()
    callbacks.forEach((cb) => cb(0))
    await flushPromises()
  }
  const rafSpy = vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => {
    const frameId = nextFrameId
    nextFrameId += 1
    rafCallbacks.set(frameId, cb)
    return frameId
  })
  const cancelRafSpy = vi.spyOn(window, 'cancelAnimationFrame').mockImplementation((frameId) => {
    rafCallbacks.delete(frameId)
  })

  try {
    const { wrapper, flushStartupDeferredTasks } = await setup({
      deferStartupTasks: true
    })
    const chatPage = wrapper.get('[data-testid="chat-page"]').element as HTMLDivElement

    let scrollHeight = 1200
    let scrollTop = 0
    Object.defineProperty(chatPage, 'clientHeight', {
      configurable: true,
      get: () => 500
    })
    Object.defineProperty(chatPage, 'scrollHeight', {
      configurable: true,
      get: () => scrollHeight
    })
    Object.defineProperty(chatPage, 'scrollTop', {
      configurable: true,
      get: () => scrollTop,
      set: (value: number) => {
        scrollTop = value
      }
    })

    await flushStartupDeferredTasks()
    await flushRaf()
    expect(scrollTop).toBe(700)

    scrollTop = 420
    await triggerIntent({ wrapper, chatPage })
    scrollHeight = 1350
    await flushRaf()

    expect(scrollTop).toBe(420)

    wrapper.unmount()
  } finally {
    rafSpy.mockRestore()
    cancelRafSpy.mockRestore()
  }
}

describe('ChatPage', () => {
  it('renders the agent plan inside an absolute overlay layer above the composer', async () => {
    const { wrapper, agentPlanStore } = await setup()

    agentPlanStore.snapshots.s1 = {
      sessionId: 's1',
      messageId: 'm1',
      plan: [{ step: 'Inspect runtime state', status: 'in_progress' }],
      explanation: 'Current implementation plan',
      revision: 1,
      updatedAt: '2026-05-18T00:00:00.000Z'
    }

    await flushPromises()

    const layer = wrapper.find('[data-testid="agent-progress-float-layer"]')

    expect(layer.exists()).toBe(true)
    expect(layer.classes()).toContain('absolute')
    expect(layer.classes()).toContain('pointer-events-none')
    expect(wrapper.find('.agent-progress-float-stub').exists()).toBe(true)
  })

  it('defers session restore until startup deferred tasks are released', async () => {
    const { messageStore, pendingInputStore, flushStartupDeferredTasks } = await setup({
      deferStartupTasks: true
    })

    expect(messageStore.clear).toHaveBeenCalledTimes(1)
    expect(pendingInputStore.clear).toHaveBeenCalledTimes(1)
    expect(messageStore.loadMessages).not.toHaveBeenCalled()
    expect(pendingInputStore.loadPendingInputs).not.toHaveBeenCalled()

    await flushStartupDeferredTasks()

    expect(messageStore.loadMessages).toHaveBeenCalledWith('s1', 40)
    expect(pendingInputStore.loadPendingInputs).toHaveBeenCalledWith('s1')
  })

  it('rehydrates the latest persisted plan for each switched session', async () => {
    const { wrapper, messageStore, agentPlanStore, flushStartupDeferredTasks } = await setup({
      deferStartupTasks: true,
      messages: []
    })
    const messagesBySession = {
      s1: [
        buildAssistantMessage([
          {
            type: 'plan',
            content: '',
            status: 'success',
            extra: {
              plan_entries: [{ step: 'Old plan', status: 'completed' }],
              plan_revision: 1,
              plan_updated_at: '2026-05-18T00:00:00.000Z'
            }
          }
        ]),
        {
          ...buildAssistantMessage([
            {
              type: 'plan',
              content: '',
              status: 'success',
              extra: {
                plan_entries: [{ step: 'Latest A plan', status: 'in_progress' }],
                plan_revision: 2,
                plan_updated_at: '2026-05-18T00:01:00.000Z'
              }
            }
          ]),
          id: 'm2'
        }
      ],
      s2: [
        {
          ...buildAssistantMessage([
            {
              type: 'plan',
              content: '',
              status: 'success',
              extra: {
                plan_entries: [{ step: 'B plan', status: 'in_progress' }],
                plan_revision: 1,
                plan_updated_at: '2026-05-18T00:02:00.000Z'
              }
            }
          ]),
          id: 'm3',
          sessionId: 's2'
        }
      ]
    }
    messageStore.loadMessages.mockImplementation(async (sessionId: 's1' | 's2') => {
      messageStore.messages = messagesBySession[sessionId]
    })

    await flushStartupDeferredTasks()

    expect(agentPlanStore.snapshots.s1.plan[0]?.step).toBe('Latest A plan')

    await wrapper.setProps({ sessionId: 's2' })
    await flushStartupDeferredTasks()

    expect(agentPlanStore.snapshots.s2.plan[0]?.step).toBe('B plan')

    await wrapper.setProps({ sessionId: 's1' })
    await flushStartupDeferredTasks()

    expect(agentPlanStore.snapshots.s1.plan[0]?.step).toBe('Latest A plan')
  })

  it('clears the active session snapshot when restored history has no plan block', async () => {
    const { wrapper, messageStore, agentPlanStore, flushStartupDeferredTasks } = await setup({
      deferStartupTasks: true,
      messages: []
    })
    messageStore.loadMessages.mockImplementation(async (sessionId: string) => {
      messageStore.messages =
        sessionId === 's1'
          ? [
              buildAssistantMessage([
                {
                  type: 'plan',
                  content: '',
                  status: 'success',
                  extra: {
                    plan_entries: [{ step: 'A plan', status: 'in_progress' }],
                    plan_revision: 1,
                    plan_updated_at: '2026-05-18T00:00:00.000Z'
                  }
                }
              ])
            ]
          : [
              {
                ...buildAssistantMessage([
                  {
                    type: 'content',
                    content: 'No plan here',
                    status: 'success'
                  }
                ]),
                id: 'm2',
                sessionId
              }
            ]
    })

    await flushStartupDeferredTasks()
    expect(agentPlanStore.snapshots.s1.plan[0]?.step).toBe('A plan')

    await wrapper.setProps({ sessionId: 's2' })
    await flushStartupDeferredTasks()

    expect(agentPlanStore.clearSnapshot).toHaveBeenCalledWith('s2')
    expect(agentPlanStore.snapshots.s2).toBeUndefined()
  })

  it('runs manual compaction instead of sending exact /compact in DeepChat sessions', async () => {
    const { wrapper, chatClient, sessionClient, messageStore } = await setup({
      activeSessionPatch: {
        providerId: 'openai',
        modelId: 'gpt-4'
      }
    })
    const input = wrapper.findComponent({ name: 'ChatInputBox' })

    input.vm.$emit('update:files', [
      {
        name: 'notes.md',
        path: '/repo/notes.md',
        mimeType: 'text/markdown'
      }
    ])
    input.vm.$emit('update:modelValue', '/compact')
    await flushPromises()
    input.vm.$emit('submit')
    await flushPromises()

    expect(sessionClient.compactSession).toHaveBeenCalledWith('s1')
    expect(messageStore.loadMessages).toHaveBeenCalledWith('s1', 40)
    expect(chatClient.sendMessage).not.toHaveBeenCalled()
    expect(input.props('files')).toEqual([
      {
        name: 'notes.md',
        path: '/repo/notes.md',
        mimeType: 'text/markdown'
      }
    ])
  })

  it('shows a no-op notice when manual compaction has no eligible history', async () => {
    const { wrapper, sessionClient, toast } = await setup({
      activeSessionPatch: {
        providerId: 'openai',
        modelId: 'gpt-4'
      }
    })
    sessionClient.compactSession.mockResolvedValueOnce({
      compacted: false,
      state: {
        status: 'idle',
        cursorOrderSeq: 1,
        summaryUpdatedAt: null
      }
    })
    const input = wrapper.findComponent({ name: 'ChatInputBox' })

    input.vm.$emit('command-submit', '/compact')
    await flushPromises()

    expect(toast).toHaveBeenCalledWith({
      title: 'chat.compaction.noopTitle',
      description: 'chat.compaction.noopDescription'
    })
  })

  it('does not queue or compact exact /compact while generating', async () => {
    const { wrapper, chatClient, sessionClient, pendingInputStore } = await setup({
      isStreaming: true,
      activeSessionPatch: {
        providerId: 'openai',
        modelId: 'gpt-4'
      }
    })
    const input = wrapper.findComponent({ name: 'ChatInputBox' })

    input.vm.$emit('command-submit', '/compact')
    await flushPromises()

    expect(input.props('isGenerating')).toBe(true)
    expect(sessionClient.compactSession).not.toHaveBeenCalled()
    expect(chatClient.sendMessage).not.toHaveBeenCalled()
    expect(pendingInputStore.queueInput).not.toHaveBeenCalled()
  })

  it('keeps ACP /compact submissions on the normal command path', async () => {
    const { wrapper, chatClient, sessionClient } = await setup()
    const input = wrapper.findComponent({ name: 'ChatInputBox' })

    input.vm.$emit('command-submit', '/compact')
    await flushPromises()

    expect(sessionClient.compactSession).not.toHaveBeenCalled()
    expect(chatClient.sendMessage).toHaveBeenCalledWith('s1', {
      text: '/compact',
      files: []
    })
  })

  it('sends composer skills with the message and clears the composer chip', async () => {
    const { wrapper, chatClient, chatInputGetPendingSkillsSnapshot, chatInputClearPendingSkills } =
      await setup()
    chatInputGetPendingSkillsSnapshot.mockReturnValue(['algorithmic-art', 'algorithmic-art'])
    const input = wrapper.findComponent({ name: 'ChatInputBox' })

    input.vm.$emit('update:modelValue', 'what can this skill do?')
    await flushPromises()
    input.vm.$emit('submit')
    await flushPromises()

    expect(chatClient.sendMessage).toHaveBeenCalledWith('s1', {
      text: 'what can this skill do?',
      files: [],
      activeSkills: ['algorithmic-art']
    })
    expect(chatInputClearPendingSkills).toHaveBeenCalled()
  })

  it('maps reasoning metadata into message usage for think duration fallback', async () => {
    const { wrapper, messageStore } = await setup()

    expect(messageStore.loadMessages).toHaveBeenCalledWith('s1', 40)

    const messageList = wrapper.findComponent({ name: 'MessageList' })
    const messages = messageList.props('messages') as Array<{
      usage: { reasoning_start_time: number; reasoning_end_time: number }
    }>

    expect(messages).toHaveLength(1)
    expect(messages[0].usage.reasoning_start_time).toBe(1_200)
    expect(messages[0].usage.reasoning_end_time).toBe(4_500)
  })

  it('rebuilds cached display messages when raw content or metadata change without updatedAt changing', async () => {
    const initialMessage = buildAssistantMessage([
      {
        type: 'content',
        content: 'first',
        status: 'success',
        timestamp: 1
      }
    ])
    const { wrapper, messageStore } = await setup({
      messages: [initialMessage]
    })

    const messageList = wrapper.findComponent({ name: 'MessageList' })
    const before = messageList.props('messages') as Array<{
      content: Array<{ content?: string }>
      usage: { total_tokens: number }
    }>

    expect(before[0].content[0]?.content).toBe('first')
    expect(before[0].usage.total_tokens).toBe(0)

    messageStore.messages[0] = {
      ...messageStore.messages[0],
      content: JSON.stringify([
        {
          type: 'content',
          content: 'second',
          status: 'success',
          timestamp: 1
        }
      ]),
      metadata: JSON.stringify({
        model: 'dimcode-acp',
        provider: 'acp',
        totalTokens: 42
      }),
      updatedAt: initialMessage.updatedAt
    }

    await flushPromises()

    const after = messageList.props('messages') as Array<{
      content: Array<{ content?: string }>
      usage: { total_tokens: number }
    }>

    expect(after[0].content[0]?.content).toBe('second')
    expect(after[0].usage.total_tokens).toBe(42)
  })

  it('extracts ephemeral rate-limit streaming blocks instead of creating a virtual assistant message', async () => {
    const { wrapper } = await setup({
      messages: [],
      isStreaming: true,
      currentStreamMessageId: '__rate_limit__:s1:1',
      streamingBlocks: [
        {
          type: 'action',
          action_type: 'rate_limit',
          status: 'pending',
          timestamp: 1
        }
      ]
    })

    const messageList = wrapper.findComponent({ name: 'MessageList' })
    expect(messageList.props('messages')).toEqual([])
    expect(messageList.props('ephemeralRateLimitMessageId')).toBe('__rate_limit__:s1:1')
    expect(messageList.props('ephemeralRateLimitBlock')).toEqual(
      expect.objectContaining({
        action_type: 'rate_limit'
      })
    )
    expect(wrapper.find('.message-list-stub').attributes('data-has-rate-limit')).toBe('true')
  })

  it('keeps pending lane visible below the tool interaction overlay', async () => {
    const { wrapper } = await setup({
      messages: [
        buildAssistantMessage([
          {
            type: 'action',
            action_type: 'question_request',
            status: 'pending',
            tool_call: {
              id: 'tool-1',
              name: 'question',
              params: '{}'
            }
          }
        ])
      ],
      pendingInputStorePatch: {
        items: [
          {
            id: 'p1',
            mode: 'queue',
            payload: { text: 'queued', files: [] }
          }
        ],
        queueItems: [
          {
            id: 'p1',
            mode: 'queue',
            payload: { text: 'queued', files: [] }
          }
        ]
      }
    })

    const html = wrapper.html()
    expect(wrapper.find('.chat-tool-interaction-overlay-stub').exists()).toBe(true)
    expect(wrapper.find('.pending-input-lane-stub').exists()).toBe(true)
    expect(wrapper.find('.chat-input-box-stub').exists()).toBe(false)
    expect(html.indexOf('pending-input-lane-stub')).toBeLessThan(
      html.indexOf('chat-tool-interaction-overlay-stub')
    )
  })

  it('keeps the interaction overlay open after an inline skill draft view', async () => {
    const { wrapper, chatRespondToolInteraction, messageStore } = await setup({
      messages: [
        buildAssistantMessage([
          {
            type: 'action',
            action_type: 'question_request',
            status: 'pending',
            timestamp: 1,
            tool_call: {
              id: 'tool-1',
              name: 'skill_manage'
            },
            extra: {
              needsUserAction: true,
              skillDraftAction: 'confirm',
              skillDraftId: 'draft-1'
            }
          }
        ])
      ]
    })
    chatRespondToolInteraction.mockResolvedValueOnce({ accepted: true, handledInline: true })

    await wrapper.find('.chat-tool-interaction-overlay-stub').trigger('click')
    await flushPromises()

    expect(chatRespondToolInteraction).toHaveBeenCalledTimes(1)
    expect(messageStore.loadMessages).toHaveBeenCalledWith('s1', undefined)
    expect(wrapper.find('.chat-tool-interaction-overlay-stub').exists()).toBe(true)
  })

  it('inserts workspace references into the active chat input for the matching session', async () => {
    const { chatInputInsertWorkspaceReference } = await setup()

    window.dispatchEvent(
      new CustomEvent(WORKSPACE_EVENTS.INSERT_REFERENCE_REQUESTED, {
        detail: {
          sessionId: 'other-session',
          filePath: 'C:/repo/other.ts'
        }
      })
    )
    await flushPromises()

    expect(chatInputInsertWorkspaceReference).not.toHaveBeenCalled()

    window.dispatchEvent(
      new CustomEvent(WORKSPACE_EVENTS.INSERT_REFERENCE_REQUESTED, {
        detail: {
          sessionId: 's1',
          filePath: 'C:/repo/README.md'
        }
      })
    )
    await flushPromises()

    expect(chatInputInsertWorkspaceReference).toHaveBeenCalledWith('C:/repo/README.md')
  })

  it('routes tool interaction responses through ChatClient and refreshes messages', async () => {
    const { wrapper, chatClient, messageStore } = await setup({
      messages: [
        buildAssistantMessage([
          {
            type: 'action',
            action_type: 'tool_call_permission',
            status: 'pending',
            timestamp: 1,
            tool_call: {
              id: 'tool-1',
              name: 'write_file'
            },
            extra: {
              permissionRequest:
                '{"permissionType":"write","serverName":"agent-filesystem","toolName":"write_file"}'
            }
          }
        ])
      ]
    })

    await wrapper.find('.chat-tool-interaction-overlay-stub').trigger('click')
    await flushPromises()

    expect(chatClient.respondToolInteraction).toHaveBeenCalledWith({
      sessionId: 's1',
      messageId: 'm1',
      toolCallId: 'tool-1',
      response: {
        kind: 'permission',
        granted: true
      }
    })
    expect(messageStore.loadMessages).toHaveBeenCalledWith('s1', undefined)
  })

  it('renders pending lane above the input box when no tool interaction is active', async () => {
    const { wrapper } = await setup({
      pendingInputStorePatch: {
        items: [
          {
            id: 'p1',
            mode: 'queue',
            payload: { text: 'queued', files: [] }
          }
        ],
        queueItems: [
          {
            id: 'p1',
            mode: 'queue',
            payload: { text: 'queued', files: [] }
          }
        ]
      }
    })

    const html = wrapper.html()
    expect(wrapper.find('.pending-input-lane-stub').exists()).toBe(true)
    expect(wrapper.find('.chat-input-box-stub').exists()).toBe(true)
    expect(html.indexOf('pending-input-lane-stub')).toBeLessThan(
      html.indexOf('chat-input-box-stub')
    )
  })

  it('rebaselines the active plan after queued steer succeeds', async () => {
    const { wrapper, pendingInputStore, agentPlanStore } = await setup({
      isStreaming: true,
      pendingInputStorePatch: {
        items: [
          {
            id: 'p1',
            mode: 'queue',
            payload: { text: 'queued', files: [] }
          }
        ],
        queueItems: [
          {
            id: 'p1',
            mode: 'queue',
            payload: { text: 'queued', files: [] }
          }
        ]
      }
    })

    agentPlanStore.beginTurn.mockClear()
    await wrapper.get('[data-testid="pending-lane-steer"]').trigger('click')
    await flushPromises()

    expect(pendingInputStore.steerPendingInput).toHaveBeenCalledWith('s1', 'p1')
    expect(agentPlanStore.beginTurn).toHaveBeenCalledWith('s1')
  })

  it('keeps the active plan when queued steer fails', async () => {
    const { wrapper, pendingInputStore, agentPlanStore, toast } = await setup({
      isStreaming: true,
      pendingInputStorePatch: {
        items: [
          {
            id: 'p1',
            mode: 'queue',
            payload: { text: 'queued', files: [] }
          }
        ],
        queueItems: [
          {
            id: 'p1',
            mode: 'queue',
            payload: { text: 'queued', files: [] }
          }
        ],
        steerPendingInput: vi.fn().mockRejectedValue(new Error('boom'))
      }
    })

    agentPlanStore.beginTurn.mockClear()
    await wrapper.get('[data-testid="pending-lane-steer"]').trigger('click')
    await flushPromises()

    expect(pendingInputStore.steerPendingInput).toHaveBeenCalledWith('s1', 'p1')
    expect(agentPlanStore.beginTurn).not.toHaveBeenCalled()
    expect(toast).toHaveBeenCalledWith({
      title: 'chat.pendingInput.steerFailed',
      variant: 'destructive'
    })
  })

  it('allows sending attachment-only drafts', async () => {
    const { wrapper, chatClient } = await setup()
    const file = { name: 'a.txt', path: '/tmp/a.txt', mimeType: 'text/plain' }

    const inputBox = wrapper.findComponent({ name: 'ChatInputBox' })
    inputBox.vm.$emit('update:files', [file])
    await flushPromises()

    const toolbar = wrapper.findComponent({ name: 'ChatInputToolbar' })
    expect(toolbar.props('hasInput')).toBe(true)
    expect(toolbar.props('sendDisabled')).toBe(false)
    expect(inputBox.props('submitDisabled')).toBe(false)

    inputBox.vm.$emit('submit')
    await flushPromises()

    expect(chatClient.sendMessage).toHaveBeenCalledWith('s1', {
      text: '',
      files: [file]
    })
  })

  it('forces bottom scroll after sending a new message', async () => {
    let nextFrameId = 1
    const rafCallbacks = new Map<number, FrameRequestCallback>()
    const flushRaf = async () => {
      const callbacks = Array.from(rafCallbacks.values())
      rafCallbacks.clear()
      callbacks.forEach((cb) => cb(0))
      await flushPromises()
    }
    const rafSpy = vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => {
      const frameId = nextFrameId
      nextFrameId += 1
      rafCallbacks.set(frameId, cb)
      return frameId
    })
    const cancelRafSpy = vi.spyOn(window, 'cancelAnimationFrame').mockImplementation((frameId) => {
      rafCallbacks.delete(frameId)
    })

    try {
      const { wrapper, chatClient } = await setup({
        deferStartupTasks: true
      })
      const chatPage = wrapper.get('[data-testid="chat-page"]').element as HTMLDivElement

      let scrollTop = 120
      Object.defineProperty(chatPage, 'clientHeight', {
        configurable: true,
        get: () => 500
      })
      Object.defineProperty(chatPage, 'scrollHeight', {
        configurable: true,
        get: () => 1200
      })
      Object.defineProperty(chatPage, 'scrollTop', {
        configurable: true,
        get: () => scrollTop,
        set: (value: number) => {
          scrollTop = value
        }
      })

      await wrapper.get('[data-testid="chat-page"]').trigger('scroll')
      await flushPromises()
      await flushRaf()

      const inputBox = wrapper.findComponent({ name: 'ChatInputBox' })
      await inputBox.vm.$emit('update:modelValue', 'send this')
      await flushPromises()

      inputBox.vm.$emit('submit')
      await flushPromises()
      await flushRaf()

      expect(chatClient.sendMessage).toHaveBeenCalledWith('s1', {
        text: 'send this',
        files: []
      })
      expect(scrollTop).toBe(700)

      wrapper.unmount()
    } finally {
      rafSpy.mockRestore()
      cancelRafSpy.mockRestore()
    }
  })

  it('queues active draft on submit while generating', async () => {
    const { wrapper, pendingInputStore, chatClient } = await setup({
      isStreaming: true
    })

    const inputBox = wrapper.findComponent({ name: 'ChatInputBox' })
    await inputBox.vm.$emit('update:modelValue', 'tighten the answer')
    await flushPromises()

    expect(inputBox.props('queueSubmitEnabled')).toBe(true)
    expect(inputBox.props('queueSubmitDisabled')).toBe(false)

    inputBox.vm.$emit('submit')
    await flushPromises()

    expect(pendingInputStore.queueInput).toHaveBeenCalledWith('s1', {
      text: 'tighten the answer',
      files: []
    })
    expect(chatClient.steerActiveTurn).not.toHaveBeenCalled()
    expect(chatClient.sendMessage).not.toHaveBeenCalled()
  })

  it('disables queue submit when the waiting queue is full but keeps steer button available', async () => {
    const { wrapper } = await setup({
      isStreaming: true,
      pendingInputStorePatch: {
        isAtCapacity: true
      }
    })

    const inputBox = wrapper.findComponent({ name: 'ChatInputBox' })
    await inputBox.vm.$emit('update:modelValue', 'tighten the answer')
    await flushPromises()

    const toolbar = wrapper.findComponent({ name: 'ChatInputToolbar' })
    expect(inputBox.props('submitDisabled')).toBe(true)
    expect(inputBox.props('queueSubmitDisabled')).toBe(true)
    expect(toolbar.props('sendDisabled')).toBe(true)
    expect(toolbar.props('queueDisabled')).toBe(true)
    // Steer button is always available when generating with input
    const steerButton = toolbar.find('[data-testid="chat-steer-button"]')
    expect(steerButton.exists()).toBe(true)
  })

  it('queues drafts explicitly while a generation is running', async () => {
    const { wrapper, pendingInputStore, chatClient } = await setup({
      isStreaming: true
    })

    const inputBox = wrapper.findComponent({ name: 'ChatInputBox' })
    await inputBox.vm.$emit('update:modelValue', 'do this next')
    await flushPromises()

    inputBox.vm.$emit('queue-submit')
    await flushPromises()

    expect(pendingInputStore.queueInput).toHaveBeenCalledWith('s1', {
      text: 'do this next',
      files: []
    })
    expect(chatClient.steerActiveTurn).not.toHaveBeenCalled()
  })

  it('scrolls to bottom using max scrollTop during stream updates near bottom', async () => {
    let nextFrameId = 1
    const rafCallbacks = new Map<number, FrameRequestCallback>()
    const flushRaf = async () => {
      const callbacks = Array.from(rafCallbacks.values())
      rafCallbacks.clear()
      callbacks.forEach((cb) => cb(0))
      await flushPromises()
    }
    const rafSpy = vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => {
      const frameId = nextFrameId
      nextFrameId += 1
      rafCallbacks.set(frameId, cb)
      return frameId
    })
    const cancelRafSpy = vi.spyOn(window, 'cancelAnimationFrame').mockImplementation((frameId) => {
      rafCallbacks.delete(frameId)
    })

    try {
      const { wrapper, messageStore } = await setup()
      const chatPage = wrapper.get('[data-testid="chat-page"]').element as HTMLDivElement

      let scrollHeight = 1200
      let scrollTop = 0
      Object.defineProperty(chatPage, 'clientHeight', {
        configurable: true,
        get: () => 500
      })
      Object.defineProperty(chatPage, 'scrollHeight', {
        configurable: true,
        get: () => scrollHeight
      })
      Object.defineProperty(chatPage, 'scrollTop', {
        configurable: true,
        get: () => scrollTop,
        set: (value: number) => {
          scrollTop = value
        }
      })

      await flushRaf()

      scrollTop = 700
      await wrapper.get('[data-testid="chat-page"]').trigger('scroll')
      await flushPromises()
      await flushRaf()

      scrollHeight = 1250
      messageStore.streamRevision += 1
      await flushPromises()
      await flushRaf()

      expect(scrollTop).toBe(750)
    } finally {
      rafSpy.mockRestore()
      cancelRafSpy.mockRestore()
    }
  })

  it('keeps scrolling to bottom while restored session layout settles', async () => {
    let nextFrameId = 1
    const rafCallbacks = new Map<number, FrameRequestCallback>()
    const flushRaf = async () => {
      const callbacks = Array.from(rafCallbacks.values())
      rafCallbacks.clear()
      callbacks.forEach((cb) => cb(0))
      await flushPromises()
    }
    const rafSpy = vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => {
      const frameId = nextFrameId
      nextFrameId += 1
      rafCallbacks.set(frameId, cb)
      return frameId
    })
    const cancelRafSpy = vi.spyOn(window, 'cancelAnimationFrame').mockImplementation((frameId) => {
      rafCallbacks.delete(frameId)
    })

    try {
      const { wrapper, flushStartupDeferredTasks } = await setup({
        deferStartupTasks: true
      })
      const chatPage = wrapper.get('[data-testid="chat-page"]').element as HTMLDivElement

      let scrollHeight = 1200
      let scrollTop = 0
      Object.defineProperty(chatPage, 'clientHeight', {
        configurable: true,
        get: () => 500
      })
      Object.defineProperty(chatPage, 'scrollHeight', {
        configurable: true,
        get: () => scrollHeight
      })
      Object.defineProperty(chatPage, 'scrollTop', {
        configurable: true,
        get: () => scrollTop,
        set: (value: number) => {
          scrollTop = value
        }
      })

      await flushStartupDeferredTasks()
      await flushRaf()
      expect(scrollTop).toBe(700)

      scrollHeight = 1350
      await flushRaf()
      expect(scrollTop).toBe(850)

      wrapper.unmount()
    } finally {
      rafSpy.mockRestore()
      cancelRafSpy.mockRestore()
    }
  })

  it('stops session restore bottom settling after user scroll intent', async () => {
    await expectSessionRestoreSettleStopsAfter(async ({ wrapper }) => {
      await wrapper.get('[data-testid="chat-page"]').trigger('wheel')
    })
  })

  it('stops session restore bottom settling after pointer scroll intent', async () => {
    await expectSessionRestoreSettleStopsAfter(async ({ wrapper }) => {
      await wrapper.get('[data-testid="chat-page"]').trigger('pointerdown')
    })
  })

  it('stops session restore bottom settling after keyboard scroll intent', async () => {
    await expectSessionRestoreSettleStopsAfter(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'PageUp' }))
      await flushPromises()
    })
  })

  it('opens the inline search with Ctrl+F and closes it with Escape', async () => {
    const { wrapper } = await setup()

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'f', ctrlKey: true }))
    await flushPromises()
    expect(wrapper.find('.chat-search-bar-stub').exists()).toBe(true)

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    await flushPromises()
    expect(wrapper.find('.chat-search-bar-stub').exists()).toBe(false)
  })

  it('renders subagent sessions as read-only display mode', async () => {
    const { wrapper } = await setup({
      sessionKind: 'subagent',
      messages: [
        buildAssistantMessage([
          {
            type: 'action',
            action_type: 'question_request',
            status: 'pending',
            tool_call: {
              id: 'tool-1',
              name: 'question',
              params: '{}'
            }
          }
        ])
      ],
      pendingInputStorePatch: {
        queueItems: [
          {
            id: 'p1',
            mode: 'queue',
            payload: { text: 'queued', files: [] }
          }
        ]
      }
    })

    expect(wrapper.find('.chat-top-bar-stub').attributes('data-read-only')).toBe('true')
    expect(wrapper.find('.message-list-stub').attributes('data-read-only')).toBe('true')
    expect(wrapper.find('.chat-input-box-stub').exists()).toBe(false)
    expect(wrapper.find('.pending-input-lane-stub').exists()).toBe(false)
    expect(wrapper.find('.chat-tool-interaction-overlay-stub').exists()).toBe(false)
    expect(wrapper.findComponent({ name: 'ChatStatusBar' }).exists()).toBe(false)
  })

  it('consumes pending spotlight message jumps after loading the target session', async () => {
    vi.useFakeTimers()
    const scrollIntoView = vi.fn()
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
      value: scrollIntoView,
      configurable: true
    })

    const { wrapper, spotlightStore } = await setup({
      spotlightPendingJump: {
        sessionId: 's1',
        messageId: 'm1'
      }
    })

    await flushPromises()

    expect(wrapper.find('[data-message-id="m1"]').classes()).toContain('message-highlight')
    expect(scrollIntoView).toHaveBeenCalled()
    expect(spotlightStore.clearPendingMessageJump).toHaveBeenCalled()
    vi.useRealTimers()
  })
})

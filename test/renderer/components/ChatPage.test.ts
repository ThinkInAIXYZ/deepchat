import { describe, expect, it, vi } from 'vitest'
import { defineComponent, provide, reactive, ref } from 'vue'
import { flushPromises, mount } from '@vue/test-utils'
import { WORKSPACE_EVENTS } from '@/events'

function createDeferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((innerResolve) => {
    resolve = innerResolve
  })
  return { promise, resolve }
}

const passthrough = (name: string) =>
  defineComponent({
    name,
    template: '<div><slot /></div>'
  })

const clickStub = (name: string) =>
  defineComponent({
    name,
    emits: ['click'],
    template: '<button type="button" @click="$emit(\'click\', $event)"><slot /></button>'
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
  sessions?: Array<Record<string, unknown>>
  isStreaming?: boolean
  streamingBlocks?: unknown[]
  currentStreamMessageId?: string | null
  currentStreamSessionId?: string | null
  currentSessionId?: string | null
  committedSessionId?: string | null
  pendingInputStorePatch?: Record<string, unknown>
  sessionKind?: 'regular' | 'subagent'
  activeSessionPatch?: Record<string, unknown>
  spotlightPendingJump?: { sessionId: string; messageId: string } | null
  deferStartupTasks?: boolean
  autoScrollEnabled?: boolean
  cachedMeasurements?: Readonly<Record<string, number>>
  mockChatSearch?: boolean
  performanceReporter?: {
    recordChatSession: ReturnType<typeof vi.fn>
  }
}

const setup = async (options: SetupOptions = {}) => {
  vi.resetModules()
  vi.doUnmock('@/features/chat-page/composables/useChatSearch')

  const activeStatus = String(options.activeSessionPatch?.status ?? 'idle')
  const sessionStore = reactive({
    activeSession: {
      id: 's1',
      title: 'Session',
      projectDir: 'C:/repo',
      providerId: 'acp',
      modelId: 'dimcode-acp',
      status: activeStatus,
      sessionKind: options.sessionKind ?? 'regular',
      ...options.activeSessionPatch
    },
    activeSessionId: 's1',
    sessions: options.sessions ?? [
      {
        id: 's1',
        title: 'Session',
        agentId: 'default',
        status: activeStatus,
        projectDir: 'C:/repo',
        sessionKind: options.sessionKind ?? 'regular'
      }
    ],
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
    currentSessionId: options.currentSessionId === undefined ? 's1' : options.currentSessionId,
    committedSessionId:
      options.committedSessionId === undefined ? 's1' : options.committedSessionId,
    committedSession:
      options.committedSessionId === null
        ? null
        : {
            id: options.committedSessionId ?? 's1'
          },
    currentStreamSessionId:
      options.currentStreamSessionId === undefined
        ? options.isStreaming
          ? 's1'
          : null
        : options.currentStreamSessionId,
    hasMoreHistory: false,
    isLoadingHistory: false,
    historyLoadError: false,
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
    loadMessages: vi.fn(),
    loadOlderMessages: vi.fn().mockResolvedValue(0),
    activateRecentSessionView: vi.fn().mockReturnValue(false),
    invalidateRecentSessionView: vi.fn(),
    clear: vi.fn(),
    clearStreamingState: vi.fn(),
    clearStreamingStateForOtherSession: vi.fn(),
    addOptimisticUserMessage: vi.fn().mockReturnValue('__optimistic_user_1'),
    removeOptimisticMessage: vi.fn()
  })
  messageStore.loadMessages.mockImplementation(async (sessionId: string) => {
    messageStore.currentSessionId = sessionId
    messageStore.committedSessionId = sessionId
    messageStore.committedSession = { id: sessionId }
    return { id: sessionId }
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
    resolveBlockedInput: vi.fn().mockResolvedValue(undefined),
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
    autoScrollEnabled: options.autoScrollEnabled ?? true
  })

  const chatRespondToolInteraction = vi.fn().mockResolvedValue({ accepted: true })
  let planUpdatedListener: ((payload: any) => void) | null = null
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
    onPlanUpdated: vi.fn((listener: (payload: any) => void) => {
      planUpdatedListener = listener
      return () => {
        planUpdatedListener = null
      }
    })
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
  const notify = vi.fn()
  const chatInputInsertWorkspaceReference = vi.fn().mockReturnValue(true)
  const chatInputTriggerAttach = vi.fn()
  const chatInputGetPendingSkillsSnapshot = vi.fn((): string[] => [])
  const chatInputClearPendingSkills = vi.fn()
  const attachmentPreparationStore = reactive({
    consumeInitialDraftRecovery: vi.fn(() => null),
    stageInitialDraftRecovery: vi.fn(),
    clear: vi.fn()
  })

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
  vi.doMock('@/stores/ui/attachmentPreparation', () => ({
    useAttachmentPreparationStore: () => attachmentPreparationStore
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
  vi.doMock('@renderer-notifications/rendererNotificationPort', () => ({
    notifyRenderer: notify
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
  vi.doMock('@shadcn/components/ui/button', () => ({
    Button: clickStub('Button')
  }))
  vi.doMock('@shadcn/components/ui/alert-dialog', () => ({
    AlertDialog: defineComponent({
      name: 'AlertDialog',
      props: {
        open: {
          type: Boolean,
          default: false
        }
      },
      emits: ['update:open'],
      template: '<div v-if="open" class="alert-dialog-stub"><slot /></div>'
    }),
    AlertDialogAction: clickStub('AlertDialogAction'),
    AlertDialogCancel: clickStub('AlertDialogCancel'),
    AlertDialogContent: passthrough('AlertDialogContent'),
    AlertDialogDescription: passthrough('AlertDialogDescription'),
    AlertDialogFooter: passthrough('AlertDialogFooter'),
    AlertDialogHeader: passthrough('AlertDialogHeader'),
    AlertDialogTitle: passthrough('AlertDialogTitle')
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
        },
        resolveCaptureParentId: {
          type: Function,
          default: undefined
        },
        beforeSpacerHeight: {
          type: Number,
          default: 0
        },
        afterSpacerHeight: {
          type: Number,
          default: 0
        },
        disableMarkdownVirtualization: {
          type: Boolean,
          default: false
        }
      },
      template:
        '<div class="message-list-stub" :data-read-only="String(isReadOnly)" :data-has-rate-limit="String(Boolean(ephemeralRateLimitBlock))" :data-disable-markdown-virtualization="String(disableMarkdownVirtualization)"><div data-message-window-origin aria-hidden="true" /><div v-for="message in messages" :key="message.renderKey ?? message.id" class="message-item-stub" :data-message-id="message.id" :data-render-key="message.renderKey ?? message.id"><span v-if="message.role === \'user\'">{{ message.content.text }}</span><span v-else>{{ message.content[0]?.content }}</span></div></div>'
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
        agentId: {
          type: String,
          default: 'deepchat'
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
      template:
        '<div class="chat-input-box-stub" :data-agent-id="agentId"><slot name="toolbar" /></div>'
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
        },
        steerDisabled: {
          type: Boolean,
          default: false
        },
        isSteering: {
          type: Boolean,
          default: false
        },
        isStopping: {
          type: Boolean,
          default: false
        }
      },
      emits: ['attach', 'queue', 'send', 'steer', 'stop'],
      template:
        '<div class="chat-input-toolbar-stub"><button v-if="isGenerating && hasInput" data-testid="chat-steer-button" :disabled="steerDisabled || isSteering" @click="$emit(\'steer\')" /><button v-if="isGenerating && !hasInput" data-testid="chat-stop-button" :disabled="isStopping" @click="$emit(\'stop\')" /></div>'
    })
  }))
  vi.doMock('@/components/chat/AgentProgressFloat.vue', () => ({
    default: defineComponent({
      name: 'AgentProgressFloat',
      props: {
        snapshot: {
          type: Object,
          default: null
        }
      },
      emits: ['toggle-collapse'],
      template:
        '<button class="agent-progress-float-stub" :data-session-id="snapshot?.sessionId ?? \'\'" :data-message-id="snapshot?.messageId ?? \'\'" @click="$emit(\'toggle-collapse\')" />'
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
    default: defineComponent({
      name: 'ChatStatusBar',
      template: '<div class="chat-status-bar-stub" />'
    })
  }))
  vi.doMock('@/components/chat/MemoryUpdateChip.vue', () => ({
    default: defineComponent({
      name: 'MemoryUpdateChip',
      props: {
        visible: {
          type: Boolean,
          default: true
        }
      },
      template: '<div class="memory-update-chip-stub" :data-visible="String(visible)" />'
    })
  }))
  vi.doMock('@/components/chat/MemoryTurnDialog.vue', () => ({
    default: defineComponent({
      name: 'MemoryTurnDialog',
      template: '<div class="memory-turn-dialog-stub" />'
    })
  }))
  vi.doMock('@/components/chat/ChatToolInteractionOverlay.vue', () => ({
    default: defineComponent({
      name: 'ChatToolInteractionOverlay',
      emits: ['respond'],
      template:
        '<button class="chat-tool-interaction-overlay-stub" @click="$emit(\'respond\', { kind: \'permission\', granted: true })" />'
    })
  }))
  const disposeChatSearch = vi.fn()
  if (options.mockChatSearch) {
    vi.doMock('@/features/chat-page/composables/useChatSearch', () => ({
      useChatSearch: () => ({
        isChatSearchOpen: ref(false),
        chatSearchQuery: ref(''),
        activeChatSearchIndex: ref(0),
        setChatSearchBarRef: vi.fn(),
        chatSearchResults: ref([]),
        closeChatSearch: vi.fn(),
        clearChatSearchState: vi.fn(),
        goToNextChatSearchMatch: vi.fn(),
        goToPreviousChatSearchMatch: vi.fn(),
        handleSearchKeydown: vi.fn(),
        disposeChatSearch
      })
    }))
  }
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

  const { recentMessageMeasurementCache } =
    await import('@/composables/message/recentMessageMeasurementCache')
  recentMessageMeasurementCache.clear()
  if (options.cachedMeasurements) {
    recentMessageMeasurementCache.set('s1', options.cachedMeasurements)
    messageStore.activateRecentSessionView.mockReturnValue(true)
  }

  const ChatPage = (await import('@/features/chat-page/ChatPage.vue')).default
  const { RENDERER_PERFORMANCE_REPORTER } =
    await import('@/platform/performance/rendererPerformance')
  const Host = defineComponent({
    components: { ChatPage },
    setup() {
      if (options.performanceReporter) {
        provide(RENDERER_PERFORMANCE_REPORTER, options.performanceReporter as never)
      }
    },
    template: '<ChatPage session-id="s1" />'
  })
  const wrapper = mount(Host)

  await flushPromises()

  return {
    wrapper,
    chatClient,
    chatRespondToolInteraction,
    sessionClient,
    sessionStore,
    notify,
    messageStore,
    pendingInputStore,
    agentPlanStore,
    spotlightStore,
    chatInputInsertWorkspaceReference,
    chatInputTriggerAttach,
    chatInputGetPendingSkillsSnapshot,
    chatInputClearPendingSkills,
    recentMessageMeasurementCache,
    disposeChatSearch,
    emitPlanUpdated: (payload: any) => {
      planUpdatedListener?.(payload)
    },
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

async function expectSessionRestoreTransactionStopsAfter(
  triggerIntent: (context: {
    wrapper: ChatPageSetupResult['wrapper']
    chatPage: HTMLDivElement
  }) => Promise<void> | void,
  scrollTopAfterIntent = 420
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

    scrollTop = scrollTopAfterIntent
    await triggerIntent({ wrapper, chatPage })
    scrollHeight = 1350
    await flushRaf()

    expect(scrollTop).toBe(scrollTopAfterIntent)

    wrapper.unmount()
  } finally {
    rafSpy.mockRestore()
    cancelRafSpy.mockRestore()
  }
}

describe('ChatPage', () => {
  it('passes the active session Agent to the ChatInputBox Skill scope', async () => {
    const { wrapper } = await setup({
      activeSessionPatch: { agentId: 'agent-b' }
    })

    expect(wrapper.findComponent({ name: 'ChatInputBox' }).props('agentId')).toBe('agent-b')
  })

  it('reports only safe chat-session phase and epoch metadata', async () => {
    const performanceReporter = { recordChatSession: vi.fn() }

    await setup({ performanceReporter })

    expect(performanceReporter.recordChatSession).toHaveBeenCalledWith('selected', 1)
    expect(performanceReporter.recordChatSession).toHaveBeenCalledWith('messages-prepared', 1)
    expect(performanceReporter.recordChatSession).toHaveBeenCalledWith('messages-committed', 1)
    expect(JSON.stringify(performanceReporter.recordChatSession.mock.calls)).not.toContain('s1')
  })

  it('disposes chat search resources when the page unmounts', async () => {
    const { disposeChatSearch, wrapper } = await setup({ mockChatSearch: true })

    expect(disposeChatSearch).not.toHaveBeenCalled()

    wrapper.unmount()

    expect(disposeChatSearch).toHaveBeenCalledTimes(1)
  })

  it('isolates header, message viewport, and composer into independent shell rows', async () => {
    const { wrapper } = await setup()
    const shell = wrapper.get('[data-testid="chat-page-shell"]')
    const viewport = wrapper.get('[data-testid="chat-page"]')
    const topBar = wrapper.get('.chat-top-bar-stub')
    const composer = wrapper.get('[data-testid="chat-composer-region"]')

    expect(shell.classes()).toContain('overflow-hidden')
    expect(viewport.classes()).toContain('overflow-y-auto')
    expect(viewport.element.contains(topBar.element)).toBe(false)
    expect(viewport.element.contains(composer.element)).toBe(false)
    expect(shell.element.contains(viewport.element)).toBe(true)
    expect(shell.element.contains(composer.element)).toBe(true)

    wrapper.unmount()
  })

  it('bounds mounted message rows for long loaded histories', async () => {
    const messages = Array.from({ length: 300 }, (_, index) => ({
      ...buildAssistantMessage([
        {
          type: 'content',
          content: `message ${index}`,
          status: 'success',
          timestamp: index
        }
      ]),
      id: `m${index}`,
      orderSeq: index + 1,
      createdAt: index + 1,
      updatedAt: index + 1
    }))
    const { wrapper } = await setup({ messages })
    const messageList = wrapper.findComponent({ name: 'MessageList' })

    expect((messageList.props('messages') as unknown[]).length).toBeLessThanOrEqual(90)
    const resolveCaptureParentId = messageList.props('resolveCaptureParentId') as (
      messageId: string,
      parentId?: string
    ) => string | undefined
    expect(resolveCaptureParentId).toBeTypeOf('function')
    expect(resolveCaptureParentId('m150')).toBeUndefined()
    expect(messageList.props('beforeSpacerHeight')).toBeGreaterThan(0)
  })

  it('restores cached measurements before the first keyed-session render', async () => {
    const messages = Array.from({ length: 300 }, (_, index) => ({
      ...buildAssistantMessage([
        {
          type: 'content',
          content: `message ${index}`,
          status: 'success',
          timestamp: index
        }
      ]),
      id: `m${index}`,
      orderSeq: index + 1,
      createdAt: index + 1,
      updatedAt: index + 1
    }))
    const baseline = await setup({ messages, deferStartupTasks: true })
    const baselineBefore = Number(
      baseline.wrapper.findComponent({ name: 'MessageList' }).props('beforeSpacerHeight')
    )
    baseline.wrapper.unmount()

    const cached = await setup({
      messages,
      deferStartupTasks: true,
      cachedMeasurements: { m0: 500 }
    })
    const cachedBefore = Number(
      cached.wrapper.findComponent({ name: 'MessageList' }).props('beforeSpacerHeight')
    )

    expect(cachedBefore - baselineBefore).toBe(312)
    cached.wrapper.unmount()
  })

  it('stores current measurements when a keyed ChatPage instance unmounts', async () => {
    const { wrapper, recentMessageMeasurementCache } = await setup({ deferStartupTasks: true })
    wrapper.findComponent({ name: 'MessageList' }).vm.$emit('measure', {
      messageId: 'm1',
      height: 333
    })
    await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()))

    wrapper.unmount()

    expect(recentMessageMeasurementCache.get('s1')).toMatchObject({ m1: 333 })
  })

  it('keeps the agent plan in the composer region outside message scroll geometry', async () => {
    const { wrapper, agentPlanStore } = await setup({
      activeSessionPatch: { status: 'working' }
    })

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
    const composer = wrapper.get('[data-testid="chat-composer-region"]')
    const viewport = wrapper.get('[data-testid="chat-page"]')

    expect(layer.exists()).toBe(true)
    expect(layer.classes()).toContain('absolute')
    expect(layer.classes()).toContain('pointer-events-none')
    expect(composer.element.contains(layer.element)).toBe(true)
    expect(viewport.element.contains(layer.element)).toBe(false)
    expect(wrapper.find('.agent-progress-float-stub').exists()).toBe(true)
  })

  it('constrains the combined plan and interaction panel to a scrollable viewport area', async () => {
    const { wrapper, agentPlanStore } = await setup({
      activeSessionPatch: { status: 'working' },
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
      ]
    })

    agentPlanStore.snapshots.s1 = {
      sessionId: 's1',
      messageId: 'm1',
      plan: Array.from({ length: 12 }, (_, index) => ({
        step: `Plan step ${index}`,
        status: index === 0 ? 'in_progress' : 'pending'
      })),
      revision: 1,
      updatedAt: '2026-05-18T00:00:00.000Z'
    }

    await flushPromises()

    const panel = wrapper.find('.agent-question-panel')

    expect(panel.exists()).toBe(true)
    expect(panel.classes()).toContain('max-h-[min(70vh,calc(100vh-12rem))]')
    expect(panel.classes()).toContain('overflow-x-hidden')
    expect(panel.classes()).toContain('overflow-y-auto')
    expect(wrapper.find('.agent-progress-float-stub').exists()).toBe(true)
    expect(wrapper.find('.chat-tool-interaction-overlay-stub').exists()).toBe(true)
  })

  it('keeps live plan snapshots for multiple sessions and renders only the active session', async () => {
    const { wrapper, agentPlanStore, emitPlanUpdated, sessionStore } = await setup({
      activeSessionPatch: { status: 'working' },
      sessions: [
        { id: 's1', title: 'A', agentId: 'default', status: 'working', projectDir: 'C:/a' },
        { id: 's2', title: 'B', agentId: 'default', status: 'working', projectDir: 'C:/b' },
        { id: 's3', title: 'C', agentId: 'default', status: 'working', projectDir: 'C:/c' }
      ]
    })

    emitPlanUpdated({
      sessionId: 's1',
      messageId: 'm-a',
      plan: [{ step: 'A plan', status: 'in_progress' }],
      revision: 1,
      updatedAt: '2026-05-18T00:00:00.000Z'
    })
    emitPlanUpdated({
      sessionId: 's2',
      messageId: 'm-b',
      plan: [{ step: 'B plan', status: 'in_progress' }],
      revision: 1,
      updatedAt: '2026-05-18T00:00:01.000Z'
    })
    emitPlanUpdated({
      sessionId: 's3',
      messageId: 'm-c',
      plan: [{ step: 'C plan', status: 'in_progress' }],
      revision: 1,
      updatedAt: '2026-05-18T00:00:02.000Z'
    })
    await flushPromises()

    expect(Object.keys(agentPlanStore.snapshots).sort()).toEqual(['s1', 's2', 's3'])
    expect(wrapper.find('.agent-progress-float-stub').attributes('data-session-id')).toBe('s1')
    expect(wrapper.findAll('.agent-progress-float-stub')).toHaveLength(1)

    sessionStore.activeSession = {
      ...sessionStore.activeSession,
      id: 's2',
      status: 'working'
    }
    sessionStore.activeSessionId = 's2'
    await wrapper.setProps({ sessionId: 's2' })
    await flushPromises()

    expect(wrapper.find('.agent-progress-float-stub').attributes('data-session-id')).toBe('s2')
    expect(agentPlanStore.snapshots.s1?.plan[0]?.step).toBe('A plan')

    sessionStore.activeSession = {
      ...sessionStore.activeSession,
      id: 's1',
      status: 'working'
    }
    sessionStore.activeSessionId = 's1'
    await wrapper.setProps({ sessionId: 's1' })
    await flushPromises()

    expect(wrapper.find('.agent-progress-float-stub').attributes('data-session-id')).toBe('s1')
    expect(agentPlanStore.snapshots.s2?.plan[0]?.step).toBe('B plan')
  })

  it('keeps an in-progress plan when the plan event arrives before working status', async () => {
    const { wrapper, agentPlanStore, emitPlanUpdated, sessionStore } = await setup({
      activeSessionPatch: { status: 'none' },
      sessions: [{ id: 's1', title: 'A', agentId: 'default', status: 'none', projectDir: 'C:/a' }]
    })

    emitPlanUpdated({
      sessionId: 's1',
      messageId: 'm-a',
      plan: [{ step: 'Early plan', status: 'in_progress' }],
      revision: 1,
      updatedAt: '2026-05-18T00:00:00.000Z'
    })
    await flushPromises()

    expect(agentPlanStore.snapshots.s1?.plan[0]?.step).toBe('Early plan')
    expect(agentPlanStore.clearSnapshot).not.toHaveBeenCalledWith('s1')
    expect(wrapper.find('.agent-progress-float-stub').exists()).toBe(false)

    sessionStore.activeSession = {
      ...sessionStore.activeSession,
      status: 'working'
    }
    sessionStore.sessions = [
      {
        ...sessionStore.sessions[0],
        status: 'working'
      }
    ]
    await flushPromises()

    expect(wrapper.find('.agent-progress-float-stub').attributes('data-session-id')).toBe('s1')
  })

  it('clears a terminal plan without clearing another running session plan', async () => {
    vi.useFakeTimers()
    try {
      const { agentPlanStore, emitPlanUpdated } = await setup({
        activeSessionPatch: { status: 'idle' },
        sessions: [
          { id: 's1', title: 'A', agentId: 'default', status: 'idle', projectDir: 'C:/a' },
          { id: 's2', title: 'B', agentId: 'default', status: 'working', projectDir: 'C:/b' }
        ]
      })

      emitPlanUpdated({
        sessionId: 's1',
        messageId: 'm-a',
        plan: [{ step: 'A plan', status: 'completed' }],
        terminalReason: 'aborted',
        revision: 2,
        updatedAt: '2026-05-18T00:00:00.000Z'
      })
      emitPlanUpdated({
        sessionId: 's2',
        messageId: 'm-b',
        plan: [{ step: 'B plan', status: 'in_progress' }],
        revision: 1,
        updatedAt: '2026-05-18T00:00:01.000Z'
      })
      await flushPromises()

      expect(agentPlanStore.snapshots.s1).toBeDefined()
      expect(agentPlanStore.snapshots.s2).toBeDefined()

      await vi.advanceTimersByTimeAsync(1_200)
      await flushPromises()

      expect(agentPlanStore.snapshots.s1).toBeUndefined()
      expect(agentPlanStore.snapshots.s2?.plan[0]?.step).toBe('B plan')
    } finally {
      vi.useRealTimers()
    }
  })

  it('defers session restore until startup deferred tasks are released', async () => {
    const { messageStore, pendingInputStore, flushStartupDeferredTasks } = await setup({
      deferStartupTasks: true
    })

    expect(messageStore.clear).not.toHaveBeenCalled()
    expect(messageStore.clearStreamingState).not.toHaveBeenCalled()
    expect(messageStore.clearStreamingStateForOtherSession).toHaveBeenCalledWith('s1')
    expect(pendingInputStore.clear).toHaveBeenCalledTimes(1)
    expect(messageStore.loadMessages).not.toHaveBeenCalled()
    expect(pendingInputStore.loadPendingInputs).not.toHaveBeenCalled()

    await flushStartupDeferredTasks()

    expect(messageStore.loadMessages).toHaveBeenCalledWith('s1', 100)
    expect(pendingInputStore.loadPendingInputs).toHaveBeenCalledWith('s1')
  })

  it('releases a cold-session composer when another load commits the selected view', async () => {
    const pageRestore = createDeferred<null>()
    const { wrapper, messageStore, chatClient, flushStartupDeferredTasks } = await setup({
      messages: [],
      currentSessionId: 's1',
      committedSessionId: null,
      deferStartupTasks: true
    })
    messageStore.loadMessages.mockReturnValueOnce(pageRestore.promise)
    const input = wrapper.findComponent({ name: 'ChatInputBox' })

    input.vm.$emit('update:modelValue', 'first turn')
    await flushPromises()
    expect(wrapper.find('[data-testid="chat-session-loading-overlay"]').exists()).toBe(true)
    expect(input.props('submitDisabled')).toBe(true)

    const drainingStartupTasks = flushStartupDeferredTasks()
    await flushPromises()
    expect(messageStore.loadMessages).toHaveBeenCalledWith('s1', 100)

    messageStore.committedSessionId = 's1'
    messageStore.committedSession = { id: 's1' }
    await flushPromises()

    expect(wrapper.find('[data-testid="chat-session-loading-overlay"]').exists()).toBe(false)
    expect(input.props('submitDisabled')).toBe(false)
    input.vm.$emit('submit')
    await flushPromises()
    expect(chatClient.sendMessage).toHaveBeenCalledWith('s1', {
      text: 'first turn',
      files: []
    })

    pageRestore.resolve(null)
    await drainingStartupTasks
    wrapper.unmount()
  })

  it('hides the previous session behind a fixed viewport overlay until atomic commit', async () => {
    const targetLoad = createDeferred<void>()
    const { wrapper, messageStore } = await setup()
    messageStore.loadMessages.mockReturnValueOnce(
      targetLoad.promise.then(() => {
        messageStore.currentSessionId = 's2'
        messageStore.committedSessionId = 's2'
        messageStore.committedSession = { id: 's2' }
        return { id: 's2' }
      })
    )

    await wrapper.setProps({ sessionId: 's2' })
    await flushPromises()

    const viewportRegion = wrapper.get('[data-testid="chat-viewport-region"]')
    const scrollViewport = wrapper.get('[data-testid="chat-page"]')
    const loadingOverlay = wrapper.get('[data-testid="chat-session-loading-overlay"]')

    expect(loadingOverlay.get('[data-testid="chat-session-skeleton"]').exists()).toBe(true)
    expect(loadingOverlay.attributes('role')).toBe('status')
    expect(loadingOverlay.attributes('aria-busy')).toBe('true')
    expect(loadingOverlay.attributes('aria-label')).toBe('common.loading')
    expect(loadingOverlay.text()).not.toContain('common.loading')
    expect(loadingOverlay.element.parentElement).toBe(viewportRegion.element)
    expect(scrollViewport.element.parentElement).toBe(viewportRegion.element)
    expect(scrollViewport.find('[data-testid="chat-session-loading-overlay"]').exists()).toBe(false)
    expect(wrapper.findComponent({ name: 'MessageList' }).props('messages')).toEqual([])
    expect(messageStore.clear).not.toHaveBeenCalled()

    targetLoad.resolve()
    await flushPromises()

    expect(wrapper.find('[data-testid="chat-session-loading-overlay"]').exists()).toBe(false)
    wrapper.unmount()
  })

  it('keeps an uncached target behind the loading overlay when restore does not commit', async () => {
    const { wrapper, messageStore } = await setup()
    messageStore.loadMessages.mockResolvedValueOnce(null)

    await wrapper.setProps({ sessionId: 's2' })
    await flushPromises()

    expect(messageStore.committedSessionId).toBe('s1')
    expect(wrapper.find('[data-testid="chat-session-loading-overlay"]').exists()).toBe(true)
    expect(wrapper.findComponent({ name: 'ChatInputBox' }).props('submitDisabled')).toBe(true)

    wrapper.unmount()
  })

  it('renders a cached target session immediately without the loading overlay', async () => {
    const refresh = createDeferred<void>()
    const { wrapper, messageStore } = await setup()
    const cachedMessage = {
      ...buildAssistantMessage([
        { type: 'content', content: 'cached session', status: 'success', timestamp: 2 }
      ]),
      id: 's2-message',
      sessionId: 's2'
    }
    messageStore.activateRecentSessionView.mockImplementation((sessionId: string) => {
      if (sessionId !== 's2') return false
      messageStore.messages = [cachedMessage]
      messageStore.messageIds = [cachedMessage.id]
      messageStore.messageCache = new Map([[cachedMessage.id, cachedMessage]])
      messageStore.currentSessionId = 's2'
      messageStore.committedSessionId = 's2'
      messageStore.committedSession = { id: 's2' }
      return true
    })
    messageStore.loadMessages.mockReturnValueOnce(refresh.promise)

    await wrapper.setProps({ sessionId: 's2' })
    await flushPromises()

    const renderedMessages = wrapper
      .findComponent({ name: 'MessageList' })
      .props('messages') as Array<{
      id: string
    }>
    expect(wrapper.find('[data-testid="chat-session-loading-overlay"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="chat-session-skeleton"]').exists()).toBe(false)
    expect(renderedMessages.map((message) => message.id)).toEqual(['s2-message'])

    refresh.resolve()
    wrapper.unmount()
  })

  it('does not compensate history scroll after switching sessions', async () => {
    const deferredHistoryLoad = createDeferred<number>()
    const deferredSessionLoad = createDeferred<unknown>()
    const messages = Array.from({ length: 100 }, (_, index) => ({
      ...buildAssistantMessage([
        { type: 'content', content: `message ${index}`, status: 'success', timestamp: index }
      ]),
      id: `history-${index}`,
      orderSeq: index + 1
    }))
    const { wrapper, messageStore } = await setup({ messages, deferStartupTasks: true })
    const chatPage = wrapper.get('[data-testid="chat-page"]').element as HTMLDivElement

    let scrollHeight = 1000
    let scrollTop = 40
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

    messageStore.hasMoreHistory = true
    messageStore.loadOlderMessages.mockReturnValueOnce(deferredHistoryLoad.promise)
    await wrapper.get('[data-testid="chat-page"]').trigger('wheel', { deltaY: -20 })
    await wrapper.get('[data-testid="chat-page"]').trigger('scroll')
    expect(messageStore.loadOlderMessages).not.toHaveBeenCalled()
    await wrapper.get('[data-testid="chat-page"]').trigger('scrollend')
    expect(messageStore.loadOlderMessages).toHaveBeenCalledOnce()

    messageStore.loadMessages.mockReturnValueOnce(
      deferredSessionLoad.promise.then((session) => {
        messageStore.currentSessionId = 's2'
        messageStore.committedSessionId = 's2'
        messageStore.committedSession = { id: 's2' }
        return session
      })
    )
    await wrapper.setProps({ sessionId: 's2' })
    scrollHeight = 1500

    deferredHistoryLoad.resolve(20)
    await flushPromises()

    expect(scrollTop).toBe(40)

    deferredSessionLoad.resolve(undefined)
    wrapper.unmount()
  })

  it('anchors prepended history to virtual layout instead of volatile DOM height', async () => {
    const messages = Array.from({ length: 180 }, (_, index) => ({
      ...buildAssistantMessage([
        {
          type: 'content',
          content: `message ${index}`,
          status: 'success',
          timestamp: index
        }
      ]),
      id: `m${index}`,
      orderSeq: index + 3,
      createdAt: index + 3,
      updatedAt: index + 3
    }))
    const deferredHistoryLoad = createDeferred<void>()
    const { wrapper, messageStore } = await setup({ messages, deferStartupTasks: true })
    const chatPage = wrapper.get('[data-testid="chat-page"]').element as HTMLDivElement

    let scrollHeight = 1000
    let scrollTop = 40
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

    const olderMessages = [
      {
        ...buildAssistantMessage([
          { type: 'content', content: 'older 1', status: 'success', timestamp: 1 }
        ]),
        id: 'older-1',
        orderSeq: 1
      },
      {
        ...buildAssistantMessage([
          { type: 'content', content: 'older 2', status: 'success', timestamp: 2 }
        ]),
        id: 'older-2',
        orderSeq: 2
      }
    ]

    messageStore.hasMoreHistory = true
    messageStore.loadOlderMessages.mockImplementationOnce(async () => {
      await deferredHistoryLoad.promise
      messageStore.messages.unshift(...olderMessages)
      messageStore.messageIds.unshift(...olderMessages.map((message) => message.id))
      olderMessages.forEach((message) => messageStore.messageCache.set(message.id, message))
      // Simulate the virtual DOM swapping to rows whose actual heights differ from
      // the previous window. Pagination compensation must not use this value.
      scrollHeight = 5000
      return olderMessages.length
    })

    await wrapper.get('[data-testid="chat-page"]').trigger('wheel', { deltaY: -20 })
    await wrapper.get('[data-testid="chat-page"]').trigger('scroll')
    expect(messageStore.loadOlderMessages).not.toHaveBeenCalled()
    await wrapper.get('[data-testid="chat-page"]').trigger('scrollend')
    expect(messageStore.loadOlderMessages).toHaveBeenCalledOnce()

    // Keep moving upward while the request is in flight. The eventual correction
    // must preserve this latest position, not the position where loading started.
    scrollTop = 20
    deferredHistoryLoad.resolve()
    await flushPromises()

    // Each short assistant row is estimated at 184px plus its 4px visual spacing.
    expect(scrollTop).toBe(20 + 188 * olderMessages.length)

    wrapper.unmount()
  })

  it('does not chain another history request from the compensation scroll event', async () => {
    const messages = Array.from({ length: 100 }, (_, index) => ({
      ...buildAssistantMessage([
        { type: 'content', content: `message ${index}`, status: 'success', timestamp: index }
      ]),
      id: `history-${index}`,
      orderSeq: index + 1
    }))
    const { wrapper, messageStore } = await setup({ messages, deferStartupTasks: true })
    const chatPage = wrapper.get('[data-testid="chat-page"]').element as HTMLDivElement

    let scrollTop = 20
    Object.defineProperty(chatPage, 'clientHeight', {
      configurable: true,
      get: () => 500
    })
    Object.defineProperty(chatPage, 'scrollHeight', {
      configurable: true,
      get: () => 1000
    })
    Object.defineProperty(chatPage, 'scrollTop', {
      configurable: true,
      get: () => scrollTop,
      set: (value: number) => {
        scrollTop = value
      }
    })

    messageStore.hasMoreHistory = true
    messageStore.loadOlderMessages.mockResolvedValue(1)

    await wrapper.get('[data-testid="chat-page"]').trigger('wheel', { deltaY: -20 })
    await wrapper.get('[data-testid="chat-page"]').trigger('scroll')
    expect(messageStore.loadOlderMessages).not.toHaveBeenCalled()
    await wrapper.get('[data-testid="chat-page"]').trigger('scrollend')
    await flushPromises()
    expect(messageStore.loadOlderMessages).toHaveBeenCalledOnce()

    // Browsers dispatch scroll after the compensation write. It must remain part
    // of the same programmatic history operation even when the viewport is at top.
    await wrapper.get('[data-testid="chat-page"]').trigger('scroll')
    expect(messageStore.loadOlderMessages).toHaveBeenCalledOnce()

    wrapper.unmount()
  })

  it('does not load history from a layout-only scroll event at the top', async () => {
    const { wrapper, messageStore } = await setup({ deferStartupTasks: true })
    const chatPage = wrapper.get('[data-testid="chat-page"]').element as HTMLDivElement

    Object.defineProperty(chatPage, 'clientHeight', { configurable: true, get: () => 500 })
    Object.defineProperty(chatPage, 'scrollHeight', { configurable: true, get: () => 1000 })
    Object.defineProperty(chatPage, 'scrollTop', { configurable: true, get: () => 20 })

    messageStore.hasMoreHistory = true
    await wrapper.get('[data-testid="chat-page"]').trigger('scroll')

    expect(messageStore.loadOlderMessages).not.toHaveBeenCalled()
    wrapper.unmount()
  })

  it('loads history when upward intent begins at the top without another scroll event', async () => {
    vi.useFakeTimers()
    try {
      const messages = Array.from({ length: 100 }, (_, index) => ({
        ...buildAssistantMessage([
          { type: 'content', content: `message ${index}`, status: 'success', timestamp: index }
        ]),
        id: `history-${index}`,
        orderSeq: index + 1
      }))
      const { wrapper, messageStore } = await setup({ messages, deferStartupTasks: true })
      const chatPage = wrapper.get('[data-testid="chat-page"]').element as HTMLDivElement
      Object.defineProperty(chatPage, 'clientHeight', { configurable: true, get: () => 500 })
      Object.defineProperty(chatPage, 'scrollHeight', { configurable: true, get: () => 1200 })
      Object.defineProperty(chatPage, 'scrollTop', { configurable: true, get: () => 0 })
      messageStore.hasMoreHistory = true
      messageStore.loadOlderMessages.mockResolvedValue(1)

      await wrapper.get('[data-testid="chat-page"]').trigger('wheel', { deltaY: -20 })
      await vi.advanceTimersByTimeAsync(140)
      await flushPromises()

      expect(messageStore.loadOlderMessages).toHaveBeenCalledOnce()
      wrapper.unmount()
    } finally {
      vi.useRealTimers()
    }
  })

  it('keeps touch ownership through momentum until scrollend', async () => {
    vi.useFakeTimers()
    try {
      const messages = Array.from({ length: 100 }, (_, index) => ({
        ...buildAssistantMessage([
          { type: 'content', content: `message ${index}`, status: 'success', timestamp: index }
        ]),
        id: `history-${index}`,
        orderSeq: index + 1
      }))
      const { wrapper, messageStore } = await setup({ messages, deferStartupTasks: true })
      const viewport = wrapper.get('[data-testid="chat-page"]')
      const chatPage = viewport.element as HTMLDivElement
      Object.defineProperty(chatPage, 'clientHeight', { configurable: true, get: () => 500 })
      Object.defineProperty(chatPage, 'scrollHeight', { configurable: true, get: () => 1200 })
      Object.defineProperty(chatPage, 'scrollTop', { configurable: true, get: () => 0 })
      messageStore.hasMoreHistory = true
      messageStore.loadOlderMessages.mockResolvedValue(1)

      await viewport.trigger('touchstart', { touches: [{ clientY: 100 }] })
      await viewport.trigger('touchmove', { touches: [{ clientY: 120 }] })
      await viewport.trigger('touchend')
      await vi.advanceTimersByTimeAsync(100)
      await viewport.trigger('scroll')
      await vi.advanceTimersByTimeAsync(100)

      expect(messageStore.loadOlderMessages).not.toHaveBeenCalled()
      await viewport.trigger('scrollend')
      await flushPromises()
      expect(messageStore.loadOlderMessages).toHaveBeenCalledOnce()
      wrapper.unmount()
    } finally {
      vi.useRealTimers()
    }
  })

  it('does not paginate a short conversation after a small upward scroll', async () => {
    const messages = Array.from({ length: 4 }, (_, index) => ({
      ...buildAssistantMessage([
        { type: 'content', content: `short ${index}`, status: 'success', timestamp: index }
      ]),
      id: `short-${index}`,
      orderSeq: index + 1
    }))
    const { wrapper, messageStore } = await setup({ messages, deferStartupTasks: true })
    const chatPage = wrapper.get('[data-testid="chat-page"]').element as HTMLDivElement

    Object.defineProperty(chatPage, 'clientHeight', { configurable: true, get: () => 500 })
    Object.defineProperty(chatPage, 'scrollHeight', { configurable: true, get: () => 800 })
    Object.defineProperty(chatPage, 'scrollTop', { configurable: true, get: () => 20 })

    messageStore.hasMoreHistory = true
    await wrapper.get('[data-testid="chat-page"]').trigger('wheel', { deltaY: -20 })
    await wrapper.get('[data-testid="chat-page"]').trigger('scroll')
    await wrapper.get('[data-testid="chat-page"]').trigger('scrollend')

    expect(messageStore.loadOlderMessages).not.toHaveBeenCalled()
    wrapper.unmount()
  })

  it('does not paginate near the top when the user scrolls toward newer messages', async () => {
    const messages = Array.from({ length: 100 }, (_, index) => ({
      ...buildAssistantMessage([
        { type: 'content', content: `message ${index}`, status: 'success', timestamp: index }
      ]),
      id: `direction-${index}`,
      orderSeq: index + 1
    }))
    const { wrapper, messageStore } = await setup({ messages, deferStartupTasks: true })
    const chatPage = wrapper.get('[data-testid="chat-page"]').element as HTMLDivElement

    Object.defineProperty(chatPage, 'clientHeight', { configurable: true, get: () => 500 })
    Object.defineProperty(chatPage, 'scrollHeight', { configurable: true, get: () => 1000 })
    Object.defineProperty(chatPage, 'scrollTop', { configurable: true, get: () => 20 })

    messageStore.hasMoreHistory = true
    await wrapper.get('[data-testid="chat-page"]').trigger('wheel', { deltaY: 20 })
    await wrapper.get('[data-testid="chat-page"]').trigger('scroll')
    await wrapper.get('[data-testid="chat-page"]').trigger('scrollend')

    expect(messageStore.loadOlderMessages).not.toHaveBeenCalled()
    wrapper.unmount()
  })

  it('keeps the history loading indicator outside message flow', async () => {
    const { wrapper, messageStore } = await setup({ deferStartupTasks: true })

    messageStore.isLoadingHistory = true
    await flushPromises()

    const indicator = wrapper.get('[data-testid="history-loading-indicator"]')
    expect(indicator.classes()).toContain('h-0')
    expect(indicator.find('[data-testid="history-loading-label"]').exists()).toBe(true)
    wrapper.unmount()
  })

  it('retries failed history loading even before the initial restore threshold', async () => {
    const messages = Array.from({ length: 20 }, (_, index) => ({
      ...buildAssistantMessage([
        { type: 'content', content: `message ${index}`, status: 'success', timestamp: index }
      ]),
      id: `history-${index}`,
      orderSeq: index + 1
    }))
    const { wrapper, messageStore } = await setup({ messages, deferStartupTasks: true })
    const chatPage = wrapper.get('[data-testid="chat-page"]').element as HTMLDivElement
    let scrollTop = 0
    Object.defineProperty(chatPage, 'clientHeight', { configurable: true, get: () => 500 })
    Object.defineProperty(chatPage, 'scrollHeight', { configurable: true, get: () => 1200 })
    Object.defineProperty(chatPage, 'scrollTop', {
      configurable: true,
      get: () => scrollTop,
      set: (value: number) => {
        scrollTop = value
      }
    })

    messageStore.hasMoreHistory = true
    messageStore.historyLoadError = true
    await flushPromises()

    const error = wrapper.get('[data-testid="history-load-error"]')
    expect(error.attributes('role')).toBe('alert')
    await wrapper.get('[data-testid="history-load-retry"]').trigger('click')
    await flushPromises()

    expect(messageStore.loadOlderMessages).toHaveBeenCalledOnce()
    wrapper.unmount()
  })

  it('does not rehydrate persisted plan blocks when switching sessions', async () => {
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
      messageStore.currentSessionId = sessionId
      messageStore.committedSessionId = sessionId
      messageStore.committedSession = { id: sessionId }
      return { id: sessionId }
    })

    await flushStartupDeferredTasks()

    expect(agentPlanStore.applySnapshot).not.toHaveBeenCalled()
    expect(agentPlanStore.snapshots.s1).toBeUndefined()

    await wrapper.setProps({ sessionId: 's2' })
    await flushStartupDeferredTasks()

    expect(agentPlanStore.applySnapshot).not.toHaveBeenCalled()
    expect(agentPlanStore.snapshots.s2).toBeUndefined()

    await wrapper.setProps({ sessionId: 's1' })
    await flushStartupDeferredTasks()

    expect(agentPlanStore.applySnapshot).not.toHaveBeenCalled()
    expect(agentPlanStore.snapshots.s1).toBeUndefined()
  })

  it('keeps the active live plan snapshot while restoring messages', async () => {
    const { messageStore, agentPlanStore, flushStartupDeferredTasks } = await setup({
      deferStartupTasks: true,
      activeSessionPatch: { status: 'working' },
      messages: []
    })
    agentPlanStore.snapshots.s1 = {
      sessionId: 's1',
      messageId: 'm1',
      plan: [{ step: 'Live plan', status: 'in_progress' }],
      revision: 1,
      updatedAt: '2026-05-18T00:00:00.000Z'
    }
    messageStore.loadMessages.mockImplementation(async () => {
      messageStore.messages = [
        buildAssistantMessage([
          {
            type: 'content',
            content: 'No plan here',
            status: 'success'
          }
        ])
      ]
    })

    await flushStartupDeferredTasks()

    expect(agentPlanStore.clearSnapshot).not.toHaveBeenCalledWith('s1')
    expect(agentPlanStore.snapshots.s1?.plan[0]?.step).toBe('Live plan')
  })

  it('does not render legacy plan-only assistant messages as empty rows', async () => {
    const planOnlyMessage = buildAssistantMessage([
      {
        type: 'plan',
        content: '',
        status: 'success',
        timestamp: 1,
        extra: {
          plan_entries: [{ step: 'Old plan', status: 'completed' }],
          plan_revision: 1,
          plan_updated_at: '2026-05-18T00:00:00.000Z'
        }
      }
    ])
    const contentMessage = {
      ...buildAssistantMessage([
        {
          type: 'content',
          content: 'Real response',
          status: 'success',
          timestamp: 2
        }
      ]),
      id: 'm2',
      orderSeq: 2
    }

    const { wrapper } = await setup({
      messages: [planOnlyMessage, contentMessage]
    })
    const messageList = wrapper.findComponent({ name: 'MessageList' })
    const messages = messageList.props('messages') as Array<{ id: string }>

    expect(messages.map((message) => message.id)).toEqual(['m2'])
    expect(wrapper.findAll('.message-item-stub')).toHaveLength(1)
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
    expect(messageStore.loadMessages).toHaveBeenCalledWith('s1', 100)
    expect(chatClient.sendMessage).not.toHaveBeenCalled()
    expect(messageStore.addOptimisticUserMessage).not.toHaveBeenCalled()
    const messageList = wrapper.findComponent({ name: 'MessageList' })
    const messages = messageList.props('messages') as Array<{ id: string }>
    expect(messages.some((message) => message.id.startsWith('__pending_assistant_'))).toBe(false)
    expect(input.props('files')).toEqual([
      {
        name: 'notes.md',
        path: '/repo/notes.md',
        mimeType: 'text/markdown'
      }
    ])
  })

  it('does not apply a null result from a superseded compaction restore', async () => {
    const { wrapper, messageStore, sessionStore } = await setup({
      activeSessionPatch: {
        providerId: 'openai',
        modelId: 'gpt-4'
      }
    })
    const applyRestoredSession = vi.fn()
    ;(
      sessionStore as typeof sessionStore & {
        applyRestoredSession: (session: unknown) => void
      }
    ).applyRestoredSession = applyRestoredSession
    messageStore.loadMessages.mockResolvedValueOnce(null)

    wrapper.findComponent({ name: 'ChatInputBox' }).vm.$emit('command-submit', '/compact')
    await flushPromises()

    expect(messageStore.loadMessages).toHaveBeenCalledWith('s1', 100)
    expect(applyRestoredSession).not.toHaveBeenCalled()
  })

  it('shows a no-op notice when manual compaction has no eligible history', async () => {
    const { wrapper, sessionClient, notify, messageStore } = await setup({
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

    expect(notify).toHaveBeenCalledWith({
      kind: 'info',
      code: 'chat.compaction.unchanged',
      title: 'chat.compaction.noopTitle',
      description: 'chat.compaction.noopDescription'
    })
    expect(messageStore.addOptimisticUserMessage).not.toHaveBeenCalled()
    const messageList = wrapper.findComponent({ name: 'MessageList' })
    const messages = messageList.props('messages') as Array<{ id: string }>
    expect(messages.some((message) => message.id.startsWith('__pending_assistant_'))).toBe(false)
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

  it('queues command submit while keeping the active turn placeholder', async () => {
    const { wrapper, chatClient, pendingInputStore, messageStore } = await setup({
      isStreaming: true
    })
    const input = wrapper.findComponent({ name: 'ChatInputBox' })

    input.vm.$emit('command-submit', '/diagnose')
    await flushPromises()

    expect(pendingInputStore.queueInput).toHaveBeenCalledWith('s1', {
      text: '/diagnose',
      files: []
    })
    expect(chatClient.sendMessage).not.toHaveBeenCalled()
    expect(messageStore.addOptimisticUserMessage).not.toHaveBeenCalled()
    const messageList = wrapper.findComponent({ name: 'MessageList' })
    const messages = messageList.props('messages') as Array<{ id: string }>
    expect(messages.filter((message) => message.id.startsWith('__pending_assistant_'))).toEqual([
      expect.objectContaining({ id: '__pending_assistant_generating_s1' })
    ])
  })

  it('keeps ACP /compact submissions on the normal command path', async () => {
    const deferredSend = createDeferred<{ accepted: true; requestId: null; messageId: null }>()
    const { wrapper, chatClient, sessionClient, messageStore } = await setup()
    chatClient.sendMessage.mockReturnValueOnce(deferredSend.promise)
    const input = wrapper.findComponent({ name: 'ChatInputBox' })

    input.vm.$emit('command-submit', '/compact')
    await flushPromises()

    expect(sessionClient.compactSession).not.toHaveBeenCalled()
    expect(chatClient.sendMessage).toHaveBeenCalledWith('s1', {
      text: '/compact',
      files: []
    })
    expect(messageStore.addOptimisticUserMessage).toHaveBeenCalledWith('s1', {
      text: '/compact',
      files: []
    })
    const messageList = wrapper.findComponent({ name: 'MessageList' })
    const messages = messageList.props('messages') as Array<{ id: string }>
    expect(messages.some((message) => message.id.startsWith('__pending_assistant_'))).toBe(true)

    deferredSend.resolve({ accepted: true, requestId: null, messageId: null })
    await flushPromises()
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

  it('does not submit after another navigation takes message-store ownership', async () => {
    const { wrapper, messageStore, chatClient } = await setup()
    const input = wrapper.findComponent({ name: 'ChatInputBox' })

    input.vm.$emit('update:modelValue', 'stale submit')
    await flushPromises()
    input.vm.$emit('submit')
    messageStore.currentSessionId = 's2'
    await flushPromises()

    expect(messageStore.addOptimisticUserMessage).not.toHaveBeenCalled()
    expect(chatClient.sendMessage).not.toHaveBeenCalled()
  })

  it('shows a pending assistant row immediately after submitting before stream starts', async () => {
    const deferredSend = createDeferred<{ accepted: true; requestId: null; messageId: null }>()
    const { wrapper, chatClient, messageStore } = await setup()
    chatClient.sendMessage.mockReturnValueOnce(deferredSend.promise)
    const input = wrapper.findComponent({ name: 'ChatInputBox' })

    input.vm.$emit('update:modelValue', 'slow first token')
    await flushPromises()
    input.vm.$emit('submit')
    await flushPromises()

    const messageList = wrapper.findComponent({ name: 'MessageList' })
    const messages = messageList.props('messages') as Array<{ id: string; role: string }>
    expect(messageStore.addOptimisticUserMessage).toHaveBeenCalledWith('s1', {
      text: 'slow first token',
      files: []
    })
    expect(messages.some((message) => message.id.startsWith('__pending_assistant_'))).toBe(true)

    messageStore.isStreaming = true
    messageStore.currentStreamSessionId = 's1'
    await flushPromises()

    const streamingMessages = messageList.props('messages') as Array<{ id: string; role: string }>
    const pendingAssistant = streamingMessages.find((message) =>
      message.id.startsWith('__pending_assistant_')
    )
    expect(pendingAssistant).toBeDefined()

    const firstChunkMessage = {
      ...buildAssistantMessage([
        {
          type: 'content',
          content: 'first chunk',
          status: 'loading',
          timestamp: 2
        }
      ]),
      id: 'assistant-stream-1',
      orderSeq: 2,
      status: 'pending' as const
    }
    messageStore.currentStreamMessageId = firstChunkMessage.id
    messageStore.streamingBlocks = JSON.parse(firstChunkMessage.content)
    messageStore.messages.push(firstChunkMessage)
    messageStore.messageIds.push(firstChunkMessage.id)
    messageStore.messageCache.set(firstChunkMessage.id, firstChunkMessage)
    await flushPromises()

    const firstChunkMessages = messageList.props('messages') as Array<{
      id: string
      renderKey?: string
    }>
    const firstChunkAssistant = firstChunkMessages.find(
      (message) => message.id === firstChunkMessage.id
    )
    expect(
      firstChunkMessages.some((message) => message.id.startsWith('__pending_assistant_'))
    ).toBe(false)
    expect(firstChunkAssistant?.renderKey).toBe(pendingAssistant?.id)

    deferredSend.resolve({ accepted: true, requestId: null, messageId: null })
    await flushPromises()
  })

  it('shows a pending assistant row when a generating session mounts before its first stream', async () => {
    const { wrapper } = await setup({
      activeSessionPatch: { status: 'working' },
      messages: [
        {
          id: 'user-1',
          sessionId: 's1',
          orderSeq: 1,
          role: 'user',
          content: JSON.stringify({ text: 'slow first token', files: [] }),
          status: 'sent',
          isContextEdge: 0,
          metadata: '{}',
          traceCount: 0,
          createdAt: 1,
          updatedAt: 1
        }
      ]
    })

    const messageList = wrapper.findComponent({ name: 'MessageList' })
    const messages = messageList.props('messages') as Array<{ id: string; role: string }>

    expect(messages.map((message) => message.id)).toEqual([
      'user-1',
      '__pending_assistant_generating_s1'
    ])
  })

  it('hides the pending assistant row when a real assistant message materializes before streaming starts', async () => {
    const deferredSend = createDeferred<{ accepted: true; requestId: null; messageId: null }>()
    const { wrapper, chatClient, messageStore } = await setup()
    chatClient.sendMessage.mockReturnValueOnce(deferredSend.promise)
    const input = wrapper.findComponent({ name: 'ChatInputBox' })

    input.vm.$emit('update:modelValue', 'assistant arrives first')
    await flushPromises()
    input.vm.$emit('submit')
    await flushPromises()

    const messageList = wrapper.findComponent({ name: 'MessageList' })
    const pendingMessages = messageList.props('messages') as Array<{ id: string; role: string }>
    expect(pendingMessages.some((message) => message.id.startsWith('__pending_assistant_'))).toBe(
      true
    )

    const realAssistantMessage = {
      ...buildAssistantMessage([
        {
          type: 'content',
          content: 'hello',
          status: 'pending',
          timestamp: 2
        }
      ]),
      id: 'm2',
      orderSeq: 2
    }
    messageStore.messages.push(realAssistantMessage)
    messageStore.messageIds.push(realAssistantMessage.id)
    messageStore.messageCache.set(realAssistantMessage.id, realAssistantMessage)
    await flushPromises()

    const materializedMessages = messageList.props('messages') as Array<{
      id: string
      role: string
    }>
    expect(
      materializedMessages.some((message) => message.id.startsWith('__pending_assistant_'))
    ).toBe(false)
    expect(materializedMessages.some((message) => message.id === 'm2')).toBe(true)

    deferredSend.resolve({ accepted: true, requestId: null, messageId: null })
    await flushPromises()
  })

  it('keeps the pending assistant row when older assistant history is loaded', async () => {
    const deferredSend = createDeferred<{ accepted: true; requestId: null; messageId: null }>()
    const { wrapper, chatClient, messageStore } = await setup()
    chatClient.sendMessage.mockReturnValueOnce(deferredSend.promise)
    const input = wrapper.findComponent({ name: 'ChatInputBox' })

    input.vm.$emit('update:modelValue', 'wait for first token')
    await flushPromises()
    input.vm.$emit('submit')
    await flushPromises()

    const messageList = wrapper.findComponent({ name: 'MessageList' })
    const pendingMessages = messageList.props('messages') as Array<{ id: string; role: string }>
    expect(pendingMessages.some((message) => message.id.startsWith('__pending_assistant_'))).toBe(
      true
    )

    const olderAssistantMessage = {
      ...buildAssistantMessage([
        {
          type: 'content',
          content: 'older',
          status: 'success',
          timestamp: 1
        }
      ]),
      id: 'older-assistant',
      orderSeq: 0,
      createdAt: 0,
      updatedAt: 0
    }
    messageStore.messages.unshift(olderAssistantMessage)
    messageStore.messageIds.unshift(olderAssistantMessage.id)
    messageStore.messageCache.set(olderAssistantMessage.id, olderAssistantMessage)
    await flushPromises()

    const messagesAfterHistory = messageList.props('messages') as Array<{
      id: string
      role: string
    }>
    expect(
      messagesAfterHistory.some((message) => message.id.startsWith('__pending_assistant_'))
    ).toBe(true)
    expect(messagesAfterHistory.some((message) => message.id === 'older-assistant')).toBe(true)

    deferredSend.resolve({ accepted: true, requestId: null, messageId: null })
    await flushPromises()
  })

  it('shows a pending assistant row immediately after command submit before stream starts', async () => {
    const deferredSend = createDeferred<{ accepted: true; requestId: null; messageId: null }>()
    const { wrapper, chatClient, messageStore } = await setup()
    chatClient.sendMessage.mockReturnValueOnce(deferredSend.promise)
    const input = wrapper.findComponent({ name: 'ChatInputBox' })

    input.vm.$emit('command-submit', '/diagnose')
    await flushPromises()

    const messageList = wrapper.findComponent({ name: 'MessageList' })
    const messages = messageList.props('messages') as Array<{ id: string; role: string }>
    expect(chatClient.sendMessage).toHaveBeenCalledWith('s1', {
      text: '/diagnose',
      files: []
    })
    expect(messageStore.addOptimisticUserMessage).toHaveBeenCalledWith('s1', {
      text: '/diagnose',
      files: []
    })
    expect(messages.some((message) => message.id.startsWith('__pending_assistant_'))).toBe(true)

    deferredSend.resolve({ accepted: true, requestId: null, messageId: null })
    await flushPromises()
  })

  it('keeps command submit attachments and skills until send is accepted', async () => {
    const deferredSend = createDeferred<{ accepted: true; requestId: null; messageId: null }>()
    const {
      wrapper,
      chatClient,
      messageStore,
      chatInputGetPendingSkillsSnapshot,
      chatInputClearPendingSkills
    } = await setup()
    chatClient.sendMessage.mockReturnValueOnce(deferredSend.promise)
    chatInputGetPendingSkillsSnapshot.mockReturnValue(['algorithmic-art'])
    const file = { name: 'a.txt', path: '/tmp/a.txt', mimeType: 'text/plain' }
    const input = wrapper.findComponent({ name: 'ChatInputBox' })

    input.vm.$emit('update:files', [file])
    await flushPromises()
    expect(input.props('files')).toEqual([file])

    input.vm.$emit('command-submit', '/diagnose')
    await flushPromises()

    const messageList = wrapper.findComponent({ name: 'MessageList' })
    const messages = messageList.props('messages') as Array<{ id: string }>
    expect(messageStore.addOptimisticUserMessage).toHaveBeenCalledWith('s1', {
      text: '/diagnose',
      files: [file],
      activeSkills: ['algorithmic-art']
    })
    expect(messages.some((message) => message.id.startsWith('__pending_assistant_'))).toBe(true)
    expect(input.props('files')).toEqual([file])
    expect(chatInputClearPendingSkills).not.toHaveBeenCalled()

    deferredSend.resolve({ accepted: true, requestId: null, messageId: null })
    await flushPromises()
    expect(input.props('files')).toEqual([])
    expect(chatInputClearPendingSkills).toHaveBeenCalled()
  })

  it('clears the pending assistant row when sending fails before streaming starts', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    try {
      const { wrapper, chatClient, messageStore } = await setup()
      chatClient.sendMessage.mockRejectedValueOnce(new Error('send failed'))
      const input = wrapper.findComponent({ name: 'ChatInputBox' })

      input.vm.$emit('update:modelValue', 'will fail')
      await flushPromises()
      input.vm.$emit('submit')
      await flushPromises()

      const messageList = wrapper.findComponent({ name: 'MessageList' })
      const messages = messageList.props('messages') as Array<{ id: string }>
      expect(messages.some((message) => message.id.startsWith('__pending_assistant_'))).toBe(false)
      expect(messageStore.removeOptimisticMessage).toHaveBeenCalledWith('__optimistic_user_1', 's1')
    } finally {
      errorSpy.mockRestore()
    }
  })

  it('clears the pending assistant row when command submit fails before streaming starts', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    try {
      const { wrapper, chatClient, messageStore } = await setup()
      chatClient.sendMessage.mockRejectedValueOnce(new Error('send failed'))
      const input = wrapper.findComponent({ name: 'ChatInputBox' })

      input.vm.$emit('command-submit', '/diagnose')
      await flushPromises()

      const messageList = wrapper.findComponent({ name: 'MessageList' })
      const messages = messageList.props('messages') as Array<{ id: string }>
      expect(messages.some((message) => message.id.startsWith('__pending_assistant_'))).toBe(false)
      expect(messageStore.removeOptimisticMessage).toHaveBeenCalledWith('__optimistic_user_1', 's1')
    } finally {
      errorSpy.mockRestore()
    }
  })

  it('clears the pending assistant row when switching sessions', async () => {
    const deferredSend = createDeferred<{ accepted: true; requestId: null; messageId: null }>()
    const { wrapper, chatClient } = await setup()
    chatClient.sendMessage.mockReturnValueOnce(deferredSend.promise)
    const input = wrapper.findComponent({ name: 'ChatInputBox' })

    input.vm.$emit('update:modelValue', 'switch away')
    await flushPromises()
    input.vm.$emit('submit')
    await flushPromises()

    await wrapper.setProps({ sessionId: 's2' })
    await flushPromises()

    const messageList = wrapper.findComponent({ name: 'MessageList' })
    const messages = messageList.props('messages') as Array<{ id: string }>
    expect(messages.some((message) => message.id.startsWith('__pending_assistant_'))).toBe(false)

    deferredSend.resolve({ accepted: true, requestId: null, messageId: null })
    await flushPromises()
  })

  it('maps reasoning metadata into message usage for think duration fallback', async () => {
    const { wrapper, messageStore } = await setup()

    expect(messageStore.loadMessages).toHaveBeenCalledWith('s1', 100)

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

    const updatedMessage = {
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
    // Production updates go through messageCache (+ persisted revision on load/persist).
    // displayMessages stable path intentionally does not scan streamRevision.
    messageStore.messages[0] = updatedMessage
    messageStore.messageCache.set(String(updatedMessage.id), updatedMessage)
    messageStore.lastPersistedRevision += 1

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
    expect(wrapper.find('[data-testid="chat-input-memory-host"]').exists()).toBe(true)
    expect(wrapper.find('.memory-update-chip-stub').exists()).toBe(true)
    expect(wrapper.find('.memory-update-chip-stub').attributes('data-visible')).toBe('false')
    // Input/status stay mounted (v-show) so TipTap draft and StatusBar watchers
    // are not destroyed during permission/question; they are inert+hidden.
    expect(wrapper.find('.chat-input-box-stub').exists()).toBe(true)
    expect(wrapper.find('.chat-status-bar-stub').exists()).toBe(true)
    expect(wrapper.findComponent({ name: 'ChatInputBox' }).props('submitDisabled')).toBe(true)
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

  it('confirms before deleting a message', async () => {
    const { wrapper, sessionClient, messageStore } = await setup()
    const messageList = wrapper.findComponent({ name: 'MessageList' })

    messageList.vm.$emit('delete', 'm1')
    await flushPromises()

    expect(sessionClient.deleteMessage).not.toHaveBeenCalled()
    expect(wrapper.find('.alert-dialog-stub').exists()).toBe(true)
    expect(wrapper.text()).toContain('dialog.deleteMessage.title')

    await wrapper.findComponent({ name: 'AlertDialogAction' }).trigger('click')
    await flushPromises()

    expect(messageStore.clearStreamingState).toHaveBeenCalled()
    expect(sessionClient.deleteMessage).toHaveBeenCalledWith('s1', 'm1')
    expect(messageStore.loadMessages).toHaveBeenCalledWith('s1', undefined)
    expect(wrapper.find('.alert-dialog-stub').exists()).toBe(false)
  })

  it('clears the live plan snapshot when deleting the associated assistant message', async () => {
    const { wrapper, agentPlanStore } = await setup()
    agentPlanStore.snapshots.s1 = {
      sessionId: 's1',
      messageId: 'm1',
      plan: [{ step: 'Associated plan', status: 'in_progress' }],
      revision: 1,
      updatedAt: '2026-05-18T00:00:00.000Z'
    }
    const messageList = wrapper.findComponent({ name: 'MessageList' })

    messageList.vm.$emit('delete', 'm1')
    await flushPromises()
    await wrapper.findComponent({ name: 'AlertDialogAction' }).trigger('click')
    await flushPromises()

    expect(agentPlanStore.clearSnapshot).toHaveBeenCalledWith('s1')
    expect(agentPlanStore.snapshots.s1).toBeUndefined()
  })

  it('keeps the live plan snapshot when deleting an unrelated message', async () => {
    const { wrapper, agentPlanStore } = await setup()
    agentPlanStore.snapshots.s1 = {
      sessionId: 's1',
      messageId: 'm2',
      plan: [{ step: 'Unrelated plan', status: 'in_progress' }],
      revision: 1,
      updatedAt: '2026-05-18T00:00:00.000Z'
    }
    const messageList = wrapper.findComponent({ name: 'MessageList' })

    messageList.vm.$emit('delete', 'm1')
    await flushPromises()
    await wrapper.findComponent({ name: 'AlertDialogAction' }).trigger('click')
    await flushPromises()

    expect(agentPlanStore.clearSnapshot).not.toHaveBeenCalledWith('s1')
    expect(agentPlanStore.snapshots.s1?.plan[0]?.step).toBe('Unrelated plan')
  })

  it('does not delete when the message delete dialog closes without confirmation', async () => {
    const { wrapper, sessionClient } = await setup()
    const messageList = wrapper.findComponent({ name: 'MessageList' })

    messageList.vm.$emit('delete', 'm1')
    await flushPromises()
    expect(wrapper.find('.alert-dialog-stub').exists()).toBe(true)

    wrapper.findComponent({ name: 'AlertDialog' }).vm.$emit('update:open', false)
    await flushPromises()

    expect(sessionClient.deleteMessage).not.toHaveBeenCalled()
    expect(wrapper.find('.alert-dialog-stub').exists()).toBe(false)
  })

  it('does not open delete confirmation in read-only sessions', async () => {
    const { wrapper, sessionClient } = await setup({ sessionKind: 'subagent' })
    const messageList = wrapper.findComponent({ name: 'MessageList' })

    messageList.vm.$emit('delete', 'm1')
    await flushPromises()

    expect(sessionClient.deleteMessage).not.toHaveBeenCalled()
    expect(wrapper.find('.alert-dialog-stub').exists()).toBe(false)
  })

  it('does not delete when the session becomes read-only while confirmation is open', async () => {
    const { wrapper, sessionClient, sessionStore } = await setup()
    const messageList = wrapper.findComponent({ name: 'MessageList' })

    messageList.vm.$emit('delete', 'm1')
    await flushPromises()
    sessionStore.activeSession.sessionKind = 'subagent'
    await flushPromises()

    await wrapper.findComponent({ name: 'AlertDialogAction' }).trigger('click')
    await flushPromises()

    expect(sessionClient.deleteMessage).not.toHaveBeenCalled()
    expect(wrapper.find('.alert-dialog-stub').exists()).toBe(true)
  })

  it('closes pending delete confirmation when switching sessions', async () => {
    const { wrapper, sessionClient } = await setup()
    const messageList = wrapper.findComponent({ name: 'MessageList' })

    messageList.vm.$emit('delete', 'm1')
    await flushPromises()
    expect(wrapper.find('.alert-dialog-stub').exists()).toBe(true)

    await wrapper.setProps({ sessionId: 's2' })
    await flushPromises()

    expect(sessionClient.deleteMessage).not.toHaveBeenCalled()
    expect(wrapper.find('.alert-dialog-stub').exists()).toBe(false)
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
    expect(wrapper.find('.chat-status-bar-stub').exists()).toBe(true)
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
    const { wrapper, pendingInputStore, agentPlanStore, notify } = await setup({
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
    expect(notify).toHaveBeenCalledWith({
      kind: 'error',
      code: 'chat.pendingInput.steerFailed',
      title: 'chat.pendingInput.steerFailed'
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
    const { wrapper, pendingInputStore, chatClient, messageStore } = await setup({
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
    expect(messageStore.addOptimisticUserMessage).not.toHaveBeenCalled()
    const messageList = wrapper.findComponent({ name: 'MessageList' })
    const messages = messageList.props('messages') as Array<{ id: string }>
    expect(messages.filter((message) => message.id.startsWith('__pending_assistant_'))).toEqual([
      expect.objectContaining({ id: '__pending_assistant_generating_s1' })
    ])
    expect(chatClient.steerActiveTurn).not.toHaveBeenCalled()
    expect(chatClient.sendMessage).not.toHaveBeenCalled()
  })

  it('does not clear a new draft when an old A-B-A queue request resolves', async () => {
    const queued = createDeferred<void>()
    const { wrapper, pendingInputStore } = await setup({
      isStreaming: true,
      pendingInputStorePatch: {
        queueInput: vi.fn().mockReturnValue(queued.promise)
      }
    })
    const input = wrapper.findComponent({ name: 'ChatInputBox' })

    input.vm.$emit('update:modelValue', 'old draft')
    await flushPromises()
    input.vm.$emit('submit')
    await flushPromises()
    expect(pendingInputStore.queueInput).toHaveBeenCalledWith('s1', {
      text: 'old draft',
      files: []
    })

    await wrapper.setProps({ sessionId: 's2' })
    await flushPromises()
    await wrapper.setProps({ sessionId: 's1' })
    await flushPromises()
    input.vm.$emit('update:modelValue', 'new draft')
    await flushPromises()
    expect(wrapper.findComponent({ name: 'ChatInputToolbar' }).props('hasInput')).toBe(true)

    queued.resolve()
    await flushPromises()

    expect(wrapper.findComponent({ name: 'ChatInputToolbar' }).props('hasInput')).toBe(true)
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
    expect(toolbar.props('steerDisabled')).toBe(false)
    const steerButton = toolbar.find('[data-testid="chat-steer-button"]')
    expect(steerButton.exists()).toBe(true)
  })

  it('disables composer steer whenever its submit guard would reject it', async () => {
    const { wrapper, chatClient } = await setup({
      isStreaming: true,
      activeSessionPatch: {
        projectDir: ''
      }
    })
    const inputBox = wrapper.findComponent({ name: 'ChatInputBox' })
    inputBox.vm.$emit('update:modelValue', 'tighten the answer')
    await flushPromises()

    const toolbar = wrapper.findComponent({ name: 'ChatInputToolbar' })
    expect(toolbar.props('steerDisabled')).toBe(true)

    toolbar.vm.$emit('steer')
    await flushPromises()
    expect(chatClient.steerActiveTurn).not.toHaveBeenCalled()
  })

  it('blocks duplicate stop requests while cancellation is pending', async () => {
    const stopping = createDeferred<{ stopped: boolean }>()
    const { wrapper, chatClient, agentPlanStore } = await setup({ isStreaming: true })
    chatClient.stopStream.mockReturnValueOnce(stopping.promise)
    const toolbar = wrapper.findComponent({ name: 'ChatInputToolbar' })

    toolbar.vm.$emit('stop')
    await flushPromises()
    expect(toolbar.props('isStopping')).toBe(true)

    toolbar.vm.$emit('stop')
    await flushPromises()
    expect(chatClient.stopStream).toHaveBeenCalledTimes(1)

    stopping.resolve({ stopped: true })
    await flushPromises()

    expect(agentPlanStore.freezeActive).toHaveBeenCalledWith('s1')
    expect(toolbar.props('isStopping')).toBe(false)
  })

  it('reports stop responses that did not cancel generation', async () => {
    const { wrapper, chatClient, agentPlanStore, notify } = await setup({ isStreaming: true })
    chatClient.stopStream.mockResolvedValueOnce({ stopped: false })

    wrapper.findComponent({ name: 'ChatInputToolbar' }).vm.$emit('stop')
    await flushPromises()

    expect(agentPlanStore.freezeActive).not.toHaveBeenCalled()
    expect(notify).toHaveBeenCalledWith({
      kind: 'error',
      code: 'chat.generation.cancelFailed',
      title: 'chat.input.stop',
      description: 'common.error.requestFailed'
    })
  })

  it('reports rejected stop requests', async () => {
    const { wrapper, chatClient, notify } = await setup({ isStreaming: true })
    chatClient.stopStream.mockRejectedValueOnce(new Error('boom'))

    wrapper.findComponent({ name: 'ChatInputToolbar' }).vm.$emit('stop')
    await flushPromises()

    expect(notify).toHaveBeenCalledWith({
      kind: 'error',
      code: 'chat.generation.cancelFailed',
      title: 'chat.input.stop',
      description: 'common.error.requestFailed'
    })
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

  it('follows a restored session after the observed message geometry grows', async () => {
    let nextFrameId = 1
    const rafCallbacks = new Map<number, FrameRequestCallback>()
    const resizeCallbacks: ResizeObserverCallback[] = []
    const originalResizeObserver = globalThis.ResizeObserver
    class TestResizeObserver {
      constructor(callback: ResizeObserverCallback) {
        resizeCallbacks.push(callback)
      }

      observe() {}
      unobserve() {}
      disconnect() {}
    }
    vi.stubGlobal('ResizeObserver', TestResizeObserver)
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
      resizeCallbacks.forEach((callback) => callback([], {} as ResizeObserver))
      await flushRaf()
      expect(scrollTop).toBe(850)

      wrapper.unmount()
    } finally {
      rafSpy.mockRestore()
      cancelRafSpy.mockRestore()
      if (originalResizeObserver) {
        vi.stubGlobal('ResizeObserver', originalResizeObserver)
      } else {
        Reflect.deleteProperty(globalThis, 'ResizeObserver')
      }
    }
  })

  it('does not follow observed geometry when auto-scroll is disabled', async () => {
    let nextFrameId = 1
    const rafCallbacks = new Map<number, FrameRequestCallback>()
    const resizeCallbacks: ResizeObserverCallback[] = []
    const originalResizeObserver = globalThis.ResizeObserver
    class TestResizeObserver {
      constructor(callback: ResizeObserverCallback) {
        resizeCallbacks.push(callback)
      }

      observe() {}
      unobserve() {}
      disconnect() {}
    }
    vi.stubGlobal('ResizeObserver', TestResizeObserver)
    const flushRaf = async () => {
      const callbacks = Array.from(rafCallbacks.values())
      rafCallbacks.clear()
      callbacks.forEach((callback) => callback(0))
      await flushPromises()
    }
    const rafSpy = vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
      const frameId = nextFrameId
      nextFrameId += 1
      rafCallbacks.set(frameId, callback)
      return frameId
    })
    const cancelRafSpy = vi.spyOn(window, 'cancelAnimationFrame').mockImplementation((frameId) => {
      rafCallbacks.delete(frameId)
    })

    try {
      const { wrapper, flushStartupDeferredTasks } = await setup({
        autoScrollEnabled: false,
        deferStartupTasks: true
      })
      const chatPage = wrapper.get('[data-testid="chat-page"]').element as HTMLDivElement
      let scrollHeight = 1200
      let scrollTop = 0
      Object.defineProperty(chatPage, 'clientHeight', { configurable: true, get: () => 500 })
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
      resizeCallbacks.forEach((callback) => callback([], {} as ResizeObserver))
      await flushRaf()

      expect(scrollTop).toBe(700)
      wrapper.unmount()
    } finally {
      rafSpy.mockRestore()
      cancelRafSpy.mockRestore()
      if (originalResizeObserver) {
        vi.stubGlobal('ResizeObserver', originalResizeObserver)
      } else {
        Reflect.deleteProperty(globalThis, 'ResizeObserver')
      }
    }
  })

  it('does not commit restore after the user scrolls before loading completes', async () => {
    let nextFrameId = 1
    const rafCallbacks = new Map<number, FrameRequestCallback>()
    const flushRaf = async () => {
      const callbacks = Array.from(rafCallbacks.values())
      rafCallbacks.clear()
      callbacks.forEach((callback) => callback(0))
      await flushPromises()
    }
    const rafSpy = vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
      const frameId = nextFrameId
      nextFrameId += 1
      rafCallbacks.set(frameId, callback)
      return frameId
    })
    const cancelRafSpy = vi.spyOn(window, 'cancelAnimationFrame').mockImplementation((frameId) => {
      rafCallbacks.delete(frameId)
    })

    try {
      const { wrapper, flushStartupDeferredTasks } = await setup({ deferStartupTasks: true })
      const chatPage = wrapper.get('[data-testid="chat-page"]').element as HTMLDivElement
      let scrollTop = 420

      Object.defineProperty(chatPage, 'clientHeight', { configurable: true, get: () => 500 })
      Object.defineProperty(chatPage, 'scrollHeight', { configurable: true, get: () => 1200 })
      Object.defineProperty(chatPage, 'scrollTop', {
        configurable: true,
        get: () => scrollTop,
        set: (value: number) => {
          scrollTop = value
        }
      })
      rafCallbacks.clear()

      await wrapper.get('[data-testid="chat-page"]').trigger('wheel', { deltaY: -20 })
      await flushStartupDeferredTasks()
      await flushRaf()

      expect(scrollTop).toBe(420)
      expect(rafCallbacks.size).toBe(0)
      wrapper.unmount()
    } finally {
      rafSpy.mockRestore()
      cancelRafSpy.mockRestore()
    }
  })

  it('cancels the session restore transaction after wheel intent', async () => {
    await expectSessionRestoreTransactionStopsAfter(async ({ wrapper }) => {
      await wrapper.get('[data-testid="chat-page"]').trigger('wheel', { deltaY: -20 })
    })
  })

  it('keeps a scroll-only position after the restore transaction', async () => {
    await expectSessionRestoreTransactionStopsAfter(async ({ wrapper }) => {
      await wrapper.get('[data-testid="chat-page"]').trigger('scroll')
    })
  })

  it('keeps scroll-only restore intent anchored during message measurement', async () => {
    await expectSessionRestoreTransactionStopsAfter(async ({ wrapper }) => {
      await wrapper.get('[data-testid="chat-page"]').trigger('scroll')
      wrapper.findComponent({ name: 'MessageList' }).vm.$emit('measure', {
        messageId: 'm1',
        height: 420
      })
      await flushPromises()
    })
  })

  it('keeps slow upward wheel intent anchored inside bottom threshold', async () => {
    await expectSessionRestoreTransactionStopsAfter(async ({ wrapper }) => {
      const chatPage = wrapper.get('[data-testid="chat-page"]')
      await chatPage.trigger('wheel', { deltaY: -4 })
      await chatPage.trigger('scroll')
      wrapper.findComponent({ name: 'MessageList' }).vm.$emit('measure', {
        messageId: 'm1',
        height: 420
      })
      await flushPromises()
    }, 650)
  })

  it('compensates queued measurements in the same frame without a later rollback', async () => {
    vi.useFakeTimers()
    let nextFrameId = 1
    const rafCallbacks = new Map<number, FrameRequestCallback>()
    const flushRaf = async () => {
      const callbacks = Array.from(rafCallbacks.values())
      rafCallbacks.clear()
      callbacks.forEach((callback) => callback(0))
      await flushPromises()
    }
    const rafSpy = vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
      const frameId = nextFrameId
      nextFrameId += 1
      rafCallbacks.set(frameId, callback)
      return frameId
    })
    const cancelRafSpy = vi.spyOn(window, 'cancelAnimationFrame').mockImplementation((frameId) => {
      rafCallbacks.delete(frameId)
    })

    try {
      const messages = Array.from({ length: 180 }, (_, index) => ({
        ...buildAssistantMessage([
          {
            type: 'content',
            content: `message ${index}`,
            status: 'success',
            timestamp: index
          }
        ]),
        id: `m${index}`,
        orderSeq: index + 1,
        createdAt: index + 1,
        updatedAt: index + 1
      }))
      const { wrapper } = await setup({ messages, deferStartupTasks: true })
      const chatPage = wrapper.get('[data-testid="chat-page"]').element as HTMLDivElement
      let scrollTop = 250

      Object.defineProperty(chatPage, 'clientHeight', {
        configurable: true,
        get: () => 500
      })
      Object.defineProperty(chatPage, 'scrollHeight', {
        configurable: true,
        get: () => 2000
      })
      Object.defineProperty(chatPage, 'scrollTop', {
        configurable: true,
        get: () => scrollTop,
        set: (value: number) => {
          scrollTop = value
        }
      })
      vi.spyOn(chatPage, 'getBoundingClientRect').mockReturnValue({ top: 0 } as DOMRect)
      const origin = wrapper.get('[data-message-window-origin]').element as HTMLElement
      vi.spyOn(origin, 'getBoundingClientRect').mockImplementation(
        () => ({ top: -scrollTop }) as DOMRect
      )
      rafCallbacks.clear()

      await wrapper.get('[data-testid="chat-page"]').trigger('wheel', { deltaY: -4 })
      wrapper.findComponent({ name: 'MessageList' }).vm.$emit('measure', {
        messageId: 'm0',
        height: 300
      })

      await vi.advanceTimersByTimeAsync(140)
      await flushRaf()

      // m0 grows from its 188px estimate to 300px. m1 is the logical viewport
      // anchor, so the compensation must be committed before this frame ends.
      expect(scrollTop).toBe(362)
      // One frame verifies the write and one expires the immediate-write guard.
      expect(rafCallbacks.size).toBe(2)
      await flushRaf()
      expect(rafCallbacks.size).toBe(0)
      wrapper.unmount()
    } finally {
      rafSpy.mockRestore()
      cancelRafSpy.mockRestore()
      vi.useRealTimers()
    }
  })

  it('does not write scrollTop from measurements in a four-message conversation', async () => {
    vi.useFakeTimers()
    let nextFrameId = 1
    const rafCallbacks = new Map<number, FrameRequestCallback>()
    const flushRaf = async () => {
      const callbacks = Array.from(rafCallbacks.values())
      rafCallbacks.clear()
      callbacks.forEach((callback) => callback(0))
      await flushPromises()
    }
    const rafSpy = vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
      const frameId = nextFrameId
      nextFrameId += 1
      rafCallbacks.set(frameId, callback)
      return frameId
    })
    const cancelRafSpy = vi.spyOn(window, 'cancelAnimationFrame').mockImplementation((frameId) => {
      rafCallbacks.delete(frameId)
    })

    try {
      const messages = Array.from({ length: 4 }, (_, index) => ({
        ...buildAssistantMessage([
          {
            type: 'content',
            content: `short message ${index}`,
            status: 'success',
            timestamp: index
          }
        ]),
        id: `short-measure-${index}`,
        orderSeq: index + 1,
        createdAt: index + 1,
        updatedAt: index + 1
      }))
      const { wrapper } = await setup({ messages, deferStartupTasks: true })
      const chatPage = wrapper.get('[data-testid="chat-page"]').element as HTMLDivElement
      let scrollTop = 250

      Object.defineProperty(chatPage, 'clientHeight', { configurable: true, get: () => 500 })
      Object.defineProperty(chatPage, 'scrollHeight', { configurable: true, get: () => 1200 })
      Object.defineProperty(chatPage, 'scrollTop', {
        configurable: true,
        get: () => scrollTop,
        set: (value: number) => {
          scrollTop = value
        }
      })
      vi.spyOn(chatPage, 'getBoundingClientRect').mockReturnValue({ top: 0 } as DOMRect)
      const origin = wrapper.get('[data-message-window-origin]').element as HTMLElement
      vi.spyOn(origin, 'getBoundingClientRect').mockImplementation(
        () => ({ top: -scrollTop }) as DOMRect
      )
      rafCallbacks.clear()

      await wrapper.get('[data-testid="chat-page"]').trigger('wheel', { deltaY: -4 })
      await vi.advanceTimersByTimeAsync(140)
      wrapper.findComponent({ name: 'MessageList' }).vm.$emit('measure', {
        messageId: 'short-measure-0',
        height: 300
      })
      await flushRaf()

      expect(scrollTop).toBe(250)
      expect(rafCallbacks.size).toBe(0)
      wrapper.unmount()
    } finally {
      rafSpy.mockRestore()
      cancelRafSpy.mockRestore()
      vi.useRealTimers()
    }
  })

  it('cancels the session restore transaction after scrollbar pointer intent', async () => {
    await expectSessionRestoreTransactionStopsAfter(async ({ wrapper }) => {
      await wrapper.get('[data-testid="chat-page"]').trigger('pointerdown')
    })
  })

  it('cancels the session restore transaction after keyboard scroll intent', async () => {
    await expectSessionRestoreTransactionStopsAfter(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'PageUp' }))
      await flushPromises()
    })
  })

  it('opens the inline search with Ctrl+F and closes it with Escape', async () => {
    const { wrapper } = await setup()

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'f', ctrlKey: true }))
    await flushPromises()
    expect(wrapper.find('.chat-search-bar-stub').exists()).toBe(true)
    expect(
      wrapper.find('.message-list-stub').attributes('data-disable-markdown-virtualization')
    ).toBe('true')

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    await flushPromises()
    expect(wrapper.find('.chat-search-bar-stub').exists()).toBe(false)
    expect(
      wrapper.find('.message-list-stub').attributes('data-disable-markdown-virtualization')
    ).toBe('false')
  })

  it('uses message-window coordinates for search jumps without loading history', async () => {
    let nextFrameId = 1
    const rafCallbacks = new Map<number, FrameRequestCallback>()
    const flushRaf = async () => {
      const callbacks = Array.from(rafCallbacks.values())
      rafCallbacks.clear()
      callbacks.forEach((callback) => callback(0))
      await flushPromises()
    }
    const rafSpy = vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
      const frameId = nextFrameId
      nextFrameId += 1
      rafCallbacks.set(frameId, callback)
      return frameId
    })
    const cancelRafSpy = vi.spyOn(window, 'cancelAnimationFrame').mockImplementation((frameId) => {
      rafCallbacks.delete(frameId)
    })
    const previousScrollIntoView = HTMLElement.prototype.scrollIntoView
    const scrollIntoView = vi.fn()
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
      configurable: true,
      value: scrollIntoView
    })

    try {
      const messages = Array.from({ length: 180 }, (_, index) => ({
        ...buildAssistantMessage([
          {
            type: 'content',
            content: index === 0 || index === 20 ? `needle result ${index}` : `message ${index}`,
            status: 'success',
            timestamp: index
          }
        ]),
        id: `m${index}`,
        orderSeq: index + 1,
        createdAt: index + 1,
        updatedAt: index + 1
      }))
      const { wrapper, messageStore } = await setup({ messages, deferStartupTasks: true })
      const chatPage = wrapper.get('[data-testid="chat-page"]').element as HTMLDivElement
      const origin = wrapper.get('[data-message-window-origin]').element as HTMLDivElement

      let scrollTop = 30_000
      Object.defineProperty(chatPage, 'clientHeight', {
        configurable: true,
        get: () => 500
      })
      Object.defineProperty(chatPage, 'scrollHeight', {
        configurable: true,
        get: () => 40_000
      })
      Object.defineProperty(chatPage, 'scrollTop', {
        configurable: true,
        get: () => scrollTop,
        set: (value: number) => {
          scrollTop = value
        }
      })
      vi.spyOn(chatPage, 'getBoundingClientRect').mockReturnValue({
        top: 100
      } as DOMRect)
      vi.spyOn(origin, 'getBoundingClientRect').mockImplementation(
        () =>
          ({
            // The message window starts 80px into the scroll container's content.
            top: 180 - scrollTop
          }) as DOMRect
      )

      messageStore.hasMoreHistory = true
      await wrapper.get('[data-testid="chat-page"]').trigger('scroll')
      await flushRaf()

      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'f', metaKey: true }))
      await flushPromises()
      const searchBar = wrapper.findComponent({ name: 'ChatSearchBar' })
      searchBar.vm.$emit('update:modelValue', 'needle')
      await flushPromises()
      // Settle the 150ms query debounce (real timers in this test) before the
      // highlight/jump frames run.
      await new Promise((resolve) => setTimeout(resolve, 180))
      await flushPromises()
      await flushRaf()
      await flushRaf()

      // The first result is at the top. Its immediate programmatic scroll must not
      // be interpreted as a user-triggered history request.
      expect(scrollTop).toBe(0)
      await wrapper.get('[data-testid="chat-page"]').trigger('scroll')
      expect(messageStore.loadOlderMessages).not.toHaveBeenCalled()

      searchBar.vm.$emit('next')
      await flushPromises()
      await flushRaf()
      await flushRaf()

      // m20 starts after 20 * (184px estimate + 4px row spacing). Add the 80px
      // message-window origin, then center it one third down the 500px viewport.
      expect(scrollTop).toBe(80 + 20 * 188 - Math.round(500 / 3))
      expect(scrollIntoView).not.toHaveBeenCalled()

      const searchScrollCallCount = scrollIntoView.mock.calls.length
      scrollTop = 20_000
      await wrapper.get('[data-testid="chat-page"]').trigger('scroll')
      await flushRaf()
      await flushRaf()

      expect(scrollTop).toBe(20_000)
      expect(scrollIntoView).toHaveBeenCalledTimes(searchScrollCallCount)

      wrapper.unmount()
    } finally {
      rafSpy.mockRestore()
      cancelRafSpy.mockRestore()
      Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
        configurable: true,
        value: previousScrollIntoView
      })
    }
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
    await vi.advanceTimersByTimeAsync(32)
    await flushPromises()

    expect(wrapper.find('[data-message-id="m1"]').classes()).toContain('message-highlight')
    expect(scrollIntoView).not.toHaveBeenCalled()
    expect(spotlightStore.clearPendingMessageJump).toHaveBeenCalled()
    vi.useRealTimers()
  })
})

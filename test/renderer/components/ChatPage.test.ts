import { describe, expect, it, vi } from 'vitest'
import { defineComponent, reactive } from 'vue'
import { flushPromises, mount } from '@vue/test-utils'

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
  pendingInputStorePatch?: Record<string, unknown>
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
      status: 'idle'
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
    isStreaming: false,
    streamingBlocks: [],
    currentStreamMessageId: null,
    loadMessages: vi.fn().mockResolvedValue(undefined),
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
    convertToSteer: vi.fn().mockResolvedValue(undefined),
    deleteInput: vi.fn().mockResolvedValue(undefined),
    resumeQueue: vi.fn().mockResolvedValue(undefined),
    clear: vi.fn(),
    ...options.pendingInputStorePatch
  })

  const modelStore = reactive({
    findModelByIdOrName: vi.fn((id: string) => ({
      model: {
        id,
        name: id === 'dimcode-acp' ? 'DimCode' : id
      }
    }))
  })

  const newAgentPresenter = {
    respondToolInteraction: vi.fn().mockResolvedValue(undefined),
    cancelGeneration: vi.fn().mockResolvedValue(undefined),
    retryMessage: vi.fn().mockResolvedValue(undefined),
    deleteMessage: vi.fn().mockResolvedValue(undefined),
    editUserMessage: vi.fn().mockResolvedValue(undefined),
    forkSession: vi.fn().mockResolvedValue({ id: 'forked' })
  }

  vi.doMock('@/stores/ui/session', () => ({
    useSessionStore: () => sessionStore
  }))
  vi.doMock('@/stores/ui/message', () => ({
    useMessageStore: () => messageStore
  }))
  vi.doMock('@/stores/ui/pendingInput', () => ({
    usePendingInputStore: () => pendingInputStore
  }))
  vi.doMock('@/stores/modelStore', () => ({
    useModelStore: () => modelStore
  }))
  vi.doMock('@/composables/usePresenter', () => ({
    usePresenter: () => newAgentPresenter
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
    default: passthrough('ChatTopBar')
  }))
  vi.doMock('@/components/chat/MessageList.vue', () => ({
    default: defineComponent({
      name: 'MessageList',
      props: {
        messages: {
          type: Array,
          required: true
        },
        isGenerating: {
          type: Boolean,
          default: false
        },
        traceMessageIds: {
          type: Array,
          default: () => []
        }
      },
      template: '<div class="message-list-stub" />'
    })
  }))
  vi.doMock('@/components/chat/ChatInputBox.vue', () => ({
    default: defineComponent({
      name: 'ChatInputBox',
      template: '<div class="chat-input-box-stub"><slot name="toolbar" /></div>'
    })
  }))
  vi.doMock('@/components/chat/ChatInputToolbar.vue', () => ({
    default: passthrough('ChatInputToolbar')
  }))
  vi.doMock('@/components/chat/PendingInputLane.vue', () => ({
    default: defineComponent({
      name: 'PendingInputLane',
      template: '<div class="pending-input-lane-stub" />'
    })
  }))
  vi.doMock('@/components/chat/ChatStatusBar.vue', () => ({
    default: passthrough('ChatStatusBar')
  }))
  vi.doMock('@/components/chat/ChatToolInteractionOverlay.vue', () => ({
    default: defineComponent({
      name: 'ChatToolInteractionOverlay',
      template: '<div class="chat-tool-interaction-overlay-stub" />'
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
    messageStore
  }
}

describe('ChatPage', () => {
  it('maps reasoning metadata into message usage for think duration fallback', async () => {
    const { wrapper, messageStore } = await setup()

    expect(messageStore.loadMessages).toHaveBeenCalledWith('s1')

    const messageList = wrapper.findComponent({ name: 'MessageList' })
    const messages = messageList.props('messages') as Array<{
      usage: { reasoning_start_time: number; reasoning_end_time: number }
    }>

    expect(messages).toHaveLength(1)
    expect(messages[0].usage.reasoning_start_time).toBe(1_200)
    expect(messages[0].usage.reasoning_end_time).toBe(4_500)
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
    expect(html.indexOf('chat-tool-interaction-overlay-stub')).toBeLessThan(
      html.indexOf('pending-input-lane-stub')
    )
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
})

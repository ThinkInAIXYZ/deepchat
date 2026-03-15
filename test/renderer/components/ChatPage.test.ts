import { describe, expect, it, vi } from 'vitest'
import { defineComponent, reactive } from 'vue'
import { flushPromises, mount } from '@vue/test-utils'

const passthrough = (name: string) =>
  defineComponent({
    name,
    template: '<div><slot /></div>'
  })

const setup = async () => {
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
    messages: [
      {
        id: 'm1',
        sessionId: 's1',
        orderSeq: 1,
        role: 'assistant' as const,
        content: JSON.stringify([
          {
            type: 'reasoning_content',
            content: 'thinking',
            status: 'success',
            timestamp: 1
          }
        ]),
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
      }
    ],
    isStreaming: false,
    streamingBlocks: [],
    currentStreamMessageId: null,
    loadMessages: vi.fn().mockResolvedValue(undefined),
    clearStreamingState: vi.fn(),
    addOptimisticUserMessage: vi.fn()
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
    default: passthrough('ChatInputBox')
  }))
  vi.doMock('@/components/chat/ChatInputToolbar.vue', () => ({
    default: passthrough('ChatInputToolbar')
  }))
  vi.doMock('@/components/chat/ChatStatusBar.vue', () => ({
    default: passthrough('ChatStatusBar')
  }))
  vi.doMock('@/components/chat/ChatToolInteractionOverlay.vue', () => ({
    default: passthrough('ChatToolInteractionOverlay')
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
})

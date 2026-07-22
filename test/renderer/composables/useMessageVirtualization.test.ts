import { computed, ref } from 'vue'
import { describe, expect, it } from 'vitest'
import { useMessageWindow } from '@/composables/message/useMessageWindow'
import { useMessageVirtualization } from '@/features/chat-page/composables/useMessageVirtualization'
import type {
  DisplayMessageUsage,
  MessageListItem
} from '@/features/chat-page/model/displayMessage'

const usage: DisplayMessageUsage = {
  context_usage: 0,
  tokens_per_second: 0,
  total_tokens: 0,
  generation_time: 0,
  first_token_time: 0,
  reasoning_start_time: 0,
  reasoning_end_time: 0,
  input_tokens: 0,
  output_tokens: 0
}

function createUserMessage(id: string, orderSeq: number): MessageListItem {
  return {
    id,
    role: 'user',
    timestamp: orderSeq,
    updatedAt: orderSeq,
    avatar: '',
    name: 'You',
    model_name: '',
    model_id: '',
    model_provider: '',
    status: 'sent',
    error: '',
    usage,
    conversationId: 'session-1',
    is_variant: 0,
    orderSeq,
    content: { files: [], links: [], think: false, search: false, text: 'hello' }
  }
}

function createStreamingAssistant(content = 'streaming', updatedAt = 200): MessageListItem {
  return {
    id: 'assistant-streaming',
    role: 'assistant',
    timestamp: 200,
    updatedAt,
    avatar: '',
    name: 'Assistant',
    model_name: 'Assistant',
    model_id: 'model-1',
    model_provider: 'provider-1',
    status: 'pending',
    error: '',
    usage,
    conversationId: 'session-1',
    is_variant: 0,
    orderSeq: 200,
    content: [{ type: 'content', content, status: 'loading', timestamp: updatedAt }]
  }
}

function createVirtualization(messages: ReturnType<typeof ref<MessageListItem[]>>) {
  const displayMessages = computed(() => messages.value)
  const messageWindow = useMessageWindow({ messages: displayMessages })
  const virtualization = useMessageVirtualization({
    viewport: ref(null),
    displayMessages,
    messageWindow,
    windowingThreshold: 160,
    initialWindowCount: 90,
    overscanPx: 2400,
    getWindowOriginTop: () => null,
    isListScrolling: ref(false),
    isBottomFollowingMode: () => false,
    scrollToBottom: () => undefined,
    requestAnchorScroll: () => undefined,
    currentScrollMode: () => 'idle'
  })

  return { messageWindow, virtualization }
}

describe('useMessageVirtualization', () => {
  it('limits a long history to the initial window before viewport geometry is available', () => {
    const messages = ref<MessageListItem[]>(
      Array.from({ length: 200 }, (_, index) => createUserMessage(`message-${index}`, index))
    )
    const { virtualization } = createVirtualization(messages)

    const visible = virtualization.visibleDisplayMessages.value
    expect(visible).toHaveLength(90)
    expect(visible[0]?.id).toBe('message-110')
    expect(visible.at(-1)?.id).toBe('message-199')
  })

  it('updates a streaming row in the window without expanding the mounted history', () => {
    const history = Array.from({ length: 200 }, (_, index) =>
      createUserMessage(`message-${index}`, index)
    )
    const messages = ref<MessageListItem[]>([...history, createStreamingAssistant()])
    const { messageWindow, virtualization } = createVirtualization(messages)

    expect(virtualization.visibleDisplayMessages.value).toHaveLength(90)
    const heightBefore = messageWindow.totalHeight.value

    messages.value = [
      ...history,
      createStreamingAssistant('longer streaming response '.repeat(100), 201)
    ]

    const visible = virtualization.visibleDisplayMessages.value
    expect(visible).toHaveLength(90)
    expect(visible.at(-1)?.id).toBe('assistant-streaming')
    expect(visible.at(-1)?.content[0]?.content).toContain('longer streaming response')
    expect(messageWindow.totalHeight.value).toBeGreaterThan(heightBefore)
  })
})

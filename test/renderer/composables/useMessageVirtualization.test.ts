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

function createVirtualization(
  messages: ReturnType<typeof ref<MessageListItem[]>>,
  disableWindowing = ref(false)
) {
  const displayMessages = computed(() => messages.value)
  const messageWindow = useMessageWindow({ messages: displayMessages })
  const virtualization = useMessageVirtualization({
    viewport: ref(null),
    displayMessages,
    messageWindow,
    disableWindowing,
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

  it('exposes every loaded message while assistive technology is active', () => {
    const messages = ref<MessageListItem[]>(
      Array.from({ length: 200 }, (_, index) => createUserMessage(`message-${index}`, index))
    )
    const accessibilityEnabled = ref(false)
    const { virtualization } = createVirtualization(messages, accessibilityEnabled)

    accessibilityEnabled.value = true
    expect(virtualization.visibleDisplayMessages.value).toHaveLength(200)
    expect(virtualization.visibleDisplayMessages.value[0]?.id).toBe('message-0')
    expect(virtualization.visibleDisplayMessages.value.at(-1)?.id).toBe('message-199')
    expect(virtualization.messageWindowBeforeHeight.value).toBe(0)
    expect(virtualization.messageWindowAfterHeight.value).toBe(0)

    accessibilityEnabled.value = false
    expect(virtualization.visibleDisplayMessages.value).toHaveLength(90)
  })

  it('counts the loaded messages that start below the viewport', () => {
    const messages = ref<MessageListItem[]>(
      Array.from({ length: 200 }, (_, index) => createUserMessage(`message-${index}`, index))
    )
    const { messageWindow, virtualization } = createVirtualization(messages)

    const entries = messageWindow.entries.value
    expect(entries).toHaveLength(200)

    // Without viewport geometry nothing can be claimed to be below.
    expect(virtualization.messagesBelowViewport.value).toEqual([])

    // Park the viewport so its bottom edge sits one pixel above entry 150: the 50 messages from
    // there on are entirely below what the user can see, oldest first.
    virtualization.scrollViewportHeight.value = 400
    virtualization.scrollViewportTop.value = entries[150].top - 401
    expect(virtualization.messagesBelowViewport.value).toHaveLength(50)
    expect(virtualization.messagesBelowViewport.value[0]?.id).toBe('message-150')
    expect(virtualization.messagesBelowViewport.value.at(-1)?.id).toBe('message-199')

    // A partially visible row is not below.
    virtualization.scrollViewportTop.value = entries[150].top - 400
    expect(virtualization.messagesBelowViewport.value).toHaveLength(49)

    // At the bottom nothing is below the viewport.
    virtualization.scrollViewportTop.value = messageWindow.totalHeight.value
    expect(virtualization.messagesBelowViewport.value).toEqual([])
  })

  it('counts below-viewport messages while windowing keeps rows unmounted', () => {
    const messages = ref<MessageListItem[]>(
      Array.from({ length: 200 }, (_, index) => createUserMessage(`message-${index}`, index))
    )
    const { messageWindow, virtualization } = createVirtualization(messages)

    // Windowing is active (200 > 160) and only 90 rows are mounted, but the count still reflects
    // the whole loaded history because it comes from the logical layout map.
    expect(virtualization.visibleDisplayMessages.value).toHaveLength(90)
    virtualization.scrollViewportHeight.value = 400
    virtualization.scrollViewportTop.value = 0
    expect(virtualization.messagesBelowViewport.value.length).toBeGreaterThan(90)
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

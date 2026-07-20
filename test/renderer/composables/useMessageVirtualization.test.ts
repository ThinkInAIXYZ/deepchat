import { describe, expect, it } from 'vitest'
import { computed, ref } from 'vue'
import {
  useMessageWindow,
  type MessageLayoutSegments
} from '@/composables/message/useMessageWindow'
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

function createStreamingAssistant(): MessageListItem {
  return {
    id: 'assistant-streaming',
    role: 'assistant',
    timestamp: 200,
    updatedAt: 200,
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
    content: [{ type: 'content', content: 'streaming', status: 'loading', timestamp: 200 }]
  }
}

describe('useMessageVirtualization', () => {
  it('renders an append-only stable-tail window without reading the complete display list', () => {
    const stable = Array.from({ length: 200 }, (_, index) =>
      createUserMessage(`message-${index}`, index)
    )
    const tail = ref<MessageListItem[]>([createStreamingAssistant()])
    const layoutSegments = computed<MessageLayoutSegments>(() => ({ stable, tail: tail.value }))
    let completeListReads = 0
    const displayMessages = computed(() => {
      completeListReads += 1
      return [...stable, ...tail.value]
    })
    const messageWindow = useMessageWindow({ messages: displayMessages, layoutSegments })
    const virtualization = useMessageVirtualization({
      viewport: ref(null),
      displayMessages,
      layoutSegments,
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

    // Initial layout may establish its stable geometry from the complete list.
    // A subsequent append-only token update must not materialize it again.
    void messageWindow.entries.value
    const readsAfterInitialLayout = completeListReads
    tail.value = [
      {
        ...tail.value[0],
        updatedAt: 201,
        content: [
          { type: 'content', content: 'streaming update', status: 'loading', timestamp: 201 }
        ]
      }
    ]

    // With no viewport the window falls back to the trailing initialWindowCount
    // rows: the last 89 stable messages plus the streaming tail.
    const visible = virtualization.visibleDisplayMessages.value
    expect(visible).toHaveLength(90)
    expect(visible[0]).toBe(stable[111])
    expect(visible[visible.length - 1]).toBe(tail.value[0])
    expect(completeListReads).toBe(readsAfterInitialLayout)
  })

  it('propagates fast-path tail growth to totalHeight and the visible window', () => {
    const stable = Array.from({ length: 200 }, (_, index) =>
      createUserMessage(`message-${index}`, index)
    )
    const tail = ref<MessageListItem[]>([createStreamingAssistant()])
    const layoutSegments = computed<MessageLayoutSegments>(() => ({ stable, tail: tail.value }))
    const displayMessages = computed(() => [...stable, ...tail.value])
    const messageWindow = useMessageWindow({ messages: displayMessages, layoutSegments })
    const virtualization = useMessageVirtualization({
      viewport: ref(null),
      displayMessages,
      layoutSegments,
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

    void messageWindow.entries.value
    const heightBeforeAppend = messageWindow.totalHeight.value
    expect(virtualization.visibleDisplayMessages.value).toHaveLength(90)

    // Appending a pending assistant row on the fast path must reach downstream
    // computeds: the layout array identity has to change, not mutate in place.
    const pendingRow: MessageListItem = {
      ...createStreamingAssistant(),
      id: '__pending_assistant_1',
      orderSeq: 201,
      timestamp: 201,
      updatedAt: 201,
      content: []
    }
    tail.value = [...tail.value, pendingRow]

    expect(messageWindow.totalHeight.value).toBeGreaterThan(heightBeforeAppend)
    const visible = virtualization.visibleDisplayMessages.value
    expect(visible[visible.length - 1]?.id).toBe(pendingRow.id)
  })

  it('uses the complete display list when the segment contract is unavailable', () => {
    const messages = ref<MessageListItem[]>([createUserMessage('message-1', 1)])
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

    expect(virtualization.visibleDisplayMessages.value).toEqual(messages.value)
  })

  it('falls back to the complete display list when layoutSegments is provided but returns null', () => {
    const messages = ref<MessageListItem[]>([createUserMessage('message-1', 1)])
    const layoutSegments = computed<MessageLayoutSegments | null>(() => null)
    const displayMessages = computed(() => messages.value)
    const messageWindow = useMessageWindow({ messages: displayMessages, layoutSegments })
    const virtualization = useMessageVirtualization({
      viewport: ref(null),
      displayMessages,
      layoutSegments,
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

    expect(layoutSegments.value).toBeNull()
    expect(virtualization.visibleDisplayMessages.value).toEqual(messages.value)
  })
})

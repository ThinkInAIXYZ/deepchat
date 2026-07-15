import { describe, expect, it } from 'vitest'
import { ref } from 'vue'
import { useMessageWindow } from '@/composables/message/useMessageWindow'
import type { MessageListItem, DisplayMessageUsage } from '@/components/chat/messageListItems'

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

const createUserMessage = (id: string, orderSeq: number, text = 'hello'): MessageListItem => ({
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
  content: {
    files: [],
    links: [],
    think: false,
    search: false,
    text
  }
})

const createPendingAssistantPlaceholder = (): MessageListItem => ({
  id: '__pending_assistant_1',
  role: 'assistant',
  timestamp: 1,
  updatedAt: 1,
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
  orderSeq: 1,
  content: []
})

const createStreamingAssistant = (): MessageListItem => ({
  id: 'assistant-real-1',
  renderKey: '__pending_assistant_1',
  role: 'assistant',
  timestamp: 2,
  updatedAt: 2,
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
  orderSeq: 1,
  content: [
    {
      type: 'content',
      content: 'hello',
      status: 'loading',
      timestamp: 2
    }
  ]
})

const createMessages = (count: number): MessageListItem[] =>
  Array.from({ length: count }, (_, index) => createUserMessage(`message-${index}`, index))

describe('useMessageWindow', () => {
  it('returns height delta when measurements change', () => {
    const messages = ref(createMessages(1))
    const window = useMessageWindow({ messages })

    const initialEstimate = window.getEntry('message-0')?.estimatedHeight ?? 0
    const firstDelta = window.setMeasuredHeight('message-0', initialEstimate + 20)
    const secondDelta = window.setMeasuredHeight('message-0', initialEstimate + 35)
    const unchangedDelta = window.setMeasuredHeight('message-0', initialEstimate + 35)

    expect(firstDelta).toBe(20)
    expect(secondDelta).toBe(15)
    expect(unchangedDelta).toBe(0)
  })

  it('exposes stable layout entries for jump/minimap lookup', () => {
    const messages = ref(createMessages(3))
    const window = useMessageWindow({ messages })

    window.setMeasuredHeight('message-0', 100)
    window.setMeasuredHeight('message-1', 120)
    window.setMeasuredHeight('message-2', 140)

    expect(window.getEntry('message-0')).toMatchObject({ top: 0, bottom: 100 })
    expect(window.getEntry('message-1')).toMatchObject({ top: 100, bottom: 220 })
    expect(window.getEntry('message-2')).toMatchObject({ top: 220, bottom: 360 })
    expect(window.totalHeight.value).toBe(360)
  })

  it('uses estimated heights before measurement', () => {
    const messages = ref(createMessages(2))
    const window = useMessageWindow({ messages })

    const entry0 = window.getEntry('message-0')
    const entry1 = window.getEntry('message-1')

    expect(entry0).toBeDefined()
    expect(entry1).toBeDefined()
    expect(entry0!.estimatedHeight).toBeGreaterThan(0)
    expect(entry0!.bottom).toBe(entry0!.estimatedHeight)
    expect(entry1!.top).toBe(entry0!.bottom)
    expect(entry1!.top).toBe(138)
  })

  it('estimates pending assistant placeholder near its spinner row height', () => {
    const messages = ref([createPendingAssistantPlaceholder()])
    const window = useMessageWindow({ messages })

    const entry = window.getEntry('__pending_assistant_1')

    expect(entry?.estimatedHeight).toBe(84)
    // Sub-threshold delta (< 4px) still stores measurement but does not report scroll delta.
    expect(window.setMeasuredHeight('__pending_assistant_1', 82)).toBe(0)
    expect(window.getEntry('__pending_assistant_1')?.measuredHeight).toBe(82)
  })

  it('reuses a pending placeholder measurement through the real streaming row render key', () => {
    const messages = ref([createPendingAssistantPlaceholder()])
    const window = useMessageWindow({ messages })

    expect(window.setMeasuredHeight('__pending_assistant_1', 82)).toBe(0)

    messages.value = [createStreamingAssistant()]

    const entry = window.getEntry('assistant-real-1')
    expect(entry?.measuredHeight).toBe(82)
    expect(entry?.bottom).toBe(82)
  })

  it('estimates collapsed tool and thinking blocks near pill/header height', () => {
    const messages = ref([
      {
        ...createPendingAssistantPlaceholder(),
        id: 'assistant-tools',
        status: 'sent' as const,
        content: [
          {
            type: 'tool_call' as const,
            status: 'success' as const,
            timestamp: 1,
            tool_call: { id: 't1', name: 'read_file' }
          },
          {
            type: 'reasoning_content' as const,
            content: 'thinking…',
            status: 'success' as const,
            timestamp: 2
          }
        ]
      }
    ])
    const window = useMessageWindow({ messages })
    const entry = window.getEntry('assistant-tools')
    // ASSISTANT_BASE(136) + tool pill(40) + think header(28) + row spacing(4)
    expect(entry?.estimatedHeight).toBe(208)
  })

  it('clearMeasurements resets to estimated heights', () => {
    const messages = ref(createMessages(1))
    const window = useMessageWindow({ messages })

    const initialEstimate = window.getEntry('message-0')?.estimatedHeight ?? 0
    window.setMeasuredHeight('message-0', initialEstimate + 100)
    expect(window.getEntry('message-0')?.bottom).toBe(initialEstimate + 100)

    window.clearMeasurements()
    expect(window.getEntry('message-0')?.bottom).toBe(initialEstimate)
  })

  it('keeps a 200-message layout bounded through a streaming row replacement', () => {
    const messages = ref(createMessages(200))
    const start = performance.now()
    const window = useMessageWindow({ messages })

    expect(window.entries.value).toHaveLength(200)
    expect(window.totalHeight.value).toBeGreaterThan(0)

    messages.value = [...messages.value.slice(0, 199), createStreamingAssistant()]

    expect(window.entries.value).toHaveLength(200)
    expect(window.getEntry('assistant-real-1')).toBeDefined()
    expect(performance.now() - start).toBeLessThan(100)
  })

  it('captures and restores an immutable measurement snapshot', () => {
    const messages = ref(createMessages(2))
    const firstWindow = useMessageWindow({ messages })
    firstWindow.setMeasuredHeight('message-0', 200)
    firstWindow.setMeasuredHeight('message-1', 240)

    const snapshot = firstWindow.captureMeasurements()
    const restoredWindow = useMessageWindow({ messages })
    restoredWindow.restoreMeasurements(snapshot)

    expect(restoredWindow.getEntry('message-0')?.bottom).toBe(200)
    expect(restoredWindow.getEntry('message-1')?.top).toBe(200)
    expect(restoredWindow.getEntry('message-1')?.bottom).toBe(440)
    expect(Object.isFrozen(snapshot)).toBe(true)
  })
})

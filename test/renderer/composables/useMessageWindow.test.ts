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
})

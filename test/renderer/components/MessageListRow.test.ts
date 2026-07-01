import { mount } from '@vue/test-utils'
import { defineComponent, nextTick } from 'vue'
import { afterEach, describe, expect, it, vi } from 'vitest'
import MessageListRow from '@/components/chat/MessageListRow.vue'

vi.mock('vue-i18n', () => ({
  useI18n: () => ({
    t: (key: string) => key
  })
}))

vi.mock('@/components/message/MessageItemAssistant.vue', () => ({
  default: defineComponent({
    name: 'MessageItemAssistant',
    template: '<div data-testid="assistant-row" />'
  })
}))

vi.mock('@/components/message/MessageItemUser.vue', () => ({
  default: defineComponent({
    name: 'MessageItemUser',
    template: '<div data-testid="user-row" />'
  })
}))

const baseItem = {
  id: 'm1',
  role: 'assistant',
  timestamp: 1,
  updatedAt: 1,
  avatar: '',
  name: 'Assistant',
  model_name: 'Model',
  model_id: 'model',
  model_provider: 'provider',
  status: 'sent',
  error: '',
  usage: {
    context_usage: 0,
    tokens_per_second: 0,
    total_tokens: 0,
    generation_time: 0,
    first_token_time: 0,
    reasoning_start_time: 0,
    reasoning_end_time: 0,
    input_tokens: 0,
    output_tokens: 0
  },
  conversationId: 's1',
  is_variant: 0,
  orderSeq: 1,
  content: []
}

describe('MessageListRow', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    delete (globalThis as { IntersectionObserver?: unknown }).IntersectionObserver
  })

  it('measures on mount without waiting for viewport intersection', async () => {
    ;(globalThis as { IntersectionObserver?: unknown }).IntersectionObserver = class {
      observe = vi.fn()
      disconnect = vi.fn()
    }
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
      callback(0)
      return 1
    })
    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => {})
    vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(114)

    const wrapper = mount(MessageListRow, {
      props: {
        item: baseItem as never
      }
    })

    await nextTick()

    expect(wrapper.emitted('measure')).toEqual([[{ messageId: 'm1', height: 114 }]])
  })
})

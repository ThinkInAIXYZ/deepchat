import { mount } from '@vue/test-utils'
import { defineComponent, nextTick } from 'vue'
import { afterEach, describe, expect, it, vi } from 'vitest'
import MessageListRow from '@/components/chat/MessageListRow.vue'
import type { DisplayAssistantMessage } from '@/features/chat-page/model/displayMessage'

vi.mock('vue-i18n', () => ({
  useI18n: () => ({
    t: (key: string) => key,
    te: (key: string) => key.startsWith('common.')
  })
}))

vi.mock('@/components/markdown/MarkdownRenderer.vue', () => ({
  default: defineComponent({
    props: ['content'],
    template: '<div data-testid="markdown-content">{{ content }}</div>'
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

const baseItem: DisplayAssistantMessage = {
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

  it('opens the completed compaction summary and resets disclosure when a row is recycled', async () => {
    const item: DisplayAssistantMessage = {
      ...baseItem,
      messageType: 'compaction',
      compactionStatus: 'compacting'
    }
    const wrapper = mount(MessageListRow, { props: { item }, attachTo: document.body })
    const trigger = wrapper.get<HTMLButtonElement>('[data-testid="compaction-trigger"]')
    expect(trigger.element.disabled).toBe(true)
    expect(wrapper.find('[data-testid="compaction-details"]').exists()).toBe(false)

    await wrapper.setProps({
      item: { ...item, compactionStatus: 'compacted', compactionSummary: '## Summary\nSaved work.' }
    })
    expect(trigger.element.disabled).toBe(false)
    trigger.element.focus()
    await trigger.trigger('click')
    expect(trigger.attributes('aria-expanded')).toBe('true')
    expect(wrapper.get('[data-testid="markdown-content"]').text()).toBe('## Summary\nSaved work.')
    expect(wrapper.get('[data-testid="compaction-details"]').attributes('id')).toBe(
      trigger.attributes('aria-controls')
    )
    expect(document.activeElement).toBe(trigger.element)

    await trigger.trigger('click')
    expect(wrapper.find('[data-testid="compaction-details"]').exists()).toBe(false)
    expect(trigger.attributes('aria-controls')).toBeUndefined()
    await trigger.trigger('click')
    await wrapper.setProps({
      item: {
        ...item,
        id: 'another-compaction',
        compactionStatus: 'compacted',
        compactionSummary: 'Another summary.'
      }
    })
    expect(trigger.attributes('aria-expanded')).toBe('false')
    expect(wrapper.text()).not.toContain('Saved work.')
    wrapper.unmount()
  })

  it('keeps compaction errors available behind the failed disclosure', async () => {
    const wrapper = mount(MessageListRow, {
      props: {
        item: {
          ...baseItem,
          messageType: 'compaction',
          status: 'error',
          compactionStatus: 'failed',
          compactionError: '503: Summary provider unavailable'
        }
      }
    })
    expect(wrapper.text()).toContain('chat.compaction.failedTitle')
    expect(wrapper.text()).not.toContain('503:')
    await wrapper.get('[data-testid="compaction-trigger"]').trigger('click')
    expect(wrapper.get('[data-testid="compaction-details"]').text()).toBe(
      '503: Summary provider unavailable'
    )
    expect(wrapper.find('[data-testid="markdown-content"]').exists()).toBe(false)
    wrapper.unmount()
  })

  it.each([
    ['summary_unavailable', 'chat.compaction.compactedWithoutSummary'],
    ['summary_rejected_larger', 'chat.compaction.compactedWithoutLargerSummary'],
    [null, 'common.noContent']
  ] as const)('explains a compaction without a summary (%s)', async (reason, copy) => {
    const wrapper = mount(MessageListRow, {
      props: {
        item: {
          ...baseItem,
          messageType: 'compaction',
          compactionStatus: 'compacted',
          compactionBoundaryReason: reason
        }
      }
    })
    await wrapper.get('[data-testid="compaction-trigger"]').trigger('click')
    expect(wrapper.get('[data-testid="compaction-details"]').text()).toBe(copy)
    wrapper.unmount()
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

    expect(wrapper.get('[data-message-id="m1"]').classes()).toContain('pb-1')
    expect(wrapper.emitted('measure')).toEqual([[{ messageId: 'm1', height: 114 }]])
  })

  it('emits renderKey measurements when a streaming row reuses a pending placeholder node', async () => {
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
      callback(0)
      return 1
    })
    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => {})
    vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(88)

    const wrapper = mount(MessageListRow, {
      props: {
        item: {
          ...baseItem,
          id: 'assistant-real-1',
          renderKey: '__pending_assistant_1'
        } as never
      }
    })

    await nextTick()

    expect(wrapper.emitted('measure')).toEqual([
      [{ messageId: '__pending_assistant_1', height: 88 }]
    ])
  })
})

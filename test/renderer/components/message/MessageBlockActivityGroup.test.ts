import { mount } from '@vue/test-utils'
import { defineComponent } from 'vue'
import { afterEach, describe, expect, it, vi } from 'vitest'
import MessageBlockActivityGroup from '@/components/message/MessageBlockActivityGroup.vue'
import type {
  DisplayAssistantMessageBlock,
  DisplayMessageUsage
} from '@/components/chat/messageListItems'

vi.mock('vue-i18n', () => ({
  useI18n: () => ({
    t: (key: string, params?: Record<string, unknown>) => {
      if (key === 'chat.activityCollapse.workedFor') {
        return `Worked for ${params?.duration}`
      }
      if (key === 'chat.activityCollapse.reasoningCount') {
        return `${params?.count} thought(s)`
      }
      if (key === 'chat.activityCollapse.toolCallCount') {
        return `${params?.count} tool call(s)`
      }
      if (key === 'chat.activityCollapse.expandLabel') {
        return `Expand ${params?.title}`
      }
      if (key === 'chat.activityCollapse.collapseLabel') {
        return `Collapse ${params?.title}`
      }
      if (key === 'chat.activityCollapse.duration.day') {
        return 'd '
      }
      if (key === 'chat.activityCollapse.duration.hour') {
        return 'h '
      }
      if (key === 'chat.activityCollapse.duration.minute') {
        return 'm '
      }
      if (key === 'chat.activityCollapse.duration.second') {
        return 's'
      }
      return key
    }
  })
}))

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

const blocks: DisplayAssistantMessageBlock[] = [
  {
    type: 'reasoning_content',
    content: 'thinking',
    status: 'success',
    timestamp: 1_000
  },
  {
    type: 'tool_call',
    status: 'success',
    timestamp: 2_000,
    tool_call: {
      id: 'tc1',
      name: 'shell_command'
    }
  }
]

const mountGroup = () =>
  mount(MessageBlockActivityGroup, {
    props: {
      blocks,
      messageId: 'm1',
      threadId: 's1',
      usage,
      durationMs: 65_000,
      reasoningCount: 1,
      toolCallCount: 1
    },
    global: {
      stubs: {
        Icon: defineComponent({
          name: 'Icon',
          template: '<span data-testid="icon" />'
        }),
        MessageBlockThink: defineComponent({
          name: 'MessageBlockThink',
          props: {
            block: {
              type: Object,
              required: true
            }
          },
          template: '<div data-testid="think-block">{{ block.content }}</div>'
        }),
        MessageBlockToolCall: defineComponent({
          name: 'MessageBlockToolCall',
          props: {
            block: {
              type: Object,
              required: true
            }
          },
          template: '<div data-testid="tool-block">{{ block.tool_call?.name }}</div>'
        })
      }
    }
  })

describe('MessageBlockActivityGroup', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('starts collapsed with duration and activity counts in the title', () => {
    const wrapper = mountGroup()

    expect(wrapper.get('[data-testid="activity-group-toggle"]').text()).toContain(
      'Worked for 1m 5s · 1 thought(s) · 1 tool call(s)'
    )
    expect(wrapper.get('[data-testid="activity-group-toggle"]').attributes('aria-expanded')).toBe(
      'false'
    )
    expect(wrapper.get('[data-testid="activity-group-body-shell"]').attributes('aria-hidden')).toBe(
      'true'
    )
    expect(
      wrapper.get('[data-testid="activity-group-body-shell"]').attributes('inert')
    ).toBeDefined()
    expect(wrapper.get('[data-testid="activity-group-body-shell"]').classes()).toContain(
      'grid-rows-[0fr]'
    )
    expect(wrapper.find('[data-testid="think-block"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="tool-block"]').exists()).toBe(false)
  })

  it('toggles expanded state and shows the original activity blocks', async () => {
    vi.useFakeTimers()
    const wrapper = mountGroup()

    await wrapper.get('[data-testid="activity-group-toggle"]').trigger('click')

    expect(wrapper.get('[data-testid="activity-group-toggle"]').attributes('aria-expanded')).toBe(
      'true'
    )
    expect(wrapper.get('[data-testid="activity-group-body-shell"]').attributes('aria-hidden')).toBe(
      'false'
    )
    expect(
      wrapper.get('[data-testid="activity-group-body-shell"]').attributes('inert')
    ).toBeUndefined()
    expect(wrapper.get('[data-testid="activity-group-body-shell"]').classes()).toContain(
      'grid-rows-[1fr]'
    )
    expect(wrapper.find('[data-testid="think-block"]').text()).toBe('thinking')
    expect(wrapper.find('[data-testid="tool-block"]').text()).toBe('shell_command')

    await wrapper.get('[data-testid="activity-group-toggle"]').trigger('click')

    expect(wrapper.get('[data-testid="activity-group-toggle"]').attributes('aria-expanded')).toBe(
      'false'
    )
    expect(wrapper.get('[data-testid="activity-group-body-shell"]').attributes('aria-hidden')).toBe(
      'true'
    )
    expect(
      wrapper.get('[data-testid="activity-group-body-shell"]').attributes('inert')
    ).toBeDefined()

    expect(wrapper.find('[data-testid="think-block"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="tool-block"]').exists()).toBe(true)

    vi.runAllTimers()
    await wrapper.vm.$nextTick()

    expect(wrapper.find('[data-testid="think-block"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="tool-block"]').exists()).toBe(false)

    vi.useRealTimers()
  })

  it('does not persist expanded state across remounts', async () => {
    const wrapper = mountGroup()
    await wrapper.get('[data-testid="activity-group-toggle"]').trigger('click')
    expect(wrapper.get('[data-testid="activity-group-toggle"]').attributes('aria-expanded')).toBe(
      'true'
    )

    wrapper.unmount()
    const remounted = mountGroup()

    expect(remounted.get('[data-testid="activity-group-toggle"]').attributes('aria-expanded')).toBe(
      'false'
    )
  })
})

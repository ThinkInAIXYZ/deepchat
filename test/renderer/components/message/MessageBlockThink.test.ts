import { afterEach, describe, expect, it, vi } from 'vitest'
import { defineComponent } from 'vue'
import { flushPromises, mount } from '@vue/test-utils'

vi.mock('vue-i18n', () => ({
  useI18n: () => ({
    t: (key: string, params?: Record<string, unknown>) => `${key}:${params?.seconds ?? ''}`
  })
}))

const configClient = {
  getSetting: vi.fn().mockResolvedValue(false),
  setSetting: vi.fn()
}

vi.mock('@api/ConfigClient', () => ({
  createConfigClient: vi.fn(() => configClient)
}))

vi.mock('@/components/think-content', () => ({
  ThinkContent: defineComponent({
    name: 'ThinkContent',
    props: {
      label: { type: String, required: true },
      expanded: { type: Boolean, default: false },
      thinking: { type: Boolean, default: false },
      content: { type: String, default: '' }
    },
    template: '<div class="think-content-stub">{{ label }}</div>'
  })
}))

import MessageBlockThink from '@/components/message/MessageBlockThink.vue'

describe('MessageBlockThink', () => {
  afterEach(() => vi.useRealTimers())

  it.each([0, 1, 999, 1_000])(
    'preserves running labels and summarizes %i ms after completion',
    async (duration) => {
      vi.useFakeTimers({ toFake: ['Date'] })
      vi.setSystemTime(1_000 + duration)
      const wrapper = mount(MessageBlockThink, {
        props: {
          block: {
            type: 'reasoning_content',
            content: 'thinking',
            status: 'loading',
            timestamp: 0,
            reasoning_time: { start: 1_000, end: 1_000 + duration }
          },
          usage: { reasoning_start_time: 0, reasoning_end_time: 0 }
        }
      })

      await flushPromises()

      expect(wrapper.text()).toBe(
        duration < 1_000 ? 'chat.messages.thinking:' : 'chat.features.thoughtForSecondsLoading:1'
      )

      await wrapper.setProps({ block: { ...wrapper.props('block'), status: 'success' } })

      expect(wrapper.text()).toBe(
        duration < 1_000
          ? 'chat.features.thoughtForLessThanOneSecond:'
          : 'chat.features.thoughtForSeconds:1'
      )
      wrapper.unmount()
    }
  )

  it('advances without new deltas and settles at the projected end time', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(1_000)
    const wrapper = mount(MessageBlockThink, {
      props: {
        block: {
          type: 'reasoning_content',
          content: 'thinking',
          status: 'loading',
          timestamp: 1_000
        },
        usage: { reasoning_start_time: 0, reasoning_end_time: 0 }
      }
    })

    expect(wrapper.text()).toBe('chat.messages.thinking:')
    await vi.advanceTimersByTimeAsync(3_000)
    expect(wrapper.text()).toBe('chat.features.thoughtForSecondsLoading:3')

    await wrapper.setProps({
      block: {
        ...wrapper.props('block'),
        status: 'success',
        reasoning_time: { start: 1_000, end: 3_500 }
      }
    })
    await vi.advanceTimersByTimeAsync(2_000)
    expect(wrapper.text()).toBe('chat.features.thoughtForSeconds:2')
    wrapper.unmount()
  })

  it('preserves manual expansion when the saved preference arrives after user interaction', async () => {
    let resolveSetting!: (value: boolean) => void
    configClient.getSetting.mockReturnValueOnce(
      new Promise<boolean>((resolve) => {
        resolveSetting = resolve
      })
    )
    const wrapper = mount(MessageBlockThink, {
      props: {
        block: { type: 'reasoning_content', content: 'thinking', status: 'success', timestamp: 0 },
        usage: { reasoning_start_time: 0, reasoning_end_time: 0 }
      }
    })
    const content = wrapper.findComponent({ name: 'ThinkContent' })

    expect(content.props('expanded')).toBe(false)
    content.vm.$emit('toggle')
    resolveSetting(true)
    await flushPromises()

    expect(content.props('expanded')).toBe(true)
    expect(wrapper.emitted('manual-toggle')).toEqual([[true]])
  })

  it('renders seconds from block.reasoning_time when present', async () => {
    const wrapper = mount(MessageBlockThink, {
      props: {
        block: {
          type: 'reasoning_content',
          content: 'thinking',
          status: 'success',
          timestamp: 0,
          reasoning_time: {
            start: 1_000,
            end: 4_600
          }
        },
        usage: {
          reasoning_start_time: 0,
          reasoning_end_time: 0
        }
      }
    })

    await flushPromises()

    expect(wrapper.text()).toContain('chat.features.thoughtForSeconds:3')
  })

  it('falls back to usage reasoning time when block.reasoning_time is missing', async () => {
    const wrapper = mount(MessageBlockThink, {
      props: {
        block: {
          type: 'reasoning_content',
          content: 'thinking',
          status: 'success',
          timestamp: 0
        },
        usage: {
          reasoning_start_time: 500,
          reasoning_end_time: 3_900
        }
      }
    })

    await flushPromises()

    expect(wrapper.text()).toContain('chat.features.thoughtForSeconds:3')
  })
})

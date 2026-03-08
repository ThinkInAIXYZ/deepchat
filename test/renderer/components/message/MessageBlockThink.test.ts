import { describe, expect, it, vi } from 'vitest'
import { defineComponent } from 'vue'
import { flushPromises, mount } from '@vue/test-utils'

vi.mock('vue-i18n', () => ({
  useI18n: () => ({
    t: (key: string, params?: Record<string, unknown>) => `${key}:${params?.seconds ?? ''}`
  })
}))

vi.mock('@vueuse/core', () => ({
  useThrottleFn: (fn: () => void) => fn
}))

const configPresenter = {
  getSetting: vi.fn().mockResolvedValue(false),
  setSetting: vi.fn()
}

vi.mock('@/composables/usePresenter', () => ({
  usePresenter: () => configPresenter
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
